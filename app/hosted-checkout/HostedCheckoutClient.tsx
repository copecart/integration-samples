"use client";

import { useState } from "react";
import { CopeCart } from "@copecart/sdk";
import type { PublicEnvConfig } from "@/lib/cope-env";

export function HostedCheckoutClient({ env }: { env: PublicEnvConfig }) {
  const [currency, setCurrency] = useState(env.defaultCurrency);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ message: string; isError: boolean } | null>(
    null,
  );

  async function startCheckout() {
    if (!env.publishableKey || !env.productUuid) {
      setStatus({
        message:
          "Server is missing COPE_PUBLISHABLE_KEY or COPE_PRODUCT_UUID — set them in .env and restart.",
        isError: true,
      });
      return;
    }

    setBusy(true);
    setStatus({ message: "Creating cart…", isError: false });

    try {
      const cope = new CopeCart({
        publishableKey: env.publishableKey,
        baseUrl: env.apiBase,
        checkoutBaseUrl: env.checkoutBase,
      });

      const cart = await cope.createCart({ currency });
      // plan_id is optional — the API picks the product's default plan when
      // omitted. Vendors with multiple plans (one-time vs subscription, etc.)
      // would let the buyer pick and pass it here explicitly.
      await cope.addLine(cart.id, {
        product_id: env.productUuid,
        quantity: 1,
      });

      setStatus({ message: "Creating checkout…", isError: false });
      const checkout = await cope.checkout(cart.id, {
        success_url: `${env.publicBaseUrl}/thank-you`,
        cancel_url: `${env.publicBaseUrl}/hosted-checkout`,
        consents: [{ type: "terms-of-purchase", version: "1.0" }],
      });

      cope.redirectToCheckout(checkout);
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : String(err);
      setStatus({ message: `Error: ${message}`, isError: true });
      setBusy(false);
    }
  }

  return (
    <div style={card}>
      <div style={{ display: "flex", gap: "1rem", alignItems: "flex-end" }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: "0 0 0.25rem" }}>Sample Course</h2>
          <p style={{ margin: 0, color: "#6b7280", fontSize: "0.9rem" }}>
            Product <code>{env.productUuid || "(not configured)"}</code> on{" "}
            env <strong>{env.name}</strong>. Final price shown on the next page.
          </p>
        </div>
        <label style={{ fontSize: "0.85rem", color: "#6b7280" }}>
          Currency
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            style={input}
          />
        </label>
        <button onClick={startCheckout} disabled={busy} style={button}>
          {busy ? "…" : "Buy Now"}
        </button>
      </div>

      {status && (
        <div
          style={{
            marginTop: "0.75rem",
            fontSize: "0.9rem",
            color: status.isError ? "#dc2626" : "#6b7280",
          }}
        >
          {status.message}
        </div>
      )}
    </div>
  );
}

const card: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  background: "#fff",
  borderRadius: 12,
  padding: "1.25rem",
  marginTop: "1.5rem",
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
  background: "#2563eb",
  color: "#fff",
  border: 0,
  borderRadius: 8,
  padding: "0.65rem 1.25rem",
  fontSize: "1rem",
  fontWeight: 500,
  cursor: "pointer",
};
