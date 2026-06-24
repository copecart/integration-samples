import Link from "next/link";

export const metadata = {
  title: "Thank you — COPE Integration Samples",
};

export default async function ThankYouPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== "",
  );

  return (
    <main className="cope-container cope-container--center">
      <div className="cope-success-badge" aria-hidden>
        ✓
      </div>
      <h1 className="cope-h1" style={{ marginTop: 0 }}>
        Thank you!
      </h1>
      <p className="cope-lead" style={{ marginInline: "auto" }}>
        Your payment was successful.
      </p>

      <dl className="cope-params">
        {entries.length === 0 ? (
          <>
            <dt>No query params</dt>
            <dd>(you arrived here directly)</dd>
          </>
        ) : (
          entries.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{String(v)}</dd>
            </div>
          ))
        )}
      </dl>

      <Link href="/" className="cope-btn cope-btn--primary">
        Back to samples
      </Link>

      <div
        className="cope-banner cope-banner--warning"
        style={{ marginTop: "1.5rem", textAlign: "left" }}
      >
        <span>
          <strong>Do not grant access on this page.</strong> The{" "}
          <code className="cope-inline">order_uuid</code> in the URL is a UX
          convenience — anyone can craft a fake one. Rely on the signed{" "}
          <code className="cope-inline">payment.sale.succeeded</code> webhook
          delivered to <code className="cope-inline">/api/webhooks/cope</code>{" "}
          to update your database.
        </span>
      </div>
    </main>
  );
}
