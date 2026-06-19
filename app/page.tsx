import Link from "next/link";
import { getServerEnvConfig } from "@/lib/cope-env";

// Render at request time so env vars come from the runtime container, not
// the build-time environment. `next build` in Docker doesn't have access to
// our docker-compose env vars; a static page would bake in empty values and
// show "not configured" even when the runtime env is set correctly.
export const dynamic = "force-dynamic";

export default function Home() {
  const env = getServerEnvConfig();

  return (
    <main style={pageMain}>
      <h1 style={pageTitle}>COPE Integration Samples</h1>
      <p style={{ color: "#6b7280", marginTop: 0 }}>
        One Next.js app showing the two pieces a real vendor needs: a
        multi-product catalog that drives buyers into hosted **or** embedded
        checkout, and a signed webhook receiver that authoritatively confirms
        payment.
      </p>

      <section style={cardGrid}>
        <Link href="/catalog" style={card}>
          <h2 style={cardTitle}>Catalog →</h2>
          <p style={cardBody}>
            Server-side <code>GET /v1/commerce/products</code> renders the
            vendor&apos;s catalog. Buyer picks one or more products +
            quantities, then chooses <strong>hosted redirect</strong> or{" "}
            <strong>iframe embed</strong>. Same cart, two checkout styles.
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

const pageMain: React.CSSProperties = {
  maxWidth: 760,
  margin: "clamp(1.5rem, 5vw, 3rem) auto",
  padding: "0 clamp(0.75rem, 3vw, 1.5rem)",
  lineHeight: 1.55,
};

const pageTitle: React.CSSProperties = {
  fontSize: "clamp(1.35rem, 4vw, 1.75rem)",
  marginBottom: "0.25rem",
};

const cardGrid: React.CSSProperties = {
  display: "grid",
  // Auto-fit collapses to a single column on narrow viewports without a media
  // query: `minmax(min(100%, 280px), 1fr)` clamps each column to ≥280px when
  // there's room, ≤100% of the container when there isn't.
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
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
