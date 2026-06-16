import { getServerEnvConfig, toPublicConfig } from "@/lib/cope-env";
import { HostedCheckoutClient } from "./HostedCheckoutClient";

export const metadata = {
  title: "Hosted Checkout — COPE Integration Samples",
};

// Read env at request time, not build time — see comment in app/page.tsx.
export const dynamic = "force-dynamic";

export default function HostedCheckoutPage() {
  const env = getServerEnvConfig();

  return (
    <main
      style={{
        maxWidth: 720,
        margin: "3rem auto",
        padding: "0 1rem",
        lineHeight: 1.55,
      }}
    >
      <a href="/" style={{ fontSize: "0.85rem", color: "#6b7280" }}>
        ← Back
      </a>
      <h1 style={{ fontSize: "1.6rem", margin: "0.5rem 0 0.25rem" }}>
        Hosted Checkout (redirect)
      </h1>
      <p style={{ color: "#6b7280", marginTop: 0 }}>
        Click <em>Buy Now</em> → browser navigates to <code>checkout.cope.com</code>
        → buyer pays → COPE redirects back to <code>/thank-you</code>. The
        checkout form is fully hosted by COPE; you write zero payment code.
      </p>

      <HostedCheckoutClient env={toPublicConfig(env)} />

      <section style={{ marginTop: "2rem", color: "#6b7280", fontSize: "0.9rem" }}>
        <h2 style={{ fontSize: "1rem", color: "#111827" }}>What the code does</h2>
        <p>The client component runs four SDK calls in sequence:</p>
        <pre style={pre}>
{`const cope = new CopeCart({ publishableKey, baseUrl, checkoutBaseUrl })
const cart = await cope.createCart({ currency })
await cope.addLine(cart.id, { product_id: productUuid, quantity: 1 })
const checkout = await cope.checkout(cart.id, {
  success_url: \`\${PUBLIC_BASE_URL}/thank-you\`,
  cancel_url:  \`\${PUBLIC_BASE_URL}/hosted-checkout\`,
  consents: [{ type: "terms-of-purchase", version: "1.0" }],
})
cope.redirectToCheckout(checkout)`}
        </pre>
        <p>
          <strong>Critical:</strong> the <code>/thank-you</code> page is{" "}
          <em>purely cosmetic</em>. A buyer can navigate there without paying.
          Do not grant access there — use the{" "}
          <code>payment.sale.succeeded</code> webhook at{" "}
          <code>/api/webhooks/cope</code> as the authoritative signal.
        </p>
      </section>
    </main>
  );
}

const pre: React.CSSProperties = {
  background: "#f3f4f6",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: "0.75rem 1rem",
  fontSize: "0.8rem",
  overflow: "auto",
  color: "#111827",
};
