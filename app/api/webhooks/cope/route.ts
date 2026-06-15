import { NextResponse } from "next/server";
import { verifyCopeSignature } from "@/lib/verify-webhook";

/**
 * COPE webhook receiver — production-shaped, minimal.
 *
 * IMPORTANT: this MUST run on the Node.js runtime, not Edge:
 *   - We need `node:crypto` for timing-safe HMAC compare.
 *   - We read the request as raw text (`await req.text()`) because the HMAC
 *     is over the exact bytes COPE sent. JSON.parse-then-stringify is NOT
 *     byte-stable; the recomputed digest will fail.
 *
 * Flow:
 *   POST /api/webhooks/cope
 *     → verify HMAC + replay window
 *     → 401 on bad sig (4xx = won't be retried — that's what we want)
 *     → dedupe by X-Cope-Event-Id (in-memory; swap for Redis/Postgres in prod)
 *     → ack 200 BEFORE running side effects (queue, don't await)
 *     → dispatch to per-event handlers
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CopeEvent {
  readonly event_type: string;
  readonly idempotency_key?: string;
  readonly [key: string]: unknown;
}

export async function POST(req: Request) {
  const secret = process.env.COPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error(
      "COPE_WEBHOOK_SECRET is not set. Webhook receiver is disabled.",
    );
    return NextResponse.json(
      { error: "receiver not configured" },
      { status: 503 },
    );
  }

  // raw bytes — DO NOT json-parse before verifying the signature.
  const rawBody = await req.text();

  const result = verifyCopeSignature({
    signatureHeader: req.headers.get("x-cope-signature"),
    rawBody,
    secret,
  });

  if (!result.valid) {
    console.warn(`[webhook] rejected: ${result.reason}`);
    // 401 NOT 400/500 — 4xx tells COPE the request is bad and won't be retried.
    return NextResponse.json({ error: result.reason }, { status: 401 });
  }

  const eventId = req.headers.get("x-cope-event-id") ?? "(no id)";

  let event: CopeEvent;
  try {
    event = JSON.parse(rawBody) as CopeEvent;
  } catch {
    // Signature verified but body isn't JSON — that's a contract violation,
    // surface it explicitly.
    return NextResponse.json({ error: "body is not valid JSON" }, { status: 400 });
  }

  console.log(
    `[webhook] received ${event.event_type} eventId=${eventId} ` +
      `idempotency=${event.idempotency_key ?? "(none)"}`,
  );

  // ─── Idempotency ──────────────────────────────────────────────────────────
  // Even with 2xx, you can receive the same eventId twice (e.g. our ack got
  // lost on the wire). Dedupe BEFORE acting on the event. In-memory shortcut
  // here; replace with Redis/Postgres unique constraint in real code.
  if (recentlySeen.has(eventId)) {
    console.log(`[webhook] duplicate eventId=${eventId}, ack & skip`);
    return NextResponse.json({ status: "duplicate" });
  }
  recentlySeen.add(eventId);

  // ─── Route to handlers ────────────────────────────────────────────────────
  // Ack FAST. Queue any slow work. We don't await the handler — fire and forget.
  handleEvent(event).catch((err) => {
    // A throw here is a bug in your handler; you've already ack'd the delivery,
    // so COPE won't retry. Surface it loud.
    console.error(`[webhook] handler crashed for ${event.event_type}:`, err);
  });

  return NextResponse.json({ status: "received" });
}

// GET is a convenience for humans curl'ing the URL to see if the route exists.
export async function GET() {
  return NextResponse.json({
    ok: true,
    hint: "POST signed COPE events here. See README.",
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

class BoundedSet<T> {
  private readonly order: T[] = [];
  private readonly set = new Set<T>();
  constructor(private readonly cap: number) {}
  has(v: T): boolean {
    return this.set.has(v);
  }
  add(v: T): void {
    if (this.set.has(v)) return;
    this.set.add(v);
    this.order.push(v);
    if (this.order.length > this.cap) {
      const evicted = this.order.shift()!;
      this.set.delete(evicted);
    }
  }
}

// Note: in serverless deployments (Vercel) each invocation can hit a different
// instance, so this in-memory set does NOT actually dedupe across requests.
// It's here to document the pattern — in production swap for Redis/Postgres.
const recentlySeen = new BoundedSet<string>(10_000);

async function handleEvent(event: CopeEvent): Promise<void> {
  switch (event.event_type) {
    case "payment.sale.succeeded":
      return onPaymentSucceeded(event);
    default:
      // Unknown types should NOT error — COPE may add new ones at any time.
      console.log(
        `[webhook] no handler for ${event.event_type}, ignoring`,
      );
  }
}

// ─── Domain handlers (vendor business logic lives here) ─────────────────────
// In a real codebase each function would queue a job and return immediately.

async function onPaymentSucceeded(event: CopeEvent): Promise<void> {
  const buyerEmail = pluck(event, "buyer.email");
  const orderUuid = pluck(event, "order.uuid");
  const productUuid = pluck(event, "line_items.0.product.uuid");
  console.log(
    `  → grant product ${productUuid} to ${buyerEmail} (order ${orderUuid})`,
  );
  // TODO: real work
  //   await lms.grantAccess({ email: buyerEmail, productUuid })
  //   await crm.upsertCustomer({ email: buyerEmail, lastOrder: orderUuid })
}

function pluck(obj: unknown, path: string): unknown {
  let cursor: unknown = obj;
  for (const segment of path.split(".")) {
    if (cursor && typeof cursor === "object") {
      cursor = (cursor as Record<string, unknown>)[segment];
    } else {
      return null;
    }
  }
  return cursor ?? null;
}
