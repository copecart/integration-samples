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
    <main
      style={{
        maxWidth: 560,
        margin: "5rem auto",
        padding: "2rem",
        textAlign: "center",
        lineHeight: 1.6,
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          margin: "0 auto 1rem",
          borderRadius: "50%",
          background: "#d1fae5",
          color: "#047857",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "2rem",
        }}
      >
        ✓
      </div>
      <h1 style={{ fontSize: "1.6rem", margin: "0.5rem 0" }}>Thank you!</h1>
      <p style={{ color: "#4b5563" }}>Your payment was successful.</p>

      <dl
        style={{
          textAlign: "left",
          background: "#f9fafb",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: "1rem",
          margin: "1.5rem 0",
          fontSize: "0.9rem",
        }}
      >
        {entries.length === 0 ? (
          <>
            <dt style={{ fontWeight: 600, color: "#6b7280" }}>No query params</dt>
            <dd style={{ margin: 0, fontFamily: "monospace" }}>
              (you arrived here directly)
            </dd>
          </>
        ) : (
          entries.map(([k, v]) => (
            <div key={k}>
              <dt style={{ fontWeight: 600, color: "#6b7280" }}>{k}</dt>
              <dd
                style={{
                  margin: "0 0 0.5rem",
                  fontFamily: "monospace",
                  wordBreak: "break-all",
                }}
              >
                {String(v)}
              </dd>
            </div>
          ))
        )}
      </dl>

      <Link
        href="/"
        style={{
          display: "inline-block",
          marginTop: "1rem",
          padding: "0.5rem 1.25rem",
          background: "#2563eb",
          color: "#fff",
          textDecoration: "none",
          borderRadius: 8,
        }}
      >
        Back to samples
      </Link>

      <p
        style={{
          background: "#fffbeb",
          border: "1px solid #fde68a",
          padding: "0.75rem 1rem",
          borderRadius: 8,
          marginTop: "1.5rem",
          fontSize: "0.9rem",
          color: "#92400e",
          textAlign: "left",
        }}
      >
        <strong>Do not grant access on this page.</strong> The{" "}
        <code>order_uuid</code> in the URL is a UX convenience — anyone can
        craft a fake one. Rely on the signed{" "}
        <code>payment.sale.succeeded</code> webhook delivered to{" "}
        <code>/api/webhooks/cope</code> to update your database.
      </p>
    </main>
  );
}
