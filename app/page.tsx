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
    <main className="cope-container cope-container--narrow">
      <span className="cope-eyebrow">Sample integration</span>
      <h1 className="cope-h1">
        Sell with <span className="cope-gradient-text">COPE</span> in a
        Next.js app.
      </h1>
      <p className="cope-lead">
        One reference app showing the two pieces a real vendor needs: a
        multi-product catalog that drives buyers into hosted <em>or</em>{" "}
        embedded checkout, plus a signed webhook receiver that authoritatively
        confirms payment.
      </p>

      <section className="cope-card-grid">
        <Link href="/catalog" className="cope-card">
          <h2 className="cope-card-title">
            Products
            <span className="arrow" aria-hidden>
              →
            </span>
          </h2>
          <p className="cope-card-body">
            Server-side <code className="cope-inline">GET /v1/commerce/products</code>{" "}
            renders the vendor&apos;s product list. Buyer picks one or more +
            quantities, then chooses <strong>hosted redirect</strong> or{" "}
            <strong>iframe embed</strong>. Same cart, two checkout styles.
          </p>
        </Link>

        <div className="cope-card">
          <h2 className="cope-card-title">Webhook receiver</h2>
          <p className="cope-card-body">
            <code className="cope-inline">POST /api/webhooks/cope</code> with
            HMAC verification, replay-window check, dedupe, and per-event
            handlers. This is the <em>authoritative</em> signal that a payment
            succeeded.
          </p>
          <p className="cope-card-body">
            Test it:{" "}
            <code className="cope-inline">
              curl -X POST{" "}
              {process.env.NODE_ENV === "production"
                ? ""
                : "http://localhost:4000"}
              /api/webhooks/cope
            </code>
          </p>
        </div>
      </section>

      <section className="cope-section">
        <p className="cope-section-label">Active environment</p>
        <pre className="cope-code">
          {`COPE_API_BASE      = ${env.apiBase}
COPE_CHECKOUT_BASE = ${env.checkoutBase}
PUBLIC_BASE_URL    = ${env.publicBaseUrl}`}
        </pre>
        <p className="cope-subtle" style={{ marginTop: "0.6rem" }}>
          Configure via <code className="cope-inline">.env</code>. See{" "}
          <code className="cope-inline">.env.example</code> for the full list of
          variables.
        </p>
      </section>
    </main>
  );
}
