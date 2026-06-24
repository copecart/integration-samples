/**
 * Resolves the COPE API + Checkout base URLs.
 *
 *   - `getServerEnvConfig()` runs in server contexts (RSC / route handlers).
 *   - `getPublicEnvConfig()` is what we serialize into client components so
 *     the SDK in the browser can be pointed at the same env. We only expose
 *     non-secret values (NEXT_PUBLIC_* mirrors).
 */

export type CopeEnvName = "prod";

export interface CopeEnvConfig {
  readonly name: CopeEnvName;
  /** Cart API base (publishable-key auth, used by the SDK in the browser). */
  readonly apiBase: string;
  /**
   * Commerce-v1 API base (secret API-key auth, used server-side to fetch the
   * vendor's catalog). The cart API goes through a gateway that does
   * Clerk-style auth and rejects raw `cope_sk_*` keys.
   */
  readonly commerceApiBase: string;
  readonly checkoutBase: string;
  readonly publicBaseUrl: string;
  readonly publishableKey: string;
  readonly defaultCurrency: string;
  /**
   * Server-only secret key (`cope_sk_live_*` / `cope_sk_test_*`). Used by:
   * - `/catalog` page → `GET /v1/commerce/products` (scope: `commerce:products:read`)
   * - `pnpm register` script → `POST /v1/webhooks/endpoints` (scope: `webhooks:write`)
   *
   * Mint one key with both scopes in Dashboard → Settings → Developers →
   * API keys, then reuse it for everything server-side. Never serialize into
   * the client config — see {@link toPublicConfig}.
   */
  readonly apiKey: string;
}

const PROD_PRESET = {
  // Browser-facing Cart API (publishable-key auth, hit by the SDK from the
  // page). Lives behind the same `/gateway/cart_api` prefix as staging — and
  // critically, this is the ONLY prod host that emits CORS headers for the
  // cart endpoints. Direct `api.cope.com/api/cart/v1/...` is server-only and
  // returns no `Access-Control-Allow-Origin`, so any browser call there is
  // dead on arrival.
  apiBase: "https://app.cope.com/gateway/cart_api",
  // Server-side Commerce API (secret cope_sk_* auth, e.g. /v1/commerce/products).
  commerceApiBase: "https://api.cope.com",
  // Hosted checkout origin — must match the origin of the URL the backend
  // returns in `checkout_url`, else the SDK's `normalizeCheckoutResult`
  // throws "Checkout URL origin … does not match expected …".
  checkoutBase: "https://cope.com",
} as const;

export function getServerEnvConfig(): CopeEnvConfig {
  return {
    name: "prod",
    apiBase: process.env.COPE_API_BASE ?? PROD_PRESET.apiBase,
    commerceApiBase: process.env.COPE_COMMERCE_API_BASE ?? PROD_PRESET.commerceApiBase,
    checkoutBase: process.env.COPE_CHECKOUT_BASE ?? PROD_PRESET.checkoutBase,
    publicBaseUrl: resolvePublicBaseUrl(),
    publishableKey: process.env.COPE_PUBLISHABLE_KEY ?? "",
    defaultCurrency: process.env.COPE_DEFAULT_CURRENCY ?? "EUR",
    apiKey: process.env.COPE_API_KEY ?? "",
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
 * Snapshot safe to pass to client components. No secrets — the publishable
 * key is intended for the browser; `apiKey` is intentionally stripped here.
 */
export interface PublicEnvConfig {
  readonly name: CopeEnvName;
  readonly apiBase: string;
  readonly checkoutBase: string;
  readonly publicBaseUrl: string;
  readonly publishableKey: string;
  readonly defaultCurrency: string;
}

export function toPublicConfig(server: CopeEnvConfig): PublicEnvConfig {
  return {
    name: server.name,
    apiBase: server.apiBase,
    checkoutBase: server.checkoutBase,
    publicBaseUrl: server.publicBaseUrl,
    publishableKey: server.publishableKey,
    defaultCurrency: server.defaultCurrency,
  };
}
