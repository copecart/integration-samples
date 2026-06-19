import Link from "next/link";
import { getServerEnvConfig, toPublicConfig } from "@/lib/cope-env";
import { fetchCatalog } from "@/lib/cope-catalog";
import { CatalogClient } from "./CatalogClient";

export const metadata = {
  title: "Catalog — COPE Integration Samples",
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
    <main
      style={{
        maxWidth: 1000,
        margin: "clamp(1.5rem, 5vw, 3rem) auto",
        padding: "0 clamp(0.75rem, 3vw, 1.5rem)",
        lineHeight: 1.55,
      }}
    >
      <a href="/" style={{ fontSize: "0.85rem", color: "#6b7280" }}>
        ← Back
      </a>
      <h1 style={{ fontSize: "clamp(1.25rem, 3.5vw, 1.6rem)", margin: "0.5rem 0 0.25rem" }}>
        Catalog (multi-product)
      </h1>
      <p style={{ color: "#6b7280", marginTop: 0 }}>
        Server-side fetches the vendor's products from{" "}
        <code>GET /v1/commerce/products</code> using the secret API key. Buyer
        picks one or more, then chooses hosted or iframe checkout. Both flows
        create one cart with all selected lines.
      </p>

      {warning && (
        <div
          style={{
            background: "#fef3c7",
            border: "1px solid #fcd34d",
            color: "#92400e",
            borderRadius: 8,
            padding: "0.75rem 1rem",
            margin: "1rem 0",
            fontSize: "0.9rem",
          }}
        >
          {warning}
        </div>
      )}

      <CatalogClient env={toPublicConfig(env)} products={products} />

      {pagination.totalPages > 1 && (
        <nav aria-label="Catalog pagination" style={paginationBar}>
          <PageLink
            page={pagination.currentPage - 1}
            disabled={pagination.currentPage <= 1}
            label="← Previous"
          />
          <span style={{ color: "#6b7280", fontSize: "0.9rem" }}>
            Page {pagination.currentPage} of {pagination.totalPages}
            <span style={{ color: "#9ca3af" }}>
              {" "}
              · {pagination.totalCount} active product
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

      <section style={{ marginTop: "2rem", color: "#6b7280", fontSize: "0.9rem" }}>
        <h2 style={{ fontSize: "1rem", color: "#111827" }}>What the code does</h2>
        <pre style={pre}>
{`// Server (this page):
const res = await fetch(\`\${apiBase}/v1/commerce/products\`, {
  headers: { Authorization: \`Bearer \${COPE_API_KEY}\` },
})

// Client (after buyer picks N products):
const cart = await cope.createCart({ currency })
for (const p of selected) {
  await cope.addLine(cart.id, { product_id: p.uuid, quantity: p.qty })
}
const checkout = await cope.checkout(cart.id, { success_url, cancel_url, consents })
cope.redirectToCheckout(checkout)   // hosted style
// — or —
cope.mountCheckout("#frame", checkout, {...})   // iframe style`}
        </pre>
        <p>
          <strong>Critical:</strong> the API key (<code>cope_sk_*</code>) is
          server-only — never expose it to the browser. The publishable key
          (<code>cope_pk_*</code>) is what flows into the SDK in the client
          component.
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
  if (disabled) {
    return <span style={pageLinkDisabled}>{label}</span>;
  }
  return (
    <Link href={target} style={pageLink} prefetch={false}>
      {label}
    </Link>
  );
}

const paginationBar: React.CSSProperties = {
  marginTop: "1.5rem",
  padding: "0.75rem 1rem",
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "1rem",
  flexWrap: "wrap",
};

const pageLink: React.CSSProperties = {
  color: "#2563eb",
  textDecoration: "none",
  padding: "0.4rem 0.8rem",
  border: "1px solid #2563eb",
  borderRadius: 8,
  fontSize: "0.9rem",
};

const pageLinkDisabled: React.CSSProperties = {
  color: "#9ca3af",
  padding: "0.4rem 0.8rem",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  fontSize: "0.9rem",
  cursor: "not-allowed",
};

const pre: React.CSSProperties = {
  background: "#f3f4f6",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: "0.75rem 1rem",
  fontSize: "0.8rem",
  overflow: "auto",
  color: "#111827",
};
