import Link from "next/link";
import { getServerEnvConfig } from "@/lib/cope-env";

export default function Home() {
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
      <h1 style={{ fontSize: "1.75rem", marginBottom: "0.25rem" }}>
        COPE Integration Samples
      </h1>
      <p style={{ color: "#6b7280", marginTop: 0 }}>
        One Next.js app showing the three pieces a real vendor needs: a hosted
        checkout flow, an embedded iframe checkout, and a signed webhook
        receiver that authoritatively confirms payment.
      </p>

      <section style={cardGrid}>
        <Link href="/hosted-checkout" style={card}>
          <h2 style={cardTitle}>Hosted Checkout →</h2>
          <p style={cardBody}>
            Redirect buyers to <code>checkout.cope.com</code>. The buyer pays on
            COPE&apos;s domain, then comes back to <code>/thank-you</code>.
            Simplest possible integration.
          </p>
        </Link>

        <Link href="/iframe-checkout" style={card}>
          <h2 style={cardTitle}>Iframe Checkout →</h2>
          <p style={cardBody}>
            Mount the COPE checkout inside an <code>&lt;iframe&gt;</code> on
            your domain. Buyer&apos;s URL bar never changes — better for
            in-app upsells and dashboard flows.
          </p>
        </Link>

        <div style={cardStatic}>
          <h2 style={cardTitle}>Webhook receiver</h2>
          <p style={cardBody}>
            <code>POST /api/webhooks/cope</code> with HMAC verification,
            replay-window check, dedupe, and per-event handlers. This is the{" "}
            <em>authoritative</em> signal that a payment succeeded.
          </p>
          <p style={cardBody}>
            Test it:{" "}
            <code>
              curl -X POST {process.env.NODE_ENV === "production" ? "" : "http://localhost:4000"}
              /api/webhooks/cope
            </code>
          </p>
        </div>
      </section>

      <section style={{ marginTop: "2.5rem" }}>
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>
          Active environment
        </h2>
        <pre style={pre}>
          {`COPE_ENV          = ${env.name}
COPE_API_BASE     = ${env.apiBase}
COPE_CHECKOUT_BASE = ${env.checkoutBase}
PUBLIC_BASE_URL   = ${env.publicBaseUrl}`}
        </pre>
        <p style={{ color: "#6b7280", fontSize: "0.9rem" }}>
          Configure via <code>.env</code>. See <code>.env.example</code> for the
          full list of variables.
        </p>
      </section>
    </main>
  );
}

const cardGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: "1rem",
  marginTop: "1.5rem",
};

const card: React.CSSProperties = {
  display: "block",
  border: "1px solid #e5e7eb",
  background: "#fff",
  borderRadius: 12,
  padding: "1.25rem",
  textDecoration: "none",
  color: "inherit",
};

const cardStatic: React.CSSProperties = { ...card, cursor: "default" };

const cardTitle: React.CSSProperties = {
  fontSize: "1.1rem",
  margin: "0 0 0.4rem",
  color: "#2563eb",
};

const cardBody: React.CSSProperties = {
  margin: "0.25rem 0",
  fontSize: "0.95rem",
  color: "#374151",
};

const pre: React.CSSProperties = {
  background: "#f3f4f6",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: "0.75rem 1rem",
  fontSize: "0.85rem",
  overflow: "auto",
};
