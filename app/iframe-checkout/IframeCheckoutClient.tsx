"use client";

import { useEffect, useRef, useState } from "react";
import { CopeCart } from "@copecart/sdk";
import type { PublicEnvConfig } from "@/lib/cope-env";

type Status = { message: string; kind: "" | "ok" | "err" };

const MOUNT_READY_TIMEOUT_MS = 6_000;
const MAX_MOUNT_ATTEMPTS = 2;

export function IframeCheckoutClient({ env }: { env: PublicEnvConfig }) {
  const [currency, setCurrency] = useState(env.defaultCurrency);
  const [busy, setBusy] = useState(false);
  const [mountedOnce, setMountedOnce] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  const mountedRef = useRef<{ destroy: () => void } | null>(null);
  useEffect(
    () => () => {
      mountedRef.current?.destroy();
    },
    [],
  );

  useEffect(() => {
    if (!env.checkoutBase) return;
    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = env.checkoutBase;
    link.crossOrigin = "anonymous";
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, [env.checkoutBase]);

  async function start() {
    if (!env.publishableKey || !env.productUuid) {
      setStatus({
        message:
          "Server is missing COPE_PUBLISHABLE_KEY or COPE_PRODUCT_UUID — set them in .env and restart.",
        kind: "err",
      });
      return;
    }

    setBusy(true);
    setStatus({ message: "Creating cart…", kind: "" });

    try {
      mountedRef.current?.destroy();
      mountedRef.current = null;

      const cope = new CopeCart({
        publishableKey: env.publishableKey,
        baseUrl: env.apiBase,
        checkoutBaseUrl: env.checkoutBase,
      });

      const cart = await cope.createCart({ currency });
      await cope.addLine(cart.id, {
        product_id: env.productUuid,
        quantity: 1,
      });

      setStatus({ message: "Creating checkout…", kind: "" });
      const checkout = await cope.checkout(cart.id, {
        embed_origin: window.location.origin,
        success_url: `${window.location.origin}/thank-you`,
        cancel_url: `${window.location.origin}/iframe-checkout`,
        consents: [{ type: "terms-of-purchase", version: "1.0" }],
      });

      mountWithRetry(cope, checkout);
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : String(err);
      setStatus({ message: `Error: ${message}`, kind: "err" });
      setBusy(false);
    }
  }

  function mountWithRetry(
    cope: CopeCart,
    checkout: Parameters<CopeCart["redirectToCheckout"]>[0],
  ) {
    let attempts = 0;
    let ready = false;
    let watchdog: number | null = null;

    const cleanupWatchdog = () => {
      if (watchdog !== null) {
        window.clearTimeout(watchdog);
        watchdog = null;
      }
    };

    const tryMount = () => {
      attempts += 1;
      mountedRef.current?.destroy();

      cleanupWatchdog();
      watchdog = window.setTimeout(() => {
        if (ready) return;
        if (attempts < MAX_MOUNT_ATTEMPTS) {
          setStatus({
            message: `First mount didn't complete in ${MOUNT_READY_TIMEOUT_MS / 1000}s — retrying…`,
            kind: "",
          });
          tryMount();
          return;
        }
        setStatus({
          message: "Embed didn't load — falling back to hosted checkout.",
          kind: "err",
        });
        mountedRef.current?.destroy();
        mountedRef.current = null;
        cope.redirectToCheckout(checkout);
      }, MOUNT_READY_TIMEOUT_MS);

      mountedRef.current = cope.mountCheckout("#checkout-frame", checkout, {
        readyTimeoutMs: 300_000,
        fallback: "error",
        onReady: () => {
          ready = true;
          cleanupWatchdog();
          setStatus({
            message:
              attempts > 1
                ? `Checkout loaded (attempt ${attempts}).`
                : "Checkout loaded.",
            kind: "ok",
          });
          setMountedOnce(true);
        },
        onSuccess: () => {
          setStatus({
            message: "Payment completed. Redirecting…",
            kind: "ok",
          });
          setTimeout(() => {
            window.location.href = `/thank-you`;
          }, 600);
        },
        onCancel: () => setStatus({ message: "Buyer cancelled.", kind: "" }),
        onError: ({ code, retryable }) => {
          if (ready) return;
          if (code === "load_failed" && attempts < MAX_MOUNT_ATTEMPTS) {
            tryMount();
            return;
          }
          setStatus({
            message: `Checkout error: ${code}${retryable ? " (retryable)" : ""}`,
            kind: "err",
          });
          cleanupWatchdog();
        },
        onTerminal: ({ status: terminalStatus }) =>
          console.log(`[mountCheckout] terminal: ${terminalStatus}`),
      });
    };

    tryMount();
    setBusy(false);
  }

  return (
    <div style={{ marginTop: "1.5rem" }}>
      <div style={layout}>
        <div style={panel}>
          <h2 style={{ margin: "0 0 0.5rem", fontSize: "1.05rem" }}>
            Sample Course
          </h2>
          <p style={{ margin: "0 0 1rem", color: "#6b7280", fontSize: "0.9rem" }}>
            Product <code>{env.productUuid || "(not configured)"}</code>.
            Clicking <em>Start Checkout</em> mounts the payment form on the
            right.
          </p>
          <label style={{ fontSize: "0.85rem", color: "#6b7280" }}>
            Currency
            <input
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              style={input}
            />
          </label>
          <button onClick={start} disabled={busy} style={button}>
            {busy ? "…" : "Start Checkout"}
          </button>
        </div>

        <div style={panel}>
          <h2 style={{ margin: "0 0 0.5rem", fontSize: "1.05rem" }}>Payment</h2>
          <div style={frameWrapper}>
            {!mountedOnce && (
              <span style={placeholderOverlay}>Checkout will load here.</span>
            )}
            <div id="checkout-frame" style={frameTarget} />
          </div>
          {status && (
            <div
              style={{
                marginTop: "0.5rem",
                fontSize: "0.9rem",
                color:
                  status.kind === "err"
                    ? "#dc2626"
                    : status.kind === "ok"
                      ? "#059669"
                      : "#6b7280",
              }}
            >
              {status.message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const layout: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "1.5rem",
};

const panel: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  background: "#fff",
  borderRadius: 12,
  padding: "1.25rem",
};

const frameWrapper: React.CSSProperties = {
  position: "relative",
  width: "100%",
  minHeight: 600,
  background: "#f9fafb",
  borderRadius: 8,
  overflow: "hidden",
};

const placeholderOverlay: React.CSSProperties = {
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  color: "#9ca3af",
  pointerEvents: "none",
};

const frameTarget: React.CSSProperties = {
  width: "100%",
  minHeight: 600,
};

const input: React.CSSProperties = {
  display: "block",
  marginTop: "0.25rem",
  padding: "0.4rem 0.6rem",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontFamily: "inherit",
  fontSize: "0.9rem",
  width: 80,
};

const button: React.CSSProperties = {
  marginTop: "1rem",
  background: "#2563eb",
  color: "#fff",
  border: 0,
  borderRadius: 8,
  padding: "0.65rem 1.25rem",
  fontSize: "1rem",
  fontWeight: 500,
  cursor: "pointer",
};
