/**
 * Resolves the COPE API + Checkout base URLs from env vars.
 *
 * One sample app, four targetable environments (prod / stg / qa / dpa).
 * Vendors clone, set COPE_ENV, and don't think about URLs again.
 *
 *   - `getServerEnvConfig()` runs in server contexts (RSC / route handlers).
 *   - `getPublicEnvConfig()` is what we serialize into client components so
 *     the SDK in the browser can be pointed at the same env. We only expose
 *     non-secret values (NEXT_PUBLIC_* mirrors).
 */

export type CopeEnvName = "prod" | "stg" | "qa" | "dpa";

export interface CopeEnvConfig {
  readonly name: CopeEnvName;
  readonly apiBase: string;
  readonly checkoutBase: string;
  readonly publicBaseUrl: string;
  readonly publishableKey: string;
  readonly productUuid: string;
  readonly defaultCurrency: string;
}

const PRESETS: Record<CopeEnvName, { apiBase: string; checkoutBase: string }> = {
  prod: { apiBase: "https://api.cope.com",                       checkoutBase: "https://cope.com" },
  stg:  { apiBase: "https://stg.cope-demo.com/gateway/cart_api", checkoutBase: "https://stg.cope-demo.com" },
  qa:   { apiBase: "https://qa.cope-demo.com/gateway/cart_api",  checkoutBase: "https://qa.cope-demo.com" },
  dpa:  { apiBase: "https://dpa.cope-demo.com/gateway/cart_api", checkoutBase: "https://dpa.cope-demo.com" },
};

function resolveEnvName(raw: string | undefined): CopeEnvName {
  const value = (raw ?? "stg").toLowerCase();
  if (value === "prod" || value === "stg" || value === "qa" || value === "dpa") {
    return value;
  }
  throw new Error(
    `COPE_ENV must be one of prod | stg | qa | dpa, got: ${raw}`,
  );
}

export function getServerEnvConfig(): CopeEnvConfig {
  const name = resolveEnvName(process.env.COPE_ENV);
  const preset = PRESETS[name];

  return {
    name,
    apiBase: process.env.COPE_API_BASE ?? preset.apiBase,
    checkoutBase: process.env.COPE_CHECKOUT_BASE ?? preset.checkoutBase,
    publicBaseUrl: resolvePublicBaseUrl(),
    publishableKey: process.env.COPE_PUBLISHABLE_KEY ?? "",
    productUuid: process.env.COPE_PRODUCT_UUID ?? "",
    defaultCurrency: process.env.COPE_DEFAULT_CURRENCY ?? "EUR",
  };
}

/**
 * Resolve the public-facing URL of this app, in priority order:
 *
 *   1. `PUBLIC_BASE_URL`               — explicit, wins. Use for custom domains
 *                                        or tunnels (cloudflared/ngrok/etc.).
 *   2. `VERCEL_PROJECT_PRODUCTION_URL` — Vercel's stable production hostname.
 *   3. `VERCEL_URL`                    — Vercel's per-deployment hostname
 *                                        (set on every deploy, incl. previews).
 *   4. `RAILWAY_PUBLIC_DOMAIN`         — Railway's auto-assigned public domain.
 *   5. `http://localhost:4000`         — local fallback.
 *
 * So you can leave `PUBLIC_BASE_URL` unset on Vercel/Railway — the app still
 * builds `success_url`, `cancel_url`, and the webhook URL correctly.
 */
function resolvePublicBaseUrl(): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  }
  return "http://localhost:4000";
}

/**
 * Snapshot safe to pass to client components. No secrets — publishable key
 * and product UUID are both intended for the browser.
 */
export interface PublicEnvConfig {
  readonly name: CopeEnvName;
  readonly apiBase: string;
  readonly checkoutBase: string;
  readonly publicBaseUrl: string;
  readonly publishableKey: string;
  readonly productUuid: string;
  readonly defaultCurrency: string;
}

export function toPublicConfig(server: CopeEnvConfig): PublicEnvConfig {
  return {
    name: server.name,
    apiBase: server.apiBase,
    checkoutBase: server.checkoutBase,
    publicBaseUrl: server.publicBaseUrl,
    publishableKey: server.publishableKey,
    productUuid: server.productUuid,
    defaultCurrency: server.defaultCurrency,
  };
}
