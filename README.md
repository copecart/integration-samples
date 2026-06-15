# COPE Integration Samples

One small Next.js app showing the three pieces a real vendor needs to take
payments through COPE:

| Page / route | Purpose |
|---|---|
| [`/hosted-checkout`](./app/hosted-checkout/page.tsx) | Buy button → redirect to `checkout.cope.com` → buyer pays → back to `/thank-you` |
| [`/iframe-checkout`](./app/iframe-checkout/page.tsx) | Buy button → mounts COPE checkout inside an `<iframe>` on your domain |
| [`/api/webhooks/cope`](./app/api/webhooks/cope/route.ts) | Receives `payment.sale.succeeded`, `subscription.cancelled`, etc. — HMAC-verified, replay-safe, dedupe'd |

A production vendor uses **(one of the two checkout pages) + the webhook
route** together. The checkout page tells the buyer *they paid*; the webhook
tells *your backend* it really happened (signed by COPE, can't be faked from
the browser).

## One-click deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fcopecart%2Fintegration-samples&env=COPE_ENV,COPE_PUBLISHABLE_KEY,COPE_PRODUCT_UUID&envDescription=See%20.env.example%20for%20what%20each%20var%20is&envLink=https%3A%2F%2Fgithub.com%2Fcopecart%2Fintegration-samples%23environment-variables&project-name=cope-integration-samples&repository-name=cope-integration-samples)
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template?template=https%3A%2F%2Fgithub.com%2Fcopecart%2Fintegration-samples&envs=COPE_ENV,COPE_PUBLISHABLE_KEY,COPE_PRODUCT_UUID)

The deploy form asks for **three** values up front (env name + publishable key
+ product UUID). That's enough to render the site and run the checkout pages.

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
cp .env.example .env       # fill the four required values
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

| Name | Required | Purpose |
|---|---|---|
| `COPE_ENV` | yes | One of `prod` / `stg` / `qa` / `dpa`. Picks API + checkout base URLs. |
| `COPE_PUBLISHABLE_KEY` | yes | `cope_pk_…` key from Dashboard → Settings → Developers. Safe in the browser. |
| `COPE_PRODUCT_UUID` | yes | UUID of the product to sell. |
| `COPE_WEBHOOK_SECRET` | yes | `whsec_…` returned when you register the webhook endpoint with COPE. |
| `PUBLIC_BASE_URL` | yes locally / no on Vercel & Railway | Where this app is reachable. Used for `success_url`, `cancel_url`, webhook URL. On Vercel/Railway falls back to `VERCEL_PROJECT_PRODUCTION_URL` / `VERCEL_URL` / `RAILWAY_PUBLIC_DOMAIN`. |
| `COPE_DEFAULT_CURRENCY` | no | Default form value. Defaults to `EUR`. |
| `COPE_API_BASE` | no | Override the API URL derived from `COPE_ENV`. |
| `COPE_CHECKOUT_BASE` | no | Override the checkout URL derived from `COPE_ENV`. |

⚠️ **Never put a `cope_sk_…` key in any frontend env.** Secret keys are
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

- The checkout pages (hosted + iframe) are **frontend** concerns — they get
  the buyer to a payment form. Use one or the other based on UX trade-off.
- The webhook route is a **backend** concern — it's where your business logic
  reacts to confirmed payments. It runs regardless of which checkout style
  you picked.

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

The staging / QA / DPA backends refuse `http://localhost`-style URLs for
`success_url` and `cancel_url`. Either deploy first (Vercel/Railway give you
HTTPS automatically) or run a tunnel locally:

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

The key's environment (prefix) doesn't match `COPE_ENV`. A `cope_pk_live_…`
key from `stg.cope-demo.com` is a staging key with confusing naming — that's
fine. But a key from production won't work on staging and vice versa. Verify
you copied the publishable key from the *same environment* as `COPE_ENV`.

### `Error: Invalid publishableKey. Must start with "cope_pk_"`

You put a `cope_sk_…` (secret) key in `COPE_PUBLISHABLE_KEY`. Secret keys are
server-only and must never reach the browser. Get the **publishable** key
from the same dashboard page — it's a separate value next to the secret one.

### Docker build fails on `pnpm install` with `ERR_PNPM_IGNORED_BUILDS`

This sample uses Node 22 (pnpm 10 requires it) and passes `--ignore-scripts`
in the Dockerfile to skip `sharp`'s postinstall (we don't use `next/image`).
If you upgrade Next.js or use image optimization, drop `--ignore-scripts` and
add the dep you need built to `pnpm.onlyBuiltDependencies` in `package.json`.

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

## SDK version notes (`@copecart/sdk@^0.1.1`)

A few rough edges in the current SDK release this sample works around. None
of them block the integration, but they're worth knowing:

| Quirk | Where you'll hit it | Workaround |
|---|---|---|
| `addLine()` requires `plan_id: number` (not in docs yet) | Anywhere you build a cart | Call `cope.getProduct(uuid)` first, use `product.payment_plans[0].id` |
| `embed_origin` not in `CheckoutPayload` type | Iframe checkout flow | Type-cast at the call site — see [`IframeCheckoutClient.tsx`](./app/iframe-checkout/IframeCheckoutClient.tsx) |
| No `mountCheckout()` helper yet | Iframe checkout flow | Render `<iframe src={checkout.checkoutUrl}>` directly. Same effect, fewer SDK callbacks |
| Strict `cope_pk_…` prefix check | App load | Keep secret keys (`cope_sk_…`) on the server only |

These will go away as the SDK matures. The patterns in the sample work with
the current release; if you upgrade and the type cast is no longer needed,
drop it.

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
