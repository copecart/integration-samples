/**
 * Server-only fetcher for the vendor's product catalog.
 *
 * Hits `GET {apiBase}/v1/commerce/products` with the secret API key
 * (`cope_sk_live_*` / `cope_sk_test_*`). Returns a flattened, browser-safe
 * view containing only what the catalog UI needs — no secrets, no internal
 * IDs. The secret key never leaves the server.
 */

import type { CopeEnvConfig } from "./cope-env";

/** Slim view of a catalog product, safe to pass to client components. */
export interface CatalogProduct {
  readonly uuid: string;
  readonly name: string;
  readonly headline: string | null;
  readonly currency: string;
  readonly productType: string;
  /**
   * The product's default payment plan (one-time / subscription / installment),
   * pre-resolved server-side so the client doesn't need to pick. Vendors with
   * multi-plan products that want a "choose plan" UI would expose all plans
   * instead — out of scope for the sample.
   */
  readonly defaultPlan: CatalogPaymentPlan | null;
  readonly imageUrl: string | null;
}

export interface CatalogPaymentPlan {
  readonly id: number;
  readonly planType: "one_time" | "subscription" | "installment";
  readonly currency: string;
  readonly displayName: string | null;
  /** Decimal string in major units (e.g. "24.99"), straight from the API. */
  readonly firstPaymentAmount: string;
  readonly nextPaymentsAmount: string | null;
  readonly intervalCount: number | null;
  readonly interval: "day" | "week" | "month" | "year" | null;
}

export interface CatalogFetchResult {
  readonly products: readonly CatalogProduct[];
  readonly pagination: CatalogPagination;
  readonly warning: string | null;
}

export interface CatalogPagination {
  readonly currentPage: number;
  readonly perPage: number;
  readonly totalPages: number;
  readonly totalCount: number;
}

interface RawProduct {
  id?: string;
  uuid?: string;
  name?: string;
  headline?: string | null;
  currency?: string;
  product_type?: string;
  approval_status?: string;
  status?: string;
  images?: ReadonlyArray<{ image_url?: string }>;
  payment_plans?: ReadonlyArray<RawPlan>;
}

interface RawPagination {
  current_page?: number;
  per_page?: number;
  total_pages?: number;
  total_count?: number;
}

interface RawPlan {
  id?: number;
  plan_type?: string;
  position?: number;
  currency?: string;
  display_name?: string | null;
  first_payment_amount_cents?: string;
  next_payments_amount_cents?: string | null;
  interval_count?: number | null;
  interval?: string | null;
}

export const CATALOG_PAGE_SIZE = 12;

const EMPTY_PAGINATION: CatalogPagination = {
  currentPage: 1,
  perPage: CATALOG_PAGE_SIZE,
  totalPages: 0,
  totalCount: 0,
};

/**
 * Fetches one page of saleable products. Pagination is URL-driven: pass `page`
 * via search params, render the result, surface the metadata for navigation.
 * Returns an empty list (with a `warning`) instead of throwing when the API
 * key is unset — that way the catalog page can render a "configure
 * COPE_API_KEY" message instead of a 500.
 */
export async function fetchCatalog(
  env: CopeEnvConfig,
  page = 1,
): Promise<CatalogFetchResult> {
  if (!env.apiKey) {
    return {
      products: [],
      pagination: EMPTY_PAGINATION,
      warning: "Server is missing COPE_API_KEY — set it in .env and restart.",
    };
  }

  const safePage = Math.max(1, Math.floor(page) || 1);
  const url = `${env.commerceApiBase}/v1/commerce/products?per_page=${CATALOG_PAGE_SIZE}&page=${safePage}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${env.apiKey}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
  } catch (err) {
    return {
      products: [],
      pagination: { ...EMPTY_PAGINATION, currentPage: safePage },
      warning: `Network error fetching catalog from ${env.commerceApiBase}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!res.ok) {
    const requestId = res.headers.get("x-request-id");
    return {
      products: [],
      pagination: { ...EMPTY_PAGINATION, currentPage: safePage },
      warning: `Products request failed: HTTP ${res.status}${requestId ? ` (request ${requestId})` : ""}. Check that COPE_API_KEY has the commerce:products:read scope.`,
    };
  }

  const body = (await res.json()) as { data?: RawProduct[]; pagination?: RawPagination };
  const rawList = Array.isArray(body.data) ? body.data : [];

  const products = rawList
    .filter(isSaleable)
    .map(toCatalogProduct)
    .filter((p): p is CatalogProduct => p !== null);

  return {
    products,
    pagination: normalizePagination(body.pagination, safePage),
    warning: null,
  };
}

/**
 * Strict gate: both flags must be exactly "active" + "approved". An empty or
 * unknown value drops the product. Vendors sometimes leave draft / archived /
 * pending-approval items in their catalog — those should never show up to a
 * buyer because checkout would reject them with `not_saleable`.
 */
function isSaleable(p: RawProduct): boolean {
  return (
    (p.status ?? "").toLowerCase() === "active" &&
    (p.approval_status ?? "").toLowerCase() === "approved"
  );
}

function normalizePagination(raw: RawPagination | undefined, fallbackPage: number): CatalogPagination {
  return {
    currentPage: raw?.current_page ?? fallbackPage,
    perPage: raw?.per_page ?? CATALOG_PAGE_SIZE,
    totalPages: raw?.total_pages ?? 0,
    totalCount: raw?.total_count ?? 0,
  };
}

function toCatalogProduct(p: RawProduct): CatalogProduct | null {
  // The Commerce API uses `id` as the public-facing identifier (string, prefixed),
  // which is the same string the Cart API expects as `product_id`. Some response
  // shapes also expose `uuid` — accept either to stay forward-compatible.
  const uuid = p.id ?? p.uuid;
  if (!uuid || !p.name) return null;

  const defaultPlan = pickDefaultPlan(p.payment_plans ?? []);
  const imageUrl = p.images?.[0]?.image_url ?? null;

  return {
    uuid,
    name: p.name,
    headline: p.headline ?? null,
    currency: (p.currency ?? defaultPlan?.currency ?? "USD").toUpperCase(),
    productType: p.product_type ?? "digital",
    defaultPlan,
    imageUrl,
  };
}

function pickDefaultPlan(plans: ReadonlyArray<RawPlan>): CatalogPaymentPlan | null {
  if (plans.length === 0) return null;
  // The API returns plans in display order; `position` confirms it. Vendor's
  // first plan is what shows on the public product page, so we mirror that.
  const sorted = [...plans].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const first = sorted[0];
  if (!first || typeof first.id !== "number" || !first.first_payment_amount_cents) {
    return null;
  }
  return {
    id: first.id,
    planType: normalizePlanType(first.plan_type),
    currency: (first.currency ?? "USD").toUpperCase(),
    displayName: first.display_name ?? null,
    firstPaymentAmount: first.first_payment_amount_cents,
    nextPaymentsAmount: first.next_payments_amount_cents ?? null,
    intervalCount: first.interval_count ?? null,
    interval: normalizeInterval(first.interval),
  };
}

function normalizePlanType(value: string | undefined): CatalogPaymentPlan["planType"] {
  if (value === "subscription" || value === "installment") return value;
  return "one_time";
}

function normalizeInterval(value: string | null | undefined): CatalogPaymentPlan["interval"] {
  if (value === "day" || value === "week" || value === "month" || value === "year") {
    return value;
  }
  return null;
}
