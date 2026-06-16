"use client";

import { useEffect, useRef, useState } from "react";
import { CopeCart } from "@copecart/sdk";
import type { PublicEnvConfig } from "@/lib/cope-env";

type Status = { message: string; kind: "" | "ok" | "err" };

export function IframeCheckoutClient({ env }: { env: PublicEnvConfig }) {
  const [currency, setCurrency] = useState(env.defaultCurrency);
  const [busy, setBusy] = useState(false);
  const [mountedOnce, setMountedOnce] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  // Hold the mounted-checkout handle so we can destroy() before re-mounting,
  // and on unmount.
  const mountedRef = useRef<{ destroy: () => void } | null>(null);
  useEffect(
    () => () => {
      mountedRef.current?.destroy();
    },
    [],
  );

  async function start() {
    if (!env.publishableKey || !env.productUuid) {
      setStatus({
        message:
          "Server is missing COPE_PUBLISHABLE_KEY or COPE_PRODUCT_UUID — set them in .env and restart.",
        kind: "err",
      });
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
      // plan_id is optional in SDK 0.2+ — the API picks the product's default
      // payment plan when omitted. A vendor with multiple plans (one-time vs
      // subscription, etc.) would let the buyer pick one and pass it here.
      await cope.addLine(cart.id, {
        product_id: env.productUuid,
        quantity: 1,
      });

      setStatus({ message: "Creating checkout…", kind: "" });
      // `embed_origin` MUST match the page hosting this iframe. COPE uses it
      // for the per-business `frame-ancestors` CSP allow-list — wrong origin
      // → CSP blocks the iframe with `frame-ancestors 'none'` and the buyer
      // sees Chrome's "<host> refused to connect" error.
      const checkout = await cope.checkout(cart.id, {
        embed_origin: window.location.origin,
        success_url: `${window.location.origin}/thank-you`,
        cancel_url: `${window.location.origin}/iframe-checkout`,
        consents: [{ type: "terms-of-purchase", version: "1.0" }],
      });

      // mountCheckout uses checkout.embedCheckoutUrl internally (a dedicated
      // /checkout/embed/<token> route with dynamic frame-ancestors). It
      // performs a postMessage handshake before reporting `onReady` — until
      // then the iframe is hidden. `fallback: "redirect"` sends the buyer to
      // hosted checkout if the handshake never lands (CSP block, network
      // failure) instead of leaving them stuck on a blank box.
      mountedRef.current = cope.mountCheckout("#checkout-frame", checkout, {
        fallback: "redirect",
        onReady: () => {
          setStatus({ message: "Checkout loaded.", kind: "ok" });
          setMountedOnce(true);
        },
        onSuccess: () => {
          // Don't grant access from this callback either — the webhook is the
          // authoritative signal. This redirect is just user-friendly UX.
          setStatus({
            message: "Payment completed. Redirecting…",
            kind: "ok",
          });
          setTimeout(() => {
            window.location.href = `/thank-you`;
          }, 600);
        },
        onCancel: () =>
          setStatus({ message: "Buyer cancelled.", kind: "" }),
        onError: ({ code, retryable }) =>
          setStatus({
            message: `Checkout error: ${code}${retryable ? " (retryable)" : ""}`,
            kind: "err",
          }),
        onTerminal: ({ status }) =>
          // Buyer left the checkout in a non-success terminal state
          // (e.g. session expired). Log so on-call sees it; on the page we
          // just clear the busy spinner.
          console.log(`[mountCheckout] terminal: ${status}`),
        onFallbackRedirect: () =>
          setStatus({
            message: "Embed handshake didn't complete; redirecting to hosted checkout.",
            kind: "err",
          }),
      });
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : String(err);
      setStatus({ message: `Error: ${message}`, kind: "err" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: "1.5rem" }}>
      <div style={layout}>
        <div style={panel}>
          <h2 style={{ margin: "0 0 0.5rem", fontSize: "1.05rem" }}>
            Sample Course
          </h2>
          <p style={{ margin: "0 0 1rem", color: "#6b7280", fontSize: "0.9rem" }}>
            Product <code>{env.productUuid || "(not configured)"}</code>.
            Clicking <em>Start Checkout</em> mounts the payment form on the
            right.
          </p>
          <label style={{ fontSize: "0.85rem", color: "#6b7280" }}>
            Currency
            <input
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              style={input}
            />
          </label>
          <button onClick={start} disabled={busy} style={button}>
            {busy ? "…" : "Start Checkout"}
          </button>
        </div>

        <div style={panel}>
          <h2 style={{ margin: "0 0 0.5rem", fontSize: "1.05rem" }}>Payment</h2>
          <div id="checkout-frame" style={frame}>
            {mountedOnce ? null : "Checkout will load here."}
          </div>
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
      </div>
    </div>
  );
}

const layout: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "1.5rem",
};

const panel: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  background: "#fff",
  borderRadius: 12,
  padding: "1.25rem",
};

// SDK mountCheckout inserts the iframe inside this container. Needs real
// dimensions or the iframe collapses to 0×0 (the SDK doesn't try to expand
// the parent).
const frame: React.CSSProperties = {
  width: "100%",
  minHeight: 600,
  background: "#f9fafb",
  borderRadius: 8,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#9ca3af",
};

const input: React.CSSProperties = {
  display: "block",
  marginTop: "0.25rem",
  padding: "0.4rem 0.6rem",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontFamily: "inherit",
  fontSize: "0.9rem",
  width: 80,
};

const button: React.CSSProperties = {
  marginTop: "1rem",
  background: "#2563eb",
  color: "#fff",
  border: 0,
  borderRadius: 8,
  padding: "0.65rem 1.25rem",
  fontSize: "1rem",
  fontWeight: 500,
  cursor: "pointer",
};
