"use client";

import { useState } from "react";
import { CopeCart } from "@copecart/sdk";
import type { PublicEnvConfig } from "@/lib/cope-env";

type Status = { message: string; kind: "" | "ok" | "err" };

export function IframeCheckoutClient({ env }: { env: PublicEnvConfig }) {
  const [currency, setCurrency] = useState(env.defaultCurrency);
  const [busy, setBusy] = useState(false);
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);

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
      const cope = new CopeCart({
        publishableKey: env.publishableKey,
        baseUrl: env.apiBase,
        checkoutBaseUrl: env.checkoutBase,
      });

      // SDK 0.1.x requires plan_id on addLine; default to the product's first
      // payment plan. Vendors with multiple plans would normally let the buyer
      // pick before adding to cart.
      const product = await cope.getProduct(env.productUuid);
      const planId = product.payment_plans[0]?.id;
      if (planId === undefined) {
        throw new Error(
          `Product ${env.productUuid} has no payment plans. Add one in the dashboard.`,
        );
      }

      const cart = await cope.createCart({ currency });
      await cope.addLine(cart.id, {
        product_id: env.productUuid,
        plan_id: planId,
        quantity: 1,
      });

      setStatus({ message: "Creating checkout…", kind: "" });
      // `embed_origin` MUST match the page hosting this iframe. COPE uses it
      // as a frame-ancestors CSP allow-list — wrong origin → blank iframe.
      // SDK 0.1.x CheckoutPayload type doesn't list embed_origin yet (it's
      // accepted by the API), so we widen the type at the call site.
      const checkoutPayload = {
        embed_origin: window.location.origin,
        success_url: `${window.location.origin}/thank-you`,
        cancel_url: `${window.location.origin}/iframe-checkout`,
        consents: [{ type: "terms-of-purchase", version: "1.0" }],
      };
      const checkout = await cope.checkout(
        cart.id,
        checkoutPayload as Parameters<typeof cope.checkout>[1],
      );

      setIframeUrl(checkout.checkoutUrl);
      setStatus({ message: "Checkout loaded.", kind: "ok" });
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
          {iframeUrl ? (
            <iframe
              src={iframeUrl}
              style={iframeStyle}
              allow="payment *; clipboard-write"
              title="COPE checkout"
            />
          ) : (
            <div style={placeholder}>Checkout will load here.</div>
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

// SDK 0.1.1 doesn't expose mountCheckout(); we render the iframe directly
// with checkout.checkoutUrl. Container needs real dimensions or the iframe
// collapses and the buyer sees nothing.
const iframeStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 600,
  border: 0,
  borderRadius: 8,
  background: "#f9fafb",
};

const placeholder: React.CSSProperties = {
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
