/**
 * One-shot: register this app's /api/webhooks/cope endpoint with COPE so the
 * backend starts delivering events to it.
 *
 *   pnpm register
 *
 * Reads from .env (also accepts process.env):
 *   COPE_API_KEY      — server-side secret (`cope_sk_…`). NEVER ship to the
 *                       frontend. Used only by this script.
 *   COPE_API_BASE     — defaults to https://api.cope.com; override if needed.
 *   PUBLIC_BASE_URL   — your deployed URL (https://...vercel.app). Required
 *                       because COPE has to POST back to a public host.
 *
 * Prints the returned `signing_secret`. Paste it into `COPE_WEBHOOK_SECRET`
 * (in .env locally, or in Vercel/Railway env vars) and redeploy so the
 * receiver can verify the HMAC on incoming events.
 */

import { readFileSync } from "node:fs";

// Hand-rolled .env loader so this script runs as `node --experimental-strip-types`
// or `tsx` without pulling in dotenv as a runtime dep.
function loadDotenv(path = ".env"): void {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    return; // No .env is fine — process.env may still be populated.
  }
  for (const line of contents.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, k, rawV] = m;
    if (process.env[k] !== undefined) continue; // existing wins
    let v = rawV;
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
  }
}

const PROD_API_BASE = "https://api.cope.com";

const SUBSCRIBED_EVENT_TYPES = [
  "payment.sale.succeeded",
  "subscription.cancelled",
  "subscription.amount_changed",
] as const;

interface RegisterEndpointResponse {
  readonly endpoint?: { readonly id?: string; readonly url?: string };
  readonly signing_secret?: string;
  readonly id?: string;
  readonly url?: string;
}

async function main(): Promise<void> {
  loadDotenv();

  const apiBase = process.env.COPE_API_BASE ?? PROD_API_BASE;
  const apiKey = process.env.COPE_API_KEY;
  const publicBaseUrl = process.env.PUBLIC_BASE_URL;
  if (!apiKey) {
    fail(
      "COPE_API_KEY is required. Get a `cope_sk_…` key from Dashboard → Settings → Developers.\n" +
        "Set it via:  COPE_API_KEY=cope_sk_… pnpm register\n" +
        "Do NOT commit it to .env if .env is in source control.",
    );
  }
  if (!publicBaseUrl) {
    fail(
      "PUBLIC_BASE_URL is required (e.g. https://your-app.vercel.app).\n" +
        "COPE needs a publicly reachable URL to POST events to.",
    );
  }
  if (!publicBaseUrl.startsWith("https://")) {
    fail(
      `PUBLIC_BASE_URL must be HTTPS (got: ${publicBaseUrl}).\n` +
        "Deploy to Vercel/Railway, or run a tunnel locally (cloudflared/ngrok).",
    );
  }

  const endpointUrl = `${publicBaseUrl.replace(/\/$/, "")}/api/webhooks/cope`;

  console.log(`→ Registering webhook with COPE`);
  console.log(`  API base:     ${apiBase}`);
  console.log(`  Endpoint URL: ${endpointUrl}`);
  console.log(`  Events:       ${SUBSCRIBED_EVENT_TYPES.join(", ")}`);
  console.log();

  const response = await fetch(`${apiBase}/v1/webhooks/endpoints`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      url: endpointUrl,
      event_types: SUBSCRIBED_EVENT_TYPES,
    }),
  });

  const text = await response.text();
  let body: RegisterEndpointResponse;
  try {
    body = JSON.parse(text) as RegisterEndpointResponse;
  } catch {
    fail(
      `HTTP ${response.status} from COPE; response is not JSON:\n${text}`,
    );
  }

  if (!response.ok) {
    fail(`HTTP ${response.status} from COPE:\n${JSON.stringify(body, null, 2)}`);
  }

  const signingSecret = body.signing_secret;
  const endpointId = body.endpoint?.id ?? body.id ?? "(unknown)";

  if (!signingSecret) {
    console.warn(
      "⚠ COPE responded OK but didn't return `signing_secret`. The endpoint\n" +
        "  is registered, but you'll need to rotate to get a secret:\n" +
        `  POST ${apiBase}/v1/webhooks/endpoints/${endpointId}/secret-rotations`,
    );
    console.log("Full response:");
    console.log(JSON.stringify(body, null, 2));
    return;
  }

  console.log("✓ Registered");
  console.log(`  Endpoint id:  ${endpointId}`);
  console.log();
  console.log("Paste this into COPE_WEBHOOK_SECRET (local .env or Vercel /");
  console.log("Railway environment variables), then redeploy:");
  console.log();
  console.log(`  COPE_WEBHOOK_SECRET=${signingSecret}`);
  console.log();
  console.log(
    "After redeploy, trigger a test delivery to verify end-to-end:",
  );
  console.log(
    `  curl -X POST "${apiBase}/v1/webhooks/endpoints/${endpointId}/test-events" \\`,
  );
  console.log(`    -H "authorization: Bearer $COPE_API_KEY" \\`);
  console.log(`    -H "content-type: application/json" \\`);
  console.log(`    -d '{"event_type":"payment.sale.succeeded"}'`);
}

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

main().catch((err) => {
  console.error("✗ Unexpected error:", err);
  process.exit(1);
});
