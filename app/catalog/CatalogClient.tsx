"use client";

import { useEffect, useRef, useState } from "react";
import {
  CopeCart,
  CopeApiError,
  CopeNetworkError,
  CopeCartExpiredError,
} from "@copecart/sdk";
import type { PublicEnvConfig } from "@/lib/cope-env";
import type { CatalogProduct } from "@/lib/cope-catalog";

type Status = { message: string; kind: "" | "ok" | "err" };
type CheckoutMode = "hosted" | "iframe";

/**
 * Every vendor-actionable problem the checkout flow can hit. The render layer
 * switches on `kind` and shows a tutorial-grade banner with dashboard links
 * and copy-pastable values, so the vendor never has to decipher a raw error.
 *
 * Anything that doesn't fit one of these kinds falls through to `dev-bug` —
 * surfaced as a structured diagnostic the vendor can paste into a support
 * ticket.
 */
type SetupError =
  /** COPE_PUBLISHABLE_KEY not set in .env (or wrong prefix). */
  | { kind: "missing-key"; reason: string }
  /** CORS preflight blocked — origin not in SDK allowlist. */
  | { kind: "embed-domain"; origin: string; apiBase: string }
  /** Iframe parent origin not in iframe allowlist (separate list). */
  | { kind: "iframe-embed-blocked"; origin: string }
  /** SDK key was rejected by the API as invalid/inactive. */
  | { kind: "auth"; status: number; message: string; requestId: string | null }
  /** success_url / cancel_url not in Redirect URLs allowlist. */
  | { kind: "redirect-urls"; fields: string[]; urls: string[] }
  /** Selected product isn't saleable. `blockReason` (when present) discriminates
   *  product-side issues (status/approval) from seller-side issues (Stripe
   *  onboarding not complete). */
  | { kind: "not-saleable"; message: string; blockReason: string | null }
  /** Order total below Stripe's per-currency minimum charge. */
  | { kind: "below-minimum"; message: string }
  /** Tax engine needs buyer country/postal but cart has none. */
  | { kind: "tax-config"; message: string }
  /** Transient backend issue — usually clears on retry. */
  | {
      kind: "transient";
      code: string;
      message: string;
      requestId: string | null;
    }
  /** Local cart is stale (expired/cancelled). SDK clears it; just retry. */
  | { kind: "cart-stale"; message: string }
  /** Iframe couldn't load after retries — fell back to hosted redirect. */
  | { kind: "iframe-load-failed" }
  /** Unknown / unmapped error — show diagnostic so vendor can report it. */
  | {
      kind: "dev-bug";
      code: string;
      message: string;
      requestId: string | null;
      status?: number;
    };

const DASHBOARD_REDIRECT_URLS = "https://app.cope.com/settings/api";
const DASHBOARD_EMBED_DOMAINS = "https://app.cope.com/settings/checkout";
const DASHBOARD_API_KEYS = "https://app.cope.com/settings/api";
const DASHBOARD_PRODUCTS = "https://app.cope.com/products";

const MOUNT_READY_TIMEOUT_MS = 6_000;
const MAX_MOUNT_ATTEMPTS = 2;

export function CatalogClient({
  env,
  products,
}: {
  env: PublicEnvConfig;
  products: readonly CatalogProduct[];
}) {
  // selections: productUuid -> quantity. Undefined means "not selected".
  const [selections, setSelections] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [iframeOpen, setIframeOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [setupError, setSetupError] = useState<SetupError | null>(null);

  // Cart currency follows the first selected product. Mixing currencies in one
  // cart isn't supported (the cart has a single `currency` field), so this is
  // the simplest invariant: the cart adopts the currency of the first pick.
  const firstSelectedUuid = Object.keys(selections)[0];
  const firstSelected = firstSelectedUuid
    ? products.find((p) => p.uuid === firstSelectedUuid)
    : undefined;
  const currency = firstSelected?.currency ?? env.defaultCurrency;

  const selectedCount = Object.values(selections).filter((q) => q > 0).length;
  const total = sumTotal(products, selections);

  const mountedRef = useRef<{ destroy: () => void } | null>(null);
  useEffect(
    () => () => {
      mountedRef.current?.destroy();
    },
    [],
  );

  function toggle(uuid: string) {
    setSelections((prev) => {
      const next = { ...prev };
      if (next[uuid]) {
        delete next[uuid];
      } else {
        next[uuid] = 1;
      }
      return next;
    });
  }

  function setQty(uuid: string, qty: number) {
    setSelections((prev) => {
      const next = { ...prev };
      if (qty <= 0) {
        delete next[uuid];
      } else {
        next[uuid] = qty;
      }
      return next;
    });
  }

  async function startCheckout(mode: CheckoutMode) {
    setSetupError(null);
    setStatus(null);

    if (!env.publishableKey) {
      setSetupError({
        kind: "missing-key",
        reason: "COPE_PUBLISHABLE_KEY is empty in the server-rendered env.",
      });
      return;
    }
    if (!env.publishableKey.startsWith("cope_pk_")) {
      setSetupError({
        kind: "missing-key",
        reason: `COPE_PUBLISHABLE_KEY must start with cope_pk_ — got "${env.publishableKey.slice(0, 12)}…".`,
      });
      return;
    }
    const picks = products
      .filter((p) => (selections[p.uuid] ?? 0) > 0)
      .map((p) => ({ uuid: p.uuid, quantity: selections[p.uuid] ?? 1 }));
    if (picks.length === 0) {
      setStatus({ message: "Pick at least one product.", kind: "err" });
      return;
    }

    setBusy(true);
    setStatus({ message: "Creating cart…", kind: "" });

    // URLs we'll send (and that the vendor must register in the dashboard
    // allowlist). Kept in scope so the catch handler can surface them when
    // the backend rejects them with `invalid_redirect_url`.
    const origin = window.location.origin;
    const success_url = `${origin}/thank-you`;
    const cancel_url = `${origin}/catalog`;

    try {
      mountedRef.current?.destroy();
      mountedRef.current = null;

      const cope = new CopeCart({
        publishableKey: env.publishableKey,
        baseUrl: env.apiBase,
        checkoutBaseUrl: env.checkoutBase,
      });

      const cart = await cope.createCart({ currency });
      // Serial addLine — the cart API rejects parallel mutations on the same
      // cart (version-conflict). For a typical 1–10 line catalog this is fine.
      for (const pick of picks) {
        setStatus({ message: `Adding ${pick.uuid}…`, kind: "" });
        await cope.addLine(cart.id, {
          product_id: pick.uuid,
          quantity: pick.quantity,
        });
      }

      setStatus({ message: "Creating checkout…", kind: "" });

      if (mode === "hosted") {
        const hostedCheckout = await cope.checkout(cart.id, {
          success_url,
          cancel_url,
          consents: [{ type: "terms-of-purchase", version: "1.0" }],
        });
        cope.redirectToCheckout(hostedCheckout);
        return;
      }

      // Iframe mode
      const checkout = await cope.checkout(cart.id, {
        embed_origin: origin,
        success_url,
        cancel_url,
        consents: [{ type: "terms-of-purchase", version: "1.0" }],
      });

      setIframeOpen(true);
      mountWithRetry(cope, checkout);
    } catch (err) {
      console.error(err);
      setSetupError(
        classifyError(err, {
          urls: [success_url, cancel_url],
          origin,
          apiBase: env.apiBase,
        }),
      );
      setStatus(null);
      setBusy(false);
    }
  }

  function mountWithRetry(
    cope: CopeCart,
    checkout: Parameters<CopeCart["redirectToCheckout"]>[0],
  ) {
    let attempts = 0;
    let ready = false;
    let watchdog: number | null = null;

    const cleanupWatchdog = () => {
      if (watchdog !== null) {
        window.clearTimeout(watchdog);
        watchdog = null;
      }
    };

    const tryMount = () => {
      attempts += 1;
      mountedRef.current?.destroy();
      cleanupWatchdog();

      watchdog = window.setTimeout(() => {
        if (ready) return;
        if (attempts < MAX_MOUNT_ATTEMPTS) {
          setStatus({
            message: `Mount didn't load in ${MOUNT_READY_TIMEOUT_MS / 1000}s — retrying…`,
            kind: "",
          });
          tryMount();
          return;
        }
        // Exhausted retries: show structured iframe-load banner, then fall
        // back to hosted redirect so the buyer can still pay.
        setSetupError({ kind: "iframe-load-failed" });
        setStatus(null);
        mountedRef.current?.destroy();
        mountedRef.current = null;
        cope.redirectToCheckout(checkout);
      }, MOUNT_READY_TIMEOUT_MS);

      mountedRef.current = cope.mountCheckout("#catalog-checkout-frame", checkout, {
        readyTimeoutMs: 300_000,
        fallback: "error",
        onReady: () => {
          ready = true;
          cleanupWatchdog();
          setStatus({ message: "Checkout loaded.", kind: "ok" });
        },
        onSuccess: () => {
          setStatus({ message: "Payment completed. Redirecting…", kind: "ok" });
          setTimeout(() => {
            window.location.href = `/thank-you`;
          }, 600);
        },
        onCancel: () => setStatus({ message: "Buyer cancelled.", kind: "" }),
        onError: ({ code }) => {
          if (ready) return;
          if (code === "load_failed" && attempts < MAX_MOUNT_ATTEMPTS) {
            tryMount();
            return;
          }
          cleanupWatchdog();
          setSetupError(
            classifyIframeError(code, { origin: window.location.origin }),
          );
          setStatus(null);
        },
      });
    };

    tryMount();
    setBusy(false);
  }

  if (products.length === 0) {
    return (
      <div className="cope-empty">
        <p style={{ margin: 0 }}>
          No saleable products returned from the catalog API. Make sure your
          business has at least one approved, active product, or check the
          warning above for an auth/configuration issue.
        </p>
      </div>
    );
  }

  return (
    <div style={{ marginTop: "1.75rem" }}>
      {setupError && <SetupErrorBanner error={setupError} />}

      <ul className="cope-product-list">
        {products.map((p) => {
          const qty = selections[p.uuid] ?? 0;
          const selected = qty > 0;
          return (
            <li
              key={p.uuid}
              className={`cope-product${selected ? " cope-product--selected" : ""}`}
            >
              <label className="cope-product-label">
                <input
                  type="checkbox"
                  className="cope-product-check"
                  checked={selected}
                  onChange={() => toggle(p.uuid)}
                  disabled={busy}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="cope-product-title-row">
                    <span className="cope-product-name">{p.name}</span>
                    <span className="cope-product-price">{formatPlan(p)}</span>
                  </div>
                  {p.headline && (
                    <p className="cope-product-headline">{p.headline}</p>
                  )}
                  <div className="cope-product-meta">
                    <code>{p.uuid}</code>
                    <span>·</span>
                    <span>{p.productType}</span>
                    <span>·</span>
                    <span>{p.currency}</span>
                  </div>
                </div>
                {selected && (
                  <label className="cope-qty">
                    Qty
                    <input
                      type="number"
                      className="cope-qty-input"
                      min={1}
                      max={99}
                      value={qty}
                      onChange={(e) =>
                        setQty(p.uuid, Number.parseInt(e.target.value, 10) || 0)
                      }
                      disabled={busy}
                    />
                  </label>
                )}
              </label>
            </li>
          );
        })}
      </ul>

      <div className="cope-summary">
        <div style={{ fontSize: "0.95rem" }}>
          {selectedCount === 0 ? (
            <span className="cope-muted">Pick at least one product.</span>
          ) : (
            <>
              <strong>
                {selectedCount} item{selectedCount === 1 ? "" : "s"}
              </strong>{" "}
              · {currency} {total.toFixed(2)}{" "}
              <span className="cope-subtle">(first payment only)</span>
            </>
          )}
        </div>
        <div className="cope-summary-actions">
          <button
            onClick={() => startCheckout("hosted")}
            disabled={busy || selectedCount === 0}
            className="cope-btn cope-btn--primary"
          >
            {busy ? "…" : "Buy — hosted redirect"}
          </button>
          <button
            onClick={() => startCheckout("iframe")}
            disabled={busy || selectedCount === 0}
            className="cope-btn cope-btn--secondary"
          >
            {busy ? "…" : "Buy — iframe"}
          </button>
        </div>
      </div>

      {iframeOpen && (
        <div className="cope-frame" data-cope-frame>
          <div className="cope-frame-head">
            <strong>Embedded checkout</strong>
            <button
              type="button"
              onClick={() => {
                mountedRef.current?.destroy();
                mountedRef.current = null;
                setIframeOpen(false);
                setStatus(null);
              }}
              className="cope-btn cope-btn--ghost"
            >
              Close
            </button>
          </div>
          <div id="catalog-checkout-frame" className="cope-frame-target" />
        </div>
      )}

      {status && (
        <div
          className={`cope-status${
            status.kind === "ok"
              ? " cope-status--ok"
              : status.kind === "err"
                ? " cope-status--err"
                : ""
          }`}
        >
          {status.message}
        </div>
      )}
    </div>
  );
}

/**
 * Map every catchable exception to a structured `SetupError`. The render layer
 * decides what banner to show; this function never returns null so the vendor
 * always sees *something* actionable (worst case: a `dev-bug` diagnostic).
 */
function classifyError(
  err: unknown,
  ctx: { urls: string[]; origin: string; apiBase: string },
): SetupError {
  // ─── CORS preflight blocked ─────────────────────────────────────────────
  // The browser rejects the response before any body/header reaches us, so
  // the SDK wraps the underlying `TypeError: Failed to fetch` in a
  // CopeNetworkError. Same-origin requests can't trigger CORS, so when the
  // API host differs from the page host this is a near-certain "origin not
  // in SDK allowlist" signal.
  if (err instanceof CopeNetworkError) {
    let apiHost: string | null = null;
    try {
      apiHost = new URL(ctx.apiBase).host;
    } catch {
      /* fall through */
    }
    if (apiHost && apiHost !== window.location.host) {
      return { kind: "embed-domain", origin: ctx.origin, apiBase: ctx.apiBase };
    }
    return {
      kind: "dev-bug",
      code: "network_error",
      message: err.message || "Network request failed.",
      requestId: null,
    };
  }

  // ─── Cart became unusable ───────────────────────────────────────────────
  // The SDK threw this *after* hydrating a stale cart from localStorage. It
  // already cleared the cart for us — vendor only needs to retry.
  if (err instanceof CopeCartExpiredError) {
    return {
      kind: "cart-stale",
      message: `Cached cart was in state "${err.state}" and got cleared. Click Buy again to create a fresh one.`,
    };
  }

  // ─── Anything else from the API ─────────────────────────────────────────
  if (err instanceof CopeApiError) {
    return classifyApiError(err, ctx);
  }

  // Truly unknown — last-resort diagnostic.
  return {
    kind: "dev-bug",
    code: "unknown",
    message: err instanceof Error ? err.message : String(err),
    requestId: null,
  };
}

function classifyApiError(
  err: CopeApiError,
  ctx: { urls: string[] },
): SetupError {
  // The API can pack multiple field errors into one response. Walk the list
  // and pick the most-actionable bucket per code.

  // 1) invalid_redirect_url — aggregate all rejected fields.
  const redirect = err.errors.filter((e) => e.code === "invalid_redirect_url");
  if (redirect.length > 0) {
    const fields = Array.from(
      new Set(redirect.map((e) => e.field).filter((f): f is string => !!f)),
    );
    return { kind: "redirect-urls", fields, urls: ctx.urls };
  }

  // 2) Auth / key issues — surface even when wrapped in unauthorized + 401/403.
  if (err.code === "unauthorized" || err.status === 401 || err.status === 403) {
    return {
      kind: "auth",
      status: err.status,
      message: err.errors[0]?.message ?? err.message,
      requestId: err.requestId,
    };
  }

  // 3) Catalog- or seller-side problems. The API attaches `block_reason` on
  // the error entry to discriminate (e.g. `seller_not_settleable` = Stripe
  // onboarding incomplete, vs product-status issues).
  if (err.code === "not_saleable") {
    const entry = err.errors[0] as
      | { message?: string; block_reason?: string }
      | undefined;
    return {
      kind: "not-saleable",
      message: entry?.message ?? err.message,
      blockReason: entry?.block_reason ?? null,
    };
  }

  // 4) Stripe per-currency minimum charge.
  if (err.code === "below_minimum_charge") {
    return {
      kind: "below-minimum",
      message: err.errors[0]?.message ?? err.message,
    };
  }

  // 5) Tax engine needs buyer country/postal that nobody set.
  if (err.code === "missing_tax_location") {
    return {
      kind: "tax-config",
      message: err.errors[0]?.message ?? err.message,
    };
  }

  // 6) Stale cart / checkout — caller should retry with a fresh one.
  if (
    err.code === "cart_not_active" ||
    err.code === "checkout_expired" ||
    err.code === "checkout_not_open" ||
    err.code === "checkout_not_cancellable"
  ) {
    return {
      kind: "cart-stale",
      message: err.errors[0]?.message ?? err.message,
    };
  }

  // 7) Transient — vendor just retries.
  if (
    err.code === "rate_limited" ||
    err.code === "tax_service_unavailable" ||
    err.code === "payment_provider_error" ||
    err.status >= 500
  ) {
    return {
      kind: "transient",
      code: err.code,
      message: err.errors[0]?.message ?? err.message,
      requestId: err.requestId,
    };
  }

  // 8) Unmapped — show full diagnostic with code + request_id.
  return {
    kind: "dev-bug",
    code: err.code,
    message: err.errors[0]?.message ?? err.message,
    requestId: err.requestId,
    status: err.status,
  };
}

/**
 * Map an iframe-side error (postMessage from checkout iframe) to the same
 * SetupError union so we can render via the shared banner.
 */
function classifyIframeError(
  code: string,
  ctx: { origin: string },
): SetupError {
  if (code === "embed_not_allowed") {
    return { kind: "iframe-embed-blocked", origin: ctx.origin };
  }
  if (code === "load_failed") {
    return { kind: "iframe-load-failed" };
  }
  return {
    kind: "dev-bug",
    code: `iframe:${code}`,
    message: `Embedded checkout reported error code "${code}".`,
    requestId: null,
  };
}

function SetupErrorBanner({ error }: { error: SetupError }) {
  switch (error.kind) {
    case "missing-key":
      return (
        <Banner title="COPE publishable key is not configured.">
          <p>{error.reason}</p>
          <Steps>
            <li>
              Open{" "}
              <ExtLink href={DASHBOARD_API_KEYS}>
                Dashboard → Settings → API
              </ExtLink>{" "}
              and copy the publishable key (prefix{" "}
              <code className="cope-inline">cope_pk_…</code>).
            </li>
            <li>
              Paste it into <code className="cope-inline">.env</code> as{" "}
              <code className="cope-inline">COPE_PUBLISHABLE_KEY=…</code>.
            </li>
            <li>
              Restart the dev server (<code className="cope-inline">pnpm dev</code>) — Next.js only
              reads <code className="cope-inline">.env</code> on boot.
            </li>
          </Steps>
        </Banner>
      );

    case "embed-domain":
      return (
        <Banner title="This origin isn't allowlisted for the COPE cart SDK.">
          <p>
            The browser couldn&apos;t reach{" "}
            <code className="cope-inline">{error.apiBase}</code> — the cart API
            blocked the CORS preflight from{" "}
            <code className="cope-inline">{error.origin}</code>.
          </p>
          <Steps>
            <li>
              Open{" "}
              <ExtLink href={DASHBOARD_EMBED_DOMAINS}>
                Dashboard → Settings → Checkout → Embed domains
              </ExtLink>
              .
            </li>
            <li>Paste the origin below and click <strong>Add origin</strong>.</li>
            <li>
              Hard-refresh this page (<kbd>⌘ + Shift + R</kbd> / <kbd>Ctrl + Shift + R</kbd>) and
              click Buy again.
            </li>
          </Steps>
          <CopyList items={[error.origin]} />
          <Footnote>
            This same allowlist also gates iframe embedding
            (<code className="cope-inline">frame-ancestors</code> CSP), so it
            must be set for both hosted and iframe checkout modes.
          </Footnote>
        </Banner>
      );

    case "iframe-embed-blocked":
      return (
        <Banner title="This origin isn't allowlisted to iframe the checkout.">
          <p>
            COPE&apos;s checkout sent <code className="cope-inline">embed_not_allowed</code> when
            this page tried to embed it. Your parent origin
            (<code className="cope-inline">{error.origin}</code>) needs to be
            on the iframe allowlist.
          </p>
          <Steps>
            <li>
              Open{" "}
              <ExtLink href={DASHBOARD_EMBED_DOMAINS}>
                Dashboard → Settings → Checkout → Embed domains
              </ExtLink>
              .
            </li>
            <li>Add the origin below and save.</li>
            <li>Click Buy → iframe again.</li>
          </Steps>
          <CopyList items={[error.origin]} />
        </Banner>
      );

    case "auth":
      return (
        <Banner title="COPE rejected the publishable key.">
          <p>
            HTTP {error.status} · <code className="cope-inline">unauthorized</code> ·{" "}
            {error.message}
          </p>
          <Steps>
            <li>
              The key in <code className="cope-inline">.env</code> may belong to a
              different business or be revoked. Open{" "}
              <ExtLink href={DASHBOARD_API_KEYS}>
                Dashboard → Settings → API
              </ExtLink>{" "}
              and verify the publishable key you&apos;re using.
            </li>
            <li>
              Make sure you&apos;re using the <strong>publishable</strong> key
              (<code className="cope-inline">cope_pk_…</code>), not the secret one
              (<code className="cope-inline">cope_sk_…</code>).
            </li>
            <li>
              Re-paste into <code className="cope-inline">.env</code> and restart{" "}
              <code className="cope-inline">pnpm dev</code>.
            </li>
          </Steps>
          {error.requestId && (
            <Footnote>
              Request ID: <code className="cope-inline">{error.requestId}</code>{" "}
              — quote this in any support ticket.
            </Footnote>
          )}
        </Banner>
      );

    case "redirect-urls":
      return (
        <Banner title="Redirect URLs aren't registered for this integration.">
          <p>
            COPE rejected{" "}
            {error.fields.length > 0 && (
              <>
                {error.fields.map((f, i) => (
                  <span key={f}>
                    {i > 0 && ", "}
                    <code className="cope-inline">{f}</code>
                  </span>
                ))}{" "}
              </>
            )}
            because the URLs we sent aren&apos;t in your allowlist.
          </p>
          <Steps>
            <li>
              Open{" "}
              <ExtLink href={DASHBOARD_REDIRECT_URLS}>
                Dashboard → Settings → API → Redirect URLs
              </ExtLink>
              .
            </li>
            <li>Add each URL below exactly as shown (no trailing slash).</li>
            <li>Click Buy again.</li>
          </Steps>
          <CopyList items={error.urls} />
        </Banner>
      );

    case "not-saleable": {
      // `seller_not_settleable` is the most common cause in a freshly-created
      // business — Stripe onboarding wasn't completed, so the seller can't
      // accept payments yet. The fix is in a different dashboard area than
      // the generic product-status case.
      if (error.blockReason === "seller_not_settleable") {
        return (
          <Banner title="Your seller account can't accept payments yet.">
            <p>
              The backend reported{" "}
              <code className="cope-inline">seller_not_settleable</code>: {error.message}
            </p>
            <Steps>
              <li>
                Open{" "}
                <ExtLink href="https://app.cope.com/settings/payouts">
                  Dashboard → Settings → Payouts
                </ExtLink>{" "}
                (or whichever section your dashboard calls{" "}
                <em>Bank / Stripe onboarding</em>).
              </li>
              <li>
                Complete the Stripe Connect KYC flow — usually identity
                verification, bank details, and tax form.
              </li>
              <li>
                Wait a few minutes for Stripe to mark the account as{" "}
                <code className="cope-inline">charges_enabled = true</code>, then
                click Buy again.
              </li>
            </Steps>
            <Footnote>
              This is a one-time setup per business. After onboarding completes
              you can sell from any product.
            </Footnote>
          </Banner>
        );
      }

      return (
        <Banner title="One of the selected products isn't saleable.">
          <p>
            The backend reported <code className="cope-inline">not_saleable</code>
            {error.blockReason && (
              <>
                {" "}(<code className="cope-inline">{error.blockReason}</code>)
              </>
            )}
            : {error.message}
          </p>
          <Steps>
            <li>
              Open{" "}
              <ExtLink href={DASHBOARD_PRODUCTS}>Dashboard → Products</ExtLink>{" "}
              and confirm each selected product is{" "}
              <strong>status: active</strong> and{" "}
              <strong>approval: approved</strong>.
            </li>
            <li>
              If you just changed a product, give the API a moment then retry.
              Stale catalog cache can lag a few seconds.
            </li>
          </Steps>
        </Banner>
      );
    }

    case "below-minimum":
      return (
        <Banner title="Order total is below the per-currency minimum charge.">
          <p>
            Stripe enforces a per-currency minimum (e.g. €0.50, $0.50). Cart
            total is below it: {error.message}
          </p>
          <Steps>
            <li>Increase the product price, or</li>
            <li>Increase the quantity until the total clears the minimum.</li>
          </Steps>
        </Banner>
      );

    case "tax-config":
      return (
        <Banner title="Tax engine needs buyer country / postal code.">
          <p>{error.message}</p>
          <Steps>
            <li>
              The cart doesn&apos;t have buyer identity yet. In production, set
              it with{" "}
              <code className="cope-inline">
                cope.setBuyerIdentity(cartId, {"{ country, postal_code, … }"})
              </code>{" "}
              before <code className="cope-inline">cope.reprice(cartId)</code> or{" "}
              <code className="cope-inline">cope.checkout(...)</code>.
            </li>
            <li>
              This sample skips that step; in a real flow collect the address
              from the buyer first.
            </li>
          </Steps>
        </Banner>
      );

    case "transient":
      return (
        <Banner
          title="Temporary backend issue — please retry."
          severity="warning"
        >
          <p>
            <code className="cope-inline">{error.code}</code> · {error.message}
          </p>
          <Steps>
            <li>Click Buy again in a few seconds.</li>
            <li>
              If it keeps failing, check{" "}
              <ExtLink href="https://status.cope.com">status.cope.com</ExtLink>{" "}
              for an active incident.
            </li>
          </Steps>
          {error.requestId && (
            <Footnote>
              Request ID: <code className="cope-inline">{error.requestId}</code>
            </Footnote>
          )}
        </Banner>
      );

    case "cart-stale":
      return (
        <Banner title="Cached cart was stale and has been cleared." severity="warning">
          <p>{error.message}</p>
          <Steps>
            <li>Click Buy again — a fresh cart will be created automatically.</li>
          </Steps>
        </Banner>
      );

    case "iframe-load-failed":
      return (
        <Banner title="Embedded checkout failed to load.">
          <p>
            The iframe never reported ready after{" "}
            {MOUNT_READY_TIMEOUT_MS / 1000}s × {MAX_MOUNT_ATTEMPTS} attempts.
            We fell back to the hosted redirect.
          </p>
          <Steps>
            <li>
              Check that this origin is in{" "}
              <ExtLink href={DASHBOARD_EMBED_DOMAINS}>
                Settings → Checkout → Embed domains
              </ExtLink>{" "}
              — without it the iframe is blocked by CSP.
            </li>
            <li>
              Open DevTools → Network and look at the request to{" "}
              <code className="cope-inline">/checkout/embed/&lt;token&gt;</code>{" "}
              — its status code tells you which case it is.
            </li>
          </Steps>
        </Banner>
      );

    case "dev-bug":
      return (
        <Banner title="Unexpected error from the COPE SDK.">
          <p>
            <code className="cope-inline">{error.code}</code>
            {error.status ? <> · HTTP {error.status}</> : null} · {error.message}
          </p>
          <Steps>
            <li>This isn&apos;t one of the documented vendor-fixable cases.</li>
            <li>
              Open a support ticket with the diagnostic below — COPE engineers
              can trace it from the Request ID.
            </li>
          </Steps>
          {error.requestId && (
            <Footnote>
              Request ID: <code className="cope-inline">{error.requestId}</code>
            </Footnote>
          )}
        </Banner>
      );
  }
}

// ─── Small banner primitives — shared across all kinds ─────────────────────

function Banner({
  title,
  children,
  severity = "error",
}: {
  title: string;
  children: React.ReactNode;
  severity?: "error" | "warning";
}) {
  return (
    <div
      className={`cope-banner cope-banner--${severity}`}
      style={{ flexDirection: "column", alignItems: "stretch", gap: "0.75rem" }}
    >
      <strong>{title}</strong>
      {children}
    </div>
  );
}

function Steps({ children }: { children: React.ReactNode }) {
  return (
    <ol
      style={{
        margin: 0,
        paddingLeft: "1.25rem",
        display: "grid",
        gap: "0.35rem",
      }}
    >
      {children}
    </ol>
  );
}

function CopyList({ items }: { items: string[] }) {
  return (
    <ul
      style={{
        margin: 0,
        paddingLeft: "1.1rem",
        display: "grid",
        gap: "0.25rem",
      }}
    >
      {items.map((u) => (
        <li key={u}>
          <code className="cope-inline">{u}</code>
        </li>
      ))}
    </ul>
  );
}

function Footnote({ children }: { children: React.ReactNode }) {
  return (
    <div className="cope-subtle" style={{ fontSize: "0.82rem" }}>
      {children}
    </div>
  );
}

function ExtLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}

function formatPlan(p: CatalogProduct): string {
  const plan = p.defaultPlan;
  if (!plan) return "—";
  const amount = plan.firstPaymentAmount;
  if (plan.planType === "subscription" && plan.interval) {
    const every = (plan.intervalCount ?? 1) === 1 ? plan.interval : `${plan.intervalCount} ${plan.interval}s`;
    return `${p.currency} ${amount} / ${every}`;
  }
  if (plan.planType === "installment" && plan.nextPaymentsAmount) {
    return `${p.currency} ${amount} then ${plan.nextPaymentsAmount}`;
  }
  return `${p.currency} ${amount}`;
}

function sumTotal(
  products: readonly CatalogProduct[],
  selections: Record<string, number>,
): number {
  return products.reduce((sum, p) => {
    const qty = selections[p.uuid] ?? 0;
    if (qty <= 0) return sum;
    const amount = Number.parseFloat(p.defaultPlan?.firstPaymentAmount ?? "0");
    return sum + (Number.isFinite(amount) ? amount * qty : 0);
  }, 0);
}
