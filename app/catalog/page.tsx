import Link from "next/link";
import { getServerEnvConfig, toPublicConfig } from "@/lib/cope-env";
import { fetchCatalog } from "@/lib/cope-catalog";
import { CatalogClient } from "./CatalogClient";

export const metadata = {
  title: "Products — COPE Integration Samples",
};

// Env vars + catalog fetch happen at request time — see comment in app/page.tsx.
export const dynamic = "force-dynamic";

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const env = getServerEnvConfig();
  const params = await searchParams;
  const page = parsePage(params.page);
  const { products, pagination, warning } = await fetchCatalog(env, page);

  return (
    <main className="cope-container">
      <Link href="/" className="cope-back-link">
        ← Back
      </Link>
      <h1 className="cope-h1" style={{ marginTop: "0.75rem" }}>
        Products
      </h1>
      <p className="cope-lead">
        Server-side fetches the vendor&apos;s products from{" "}
        <code className="cope-inline">GET /v1/commerce/products</code> using the
        secret API key. Buyer picks one or more, then chooses hosted or iframe
        checkout. Both flows create one cart with all selected lines.
      </p>

      {warning && <div className="cope-banner cope-banner--warning">{warning}</div>}

      <CatalogClient env={toPublicConfig(env)} products={products} />

      {pagination.totalPages > 1 && (
        <nav aria-label="Catalog pagination" className="cope-pagination">
          <PageLink
            page={pagination.currentPage - 1}
            disabled={pagination.currentPage <= 1}
            label="← Previous"
          />
          <span className="cope-subtle">
            Page {pagination.currentPage} of {pagination.totalPages}
            <span style={{ color: "var(--cope-text-subtle)" }}>
              {" · "}
              {pagination.totalCount} active product
              {pagination.totalCount === 1 ? "" : "s"}
            </span>
          </span>
          <PageLink
            page={pagination.currentPage + 1}
            disabled={pagination.currentPage >= pagination.totalPages}
            label="Next →"
          />
        </nav>
      )}

      <section className="cope-section">
        <p className="cope-section-label">What the code does</p>
        <pre className="cope-code">
{`// Server (this page):
const res = await fetch(\`\${apiBase}/v1/commerce/products\`, {
  headers: { Authorization: \`Bearer \${COPE_API_KEY}\` },
})

// Client (after buyer picks N products):
const cart = await cope.createCart({ currency })
for (const p of selected) {
  await cope.addLine(cart.id, { product_id: p.uuid, quantity: p.qty })
}
const checkout = await cope.checkout(cart.id, { consents })
cope.redirectToCheckout(checkout)               // hosted style
// — or —
cope.mountCheckout("#frame", checkout, {...})   // iframe style`}
        </pre>
        <p className="cope-muted" style={{ fontSize: "0.92rem", marginTop: "0.75rem" }}>
          <strong>Critical:</strong> the API key (
          <code className="cope-inline">cope_sk_*</code>) is server-only — never
          expose it to the browser. The publishable key (
          <code className="cope-inline">cope_pk_*</code>) is what flows into the
          SDK in the client component.
        </p>
      </section>
    </main>
  );
}

function parsePage(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const n = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function PageLink({
  page,
  disabled,
  label,
}: {
  page: number;
  disabled: boolean;
  label: string;
}) {
  const safePage = Math.max(1, page);
  const target = safePage === 1 ? "/catalog" : `/catalog?page=${safePage}`;
  const className = disabled
    ? "cope-page-link cope-page-link--disabled"
    : "cope-page-link";
  if (disabled) {
    return <span className={className}>{label}</span>;
  }
  return (
    <Link href={target} className={className} prefetch={false}>
      {label}
    </Link>
  );
}
