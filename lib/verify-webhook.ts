import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify a COPE webhook signature.
 *
 * COPE signs each delivery with HMAC-SHA256 over `${timestamp}.${rawBody}` and
 * ships three headers:
 *
 *   X-Cope-Signature: t=1718457600,v1=abc123…
 *   X-Cope-Timestamp: 1718457600
 *   X-Cope-Event-Id:  evt_…
 *
 * Rules every receiver MUST follow:
 *
 *  - Recompute the HMAC over the **exact raw bytes** of the request body and
 *    compare it constant-time. Do NOT use a re-serialized JSON.stringify of
 *    the parsed body — JSON serialization is not byte-stable, so the digest
 *    will not match. In Next.js App Router, that means `await req.text()` and
 *    JSON-parsing only AFTER the signature check.
 *
 *  - Reject if the signed timestamp is older than `toleranceSeconds` (default
 *    5 minutes). Defeats replay attacks where an attacker captures one valid
 *    signed request and re-sends it later.
 *
 *  - The secret comes from the API response when the endpoint is registered.
 *    Treat it like a password — env var, never in source.
 */
export function verifyCopeSignature(opts: {
  signatureHeader: string | null | undefined;
  rawBody: string;
  secret: string;
  toleranceSeconds?: number;
  /** Override the clock — useful in tests. Defaults to Date.now(). */
  nowSeconds?: number;
}): { valid: boolean; reason?: string } {
  const tolerance = opts.toleranceSeconds ?? 300;
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (!opts.signatureHeader) {
    return { valid: false, reason: "missing X-Cope-Signature header" };
  }

  const parts: Record<string, string> = {};
  for (const segment of opts.signatureHeader.split(",")) {
    const eq = segment.indexOf("=");
    if (eq === -1) continue;
    parts[segment.slice(0, eq).trim()] = segment.slice(eq + 1).trim();
  }
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) {
    return { valid: false, reason: "malformed signature (expected 't=…,v1=…')" };
  }

  const timestamp = Number(t);
  if (!Number.isFinite(timestamp)) {
    return { valid: false, reason: "non-numeric timestamp" };
  }
  if (Math.abs(now - timestamp) > tolerance) {
    return { valid: false, reason: "stale timestamp (replay protection)" };
  }

  const expected = createHmac("sha256", opts.secret)
    .update(`${t}.${opts.rawBody}`)
    .digest("hex");

  let actualBuf: Buffer;
  try {
    actualBuf = Buffer.from(v1, "hex");
  } catch {
    return { valid: false, reason: "non-hex signature" };
  }
  const expectedBuf = Buffer.from(expected, "hex");
  if (actualBuf.length !== expectedBuf.length) {
    return { valid: false, reason: "signature length mismatch" };
  }
  if (!timingSafeEqual(actualBuf, expectedBuf)) {
    return { valid: false, reason: "signature mismatch" };
  }

  return { valid: true };
}
