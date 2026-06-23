# COPE Integration Samples

One small Next.js app showing the two pieces a real vendor needs to take
payments through COPE:

| Page / route | Purpose |
|---|---|
| [`/catalog`](./app/catalog/page.tsx) | Multi-product catalog — server-side `GET /v1/commerce/products` (filtered to `status="active" && approval_status="approved"`, paginated via `?page=N`). Buyer multi-selects + qty, then hosted redirect **or** iframe embed (same cart, two checkout styles) |
| [`/api/webhooks/cope`](./app/api/webhooks/cope/route.ts) | Receives `payment.sale.succeeded`, `subscription.cancelled`, etc. — HMAC-verified, replay-safe, dedupe'd |

A production vendor uses **the catalog page + the webhook route** together.
The catalog page gets the buyer to pay; the webhook tells *your backend* it
really happened (signed by COPE, can't be faked from the browser).

## One-click deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fcopecart%2Fintegration-samples&env=COPE_PUBLISHABLE_KEY,COPE_API_KEY&envDescription=See%20.env.example%20for%20what%20each%20var%20is&envLink=https%3A%2F%2Fgithub.com%2Fcopecart%2Fintegration-samples%23environment-variables&project-name=cope-integration-samples&repository-name=cope-integration-samples)
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template?template=https%3A%2F%2Fgithub.com%2Fcopecart%2Fintegration-samples&envs=COPE_PUBLISHABLE_KEY,COPE_API_KEY)

The deploy form asks for **three** values up front (env name + publishable
key + API key). That's enough to render the catalog and run both checkout
styles end-to-end.

Two values are filled in **after** the first deploy because they don't exist
yet at that point — both are wired up automatically by the code:

- `PUBLIC_BASE_URL` — picked from `VERCEL_PROJECT_PRODUCTION_URL` /
  `VERCEL_URL` / `RAILWAY_PUBLIC_DOMAIN` automatically. Set it manually only
  if you map a custom domain that isn't reflected in those platform env vars.
- `COPE_WEBHOOK_SECRET` — comes from registering the webhook endpoint with
  COPE *against your live URL*. See [Registering the webhook](#registering-the-webhook)
  below. Until you set it, the webhook route returns HTTP 503 "receiver not
  configured" — checkout still works, just signed deliveries aren't accepted.

## Run locally

### With Docker (recommended)

```bash
git clone https://github.com/copecart/integration-samples
cd integration-samples
cp .env.example .env       # fill the five required values
docker compose up
```

App is at <http://localhost:4000>.

### Without Docker

```bash
pnpm install               # or npm install / yarn install
cp .env.example .env
pnpm dev                   # http://localhost:4000
```

## Environment variables

| Name | Required for | Purpose |
|---|---|---|
| `COPE_PUBLISHABLE_KEY` | always | `cope_pk_…` key from Dashboard → Settings → Developers. Safe in the browser — drives the cart SDK. |
| `COPE_API_KEY` | always | Server-only `cope_sk_…` key. Two scopes used by this app: `commerce:products:read` (for `/catalog`) and `webhooks:write` (for `pnpm register`). Mint one key with both scopes and reuse. Never reaches the browser. |
| `PUBLIC_BASE_URL` | always (auto on Vercel/Railway) | Where this app is reachable. Used for `success_url`, `cancel_url`, webhook URL. Falls back to `VERCEL_PROJECT_PRODUCTION_URL` / `VERCEL_URL` / `RAILWAY_PUBLIC_DOMAIN`. |
| `COPE_WEBHOOK_SECRET` | `/api/webhooks/cope` | `whsec_…` returned when you register the webhook endpoint with COPE. Without it the route returns HTTP 503. |
| `COPE_DEFAULT_CURRENCY` | optional | Default form value. Defaults to `EUR`. |
| `COPE_API_BASE` | optional | Override the Cart API URL (publishable-key auth). Defaults to `https://api.cope.com`. |
| `COPE_COMMERCE_API_BASE` | optional | Override the Commerce-v1 API URL (`cope_sk_*` auth). Defaults to `https://api.cope.com`. |
| `COPE_CHECKOUT_BASE` | optional | Override the checkout URL. Defaults to `https://cope.com`. |

⚠️ **Never put a `cope_sk_…` key in any frontend env.** `COPE_API_KEY` is
server-only. The `cope_pk_…` variant is what belongs in `COPE_PUBLISHABLE_KEY`.

## Architecture

```
┌──────────────────┐    cope.redirectToCheckout    ┌──────────────────┐
│                  │ ─────────── or ──────────────▶│                  │
│  Your Next.js    │   <iframe src=checkoutUrl>    │  COPE checkout   │
│  (this app)      │ ◀──── success redirect ────── │                  │
└────────┬─────────┘                               └────────┬─────────┘
         │                                                  │
         │  ◀──── HMAC-signed webhook POST ─────────────────┤
         │       /api/webhooks/cope                         │
         │                                                  │
   grantAccess(), notifyCRM(), …
```

- The catalog page is a **frontend** concern — it gets the buyer to a payment
  form, either redirecting to `checkout.cope.com` or mounting the checkout
  inside an `<iframe>` on your origin. Same cart, same SDK, two UX styles.
- The webhook route is a **backend** concern — it's where your business logic
  reacts to confirmed payments. It runs regardless of which checkout style
  the buyer picked.

### Why the webhook is the source of truth

The `/thank-you` page is purely cosmetic. A buyer can navigate there directly
without paying, and the `order_uuid` in the URL can be faked. Only the signed
webhook delivery from COPE proves a payment actually completed — that's where
you grant LMS access, mark the order paid in your DB, etc.

## Registering the webhook

COPE has to know where to POST events. Once this app is deployed (and
reachable over HTTPS), point COPE at `<your-url>/api/webhooks/cope`.

### `pnpm register` (recommended)

```bash
COPE_API_KEY=cope_sk_… \
PUBLIC_BASE_URL=https://your-app.vercel.app \
pnpm register
```

The script POSTs to `/v1/webhooks/endpoints`, prints the returned
`signing_secret`, and shows you a follow-up `curl` for triggering a test
delivery. Paste the secret into `COPE_WEBHOOK_SECRET` (in `.env` locally, or
in Vercel/Railway environment variables), then redeploy so the receiver can
verify the HMAC.

> `COPE_API_KEY` is a **server-side** `cope_sk_…` key. It runs only inside
> this one-shot script — never goes into the browser bundle, never lives in
> the app's runtime env. Don't commit it to `.env`.

### Equivalent raw `curl`

Same call without the script — handy if you're running in a CI step:

```bash
curl -X POST "$COPE_API_BASE/v1/webhooks/endpoints" \
  -H "authorization: Bearer $COPE_API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "url": "https://your-app.vercel.app/api/webhooks/cope",
    "event_types": [
      "payment.sale.succeeded",
      "subscription.cancelled",
      "subscription.amount_changed"
    ]
  }'
```

### Testing the receiver without a real purchase

Once registered, ask COPE to send a synthetic delivery:

```bash
curl -X POST "$COPE_API_BASE/v1/webhooks/endpoints/$ENDPOINT_ID/test-events" \
  -H "authorization: Bearer $COPE_API_KEY" \
  -H "content-type: application/json" \
  -d '{ "event_type": "payment.sale.succeeded" }'
```

Tail the deploy's logs — you should see `[webhook] received payment.sale.succeeded`.

## Test the webhook receiver from your laptop

You don't need a real COPE delivery to verify the signature-verify/dedupe code
works. This one-liner signs a synthetic event with your local
`COPE_WEBHOOK_SECRET` and POSTs it to the running app:

```bash
SECRET=$(grep '^COPE_WEBHOOK_SECRET=' .env | cut -d= -f2-)
TS=$(date +%s)
BODY='{"event_type":"payment.sale.succeeded","idempotency_key":"local-test-001","buyer":{"email":"buyer@example.com"},"order":{"uuid":"ord_local_test"},"line_items":[{"product":{"uuid":"prod_demo"}}]}'
SIG=$(printf "%s.%s" "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $NF}')

curl -s -w "\nHTTP %{http_code}\n" \
  -X POST http://localhost:4000/api/webhooks/cope \
  -H 'content-type: application/json' \
  -H "x-cope-event-id: evt_local_test_$TS" \
  -H "x-cope-signature: t=$TS,v1=$SIG" \
  -d "$BODY"
```

Expected response: `{"status":"received"}` + HTTP 200. In the container logs
(`docker compose logs -f app | grep webhook`) you'll see:

```
[webhook] received payment.sale.succeeded eventId=evt_local_test_… idempotency=local-test-001
  → grant product prod_demo to buyer@example.com (order ord_local_test)
```

Re-run the same command immediately to see dedupe in action:

```
[webhook] duplicate eventId=evt_local_test_…, ack & skip
```

Tamper with `SIG` (change one hex char) — the receiver replies HTTP 401 and
logs `[webhook] rejected: signature mismatch`. That's the verifier doing its
job; the same response shape is what COPE will see for any forged delivery.

## Troubleshooting

The friction points you're most likely to hit, with concrete fixes:

### `Error: success_url must use HTTPS`

The staging backend refuses `http://localhost`-style URLs for `success_url`
and `cancel_url`. Either deploy first (Vercel/Railway give you HTTPS
automatically) or run a tunnel locally:

```bash
# cloudflared (no signup, free)
cloudflared tunnel --url http://localhost:4000

# localtunnel (npx, no install)
npx localtunnel --port 4000

# ngrok (paid for stable subdomain)
ngrok http 4000
```

Then set `PUBLIC_BASE_URL` in `.env` to the HTTPS URL the tunnel prints and
restart (`docker compose restart`).

### `Error: Embed origin is not allowed for this checkout`

The iframe page passes your current origin (`window.location.origin`) as
`embed_origin`. The backend rejects origins that aren't on your business'
allow-list. Add the origin in the dashboard:

**Settings → Checkout → Embed domains → Add `https://your-host.example`**

Each tunnel URL counts as a separate origin. If your tunnel rotates subdomain
on reconnect, you'll register a new one every time — prefer a tunnel with a
stable subdomain or deploy to Vercel/Railway for a permanent URL.

### Iframe loads but Chrome shows `<host> refused to connect`

Same root cause as above. The API created the checkout (so we got *past* the
embed_origin validation), but the browser-side `frame-ancestors` CSP header
on the checkout response still rejects the iframe because the parent origin
wasn't registered. Re-check the embed-domains list matches the URL bar.

### `Error: Invalid or inactive SDK key`

This app targets production. Verify that `COPE_PUBLISHABLE_KEY` is a
production `cope_pk_…` key (minted on `cope.com`, not on a staging
dashboard). Staging keys are rejected by `api.cope.com`.

### `Error: Invalid publishableKey. Must start with "cope_pk_"`

You put a `cope_sk_…` (secret) key in `COPE_PUBLISHABLE_KEY`. Secret keys are
server-only and must never reach the browser. Get the **publishable** key
from the same dashboard page — it's a separate value next to the secret one.

### Docker build fails on `pnpm install` with `ERR_PNPM_IGNORED_BUILDS`

This sample uses Node 22 (pnpm 10 requires it) and passes `--ignore-scripts`
in the Dockerfile to skip `sharp`'s postinstall (we don't use `next/image`).
If you upgrade Next.js or use image optimization, drop `--ignore-scripts` and
add the dep you need built to `pnpm.onlyBuiltDependencies` in `package.json`.

### `Catalog request failed: HTTP 401 (request …)`

The catalog page got a 401 from the Commerce API. Three likely causes:

- The bearer token isn't recognized as a `cope_sk_*` key — verify
  `COPE_API_KEY` starts with `cope_sk_` and was copied without truncation.
- The key targets a different environment — `api.cope.com` accepts only
  production keys. See the SDK-key troubleshooting above.
- The key is missing the `commerce:products:read` scope. Re-create it in the
  dashboard with both `commerce:products:read` + `webhooks:write` selected.

You'll see a yellow warning banner with the exact `HTTP NNN` + request id on
top of the catalog page — paste that into a support ticket if needed.

### Webhook deliveries from COPE never arrive

- COPE has to be able to reach `PUBLIC_BASE_URL/api/webhooks/cope` from the
  public internet. `localhost` doesn't qualify — use a tunnel.
- After registering the endpoint, verify the URL listed in the dashboard
  matches your tunnel/deploy URL. If you rotated the tunnel, the endpoint
  is now pointing at a dead address — re-register.
- 4xx responses are *terminal* (no retry); 5xx responses retry with backoff.
  If you see no deliveries at all, the dashboard's webhook delivery log will
  show whether COPE attempted and got 0 attempts logged, a 4xx response, or
  a connection error.

## Two separate trust settings: embed origins vs success/cancel URLs

It's easy to conflate these — both are about "URLs the iframe-checkout flow
trusts" — but they are configured in different places, validated against
different rules, and fail with different errors. If you only fix one and not
the other, the flow stays broken.

| | **Embed origin allow-list** | **`success_url` / `cancel_url`** |
|---|---|---|
| What it controls | Which parent origin can iframe the checkout (browser-side `frame-ancestors` CSP) | Where COPE redirects the buyer's browser after the checkout completes or is cancelled |
| Where configured | Per-business list in [Settings → Checkout → Embed domains](https://cope.com/settings/checkout) or via `POST /v1/commerce/checkout/embed-domains` (scope: `commerce:checkout-settings:write`) | Passed inline on each `cope.checkout(...)` call as `success_url` and `cancel_url` |
| Validation | Browser CSP — wrong origin → `frame-ancestors 'none'`, Chrome shows "&lt;host&gt; refused to connect" | Backend on cart-create — non-HTTPS or malformed → `success_url must use HTTPS` |
| Side effect | Registering an embed origin also registers it with **Stripe Payment Method Domains**, so wallets (Apple Pay / Google Pay) work in the embed | None |
| When you'll hit it failing | Iframe checkout, after the SDK posts a checkout request | Both checkout styles, immediately when calling `cope.checkout(...)` |

So a new vendor needs to register their parent origin **once** in the
dashboard, then their app code passes correct success/cancel URLs **per
checkout**. Forgetting either yields a different, equally fatal error.

## Production checklist

Before promoting any of this pattern to your real app:

- [ ] Replace the in-memory `BoundedSet` dedupe in `route.ts` with Redis or a
      Postgres `unique` constraint on `event_id`. Serverless instances don't
      share memory — the in-memory variant does NOT actually dedupe.
- [ ] Replace `console.log` handlers with real side effects pushed onto a
      background queue (BullMQ, SQS, Inngest, etc.). The receiver acks in
      < 50 ms; long work must happen asynchronously.
- [ ] Rotate `COPE_WEBHOOK_SECRET` periodically. `POST
      /v1/webhooks/endpoints/:id/secret-rotations` returns a new one and
      accepts both old + new for an overlap window.
- [ ] Add metrics: counts per `event_type`, signature failures, dispatch
      latency. Catch-up graph tells you when COPE or your handlers regress.
- [ ] If you use iframe checkout, register your production domain in the COPE
      dashboard under **Settings → Checkout → Embed domains**. The browser
      will silently refuse to render the iframe (`refused to connect`) for any
      origin not on that allow-list.

## Tech

Next.js 15 (App Router) · React 19 · TypeScript · `@copecart/sdk` from npm.
No CSS framework — inline styles only, so a vendor on a different stack can
read this and rewrite it without untangling Tailwind classes.

## Related

- [`@copecart/sdk` on npm](https://www.npmjs.com/package/@copecart/sdk)
- [Webhook event catalog](https://docs.cope.com/webhooks/events)
- [COPE API reference](https://docs.cope.com/api)
