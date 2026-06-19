"use client";

import { useEffect, useRef, useState } from "react";
import { CopeCart } from "@copecart/sdk";
import type { PublicEnvConfig } from "@/lib/cope-env";
import type { CatalogProduct } from "@/lib/cope-catalog";

type Status = { message: string; kind: "" | "ok" | "err" };
type CheckoutMode = "hosted" | "iframe";

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
    if (!env.publishableKey) {
      setStatus({
        message: "Server is missing COPE_PUBLISHABLE_KEY — set it in .env and restart.",
        kind: "err",
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
      const successPath = `/thank-you`;
      const cancelPath = `/catalog`;

      if (mode === "hosted") {
        const hostedCheckout = await cope.checkout(cart.id, {
          success_url: `${env.publicBaseUrl}${successPath}`,
          cancel_url: `${env.publicBaseUrl}${cancelPath}`,
          consents: [{ type: "terms-of-purchase", version: "1.0" }],
        });
        cope.redirectToCheckout(hostedCheckout);
        return;
      }

      // Iframe mode
      const checkout = await cope.checkout(cart.id, {
        embed_origin: window.location.origin,
        success_url: `${window.location.origin}${successPath}`,
        cancel_url: `${window.location.origin}${cancelPath}`,
        consents: [{ type: "terms-of-purchase", version: "1.0" }],
      });

      setIframeOpen(true);
      mountWithRetry(cope, checkout);
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : String(err);
      setStatus({ message: `Error: ${message}`, kind: "err" });
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
        setStatus({
          message: "Embed didn't load — falling back to hosted redirect.",
          kind: "err",
        });
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
        onError: ({ code, retryable }) => {
          if (ready) return;
          if (code === "load_failed" && attempts < MAX_MOUNT_ATTEMPTS) {
            tryMount();
            return;
          }
          setStatus({
            message: `Checkout error: ${code}${retryable ? " (retryable)" : ""}`,
            kind: "err",
          });
          cleanupWatchdog();
        },
      });
    };

    tryMount();
    setBusy(false);
  }

  if (products.length === 0) {
    return (
      <div style={emptyState}>
        <p style={{ margin: 0 }}>
          No saleable products returned from the catalog API. Make sure your
          business has at least one approved, active product, or check the
          warning above for an auth/configuration issue.
        </p>
      </div>
    );
  }

  return (
    <div style={{ marginTop: "1.5rem" }}>
      <ul style={list}>
        {products.map((p) => {
          const qty = selections[p.uuid] ?? 0;
          const selected = qty > 0;
          return (
            <li key={p.uuid} style={selected ? rowSelected : row}>
              <label style={labelRow}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => toggle(p.uuid)}
                  disabled={busy}
                  style={{ marginTop: 4 }}
                />
                <div style={{ flex: 1 }}>
                  <div style={titleRow}>
                    <strong>{p.name}</strong>
                    <span style={priceTag}>{formatPlan(p)}</span>
                  </div>
                  {p.headline && (
                    <div style={{ color: "#6b7280", fontSize: "0.9rem" }}>
                      {p.headline}
                    </div>
                  )}
                  <div style={metaRow}>
                    <code>{p.uuid}</code>
                    <span>·</span>
                    <span>{p.productType}</span>
                    <span>·</span>
                    <span>{p.currency}</span>
                  </div>
                </div>
                {selected && (
                  <label style={{ fontSize: "0.85rem", color: "#6b7280" }}>
                    Qty
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={qty}
                      onChange={(e) =>
                        setQty(p.uuid, Number.parseInt(e.target.value, 10) || 0)
                      }
                      disabled={busy}
                      style={qtyInput}
                    />
                  </label>
                )}
              </label>
            </li>
          );
        })}
      </ul>

      <div style={summaryBar}>
        <div style={{ fontSize: "0.95rem" }}>
          {selectedCount === 0
            ? "Pick at least one product."
            : `${selectedCount} item${selectedCount === 1 ? "" : "s"} · ${currency} ${total.toFixed(2)} (first payment only)`}
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            onClick={() => startCheckout("hosted")}
            disabled={busy || selectedCount === 0}
            style={btnPrimary}
          >
            {busy ? "…" : "Buy (hosted redirect)"}
          </button>
          <button
            onClick={() => startCheckout("iframe")}
            disabled={busy || selectedCount === 0}
            style={btnSecondary}
          >
            {busy ? "…" : "Buy (iframe)"}
          </button>
        </div>
      </div>

      {iframeOpen && (
        <div style={frameWrapper} data-cope-frame>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <strong>Embedded checkout</strong>
            <button
              type="button"
              onClick={() => {
                mountedRef.current?.destroy();
                mountedRef.current = null;
                setIframeOpen(false);
                setStatus(null);
              }}
              style={btnGhost}
            >
              Close
            </button>
          </div>
          <div id="catalog-checkout-frame" style={frameTarget} />
        </div>
      )}

      {status && (
        <div
          style={{
            marginTop: "0.5rem",
            fontSize: "0.9rem",
            color:
              status.kind === "err"
                ? "#dc2626"
                : status.kind === "ok"
                  ? "#059669"
                  : "#6b7280",
          }}
        >
          {status.message}
        </div>
      )}
    </div>
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

const list: React.CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  display: "grid",
  gap: "0.5rem",
};

const row: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  background: "#fff",
  borderRadius: 10,
  padding: "0.75rem 1rem",
};

const rowSelected: React.CSSProperties = {
  ...row,
  borderColor: "#2563eb",
  background: "#eff6ff",
};

const labelRow: React.CSSProperties = {
  display: "flex",
  gap: "0.75rem",
  cursor: "pointer",
  alignItems: "flex-start",
};

const titleRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: "1rem",
};

const priceTag: React.CSSProperties = {
  color: "#2563eb",
  fontWeight: 500,
  fontSize: "0.95rem",
};

const metaRow: React.CSSProperties = {
  marginTop: "0.25rem",
  display: "flex",
  gap: "0.5rem",
  alignItems: "center",
  fontSize: "0.8rem",
  color: "#9ca3af",
  flexWrap: "wrap",
};

const qtyInput: React.CSSProperties = {
  display: "block",
  marginTop: "0.25rem",
  padding: "0.3rem 0.4rem",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontFamily: "inherit",
  fontSize: "0.9rem",
  width: 60,
};

const summaryBar: React.CSSProperties = {
  marginTop: "1rem",
  padding: "0.75rem 1rem",
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "1rem",
  flexWrap: "wrap",
};

const btnPrimary: React.CSSProperties = {
  background: "#2563eb",
  color: "#fff",
  border: 0,
  borderRadius: 8,
  padding: "0.55rem 1rem",
  fontSize: "0.95rem",
  fontWeight: 500,
  cursor: "pointer",
};

const btnSecondary: React.CSSProperties = {
  ...btnPrimary,
  background: "#fff",
  color: "#2563eb",
  border: "1px solid #2563eb",
};

const btnGhost: React.CSSProperties = {
  background: "transparent",
  color: "#6b7280",
  border: 0,
  cursor: "pointer",
  fontSize: "0.85rem",
};

const frameWrapper: React.CSSProperties = {
  marginTop: "1rem",
  padding: "0.75rem",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  background: "#fff",
};

const frameTarget: React.CSSProperties = {
  width: "100%",
  minHeight: "min(600px, 90vh)",
};

const emptyState: React.CSSProperties = {
  marginTop: "1.5rem",
  padding: "1rem 1.25rem",
  background: "#f9fafb",
  border: "1px dashed #d1d5db",
  borderRadius: 10,
  color: "#6b7280",
};
