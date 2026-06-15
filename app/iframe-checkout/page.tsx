import { getServerEnvConfig, toPublicConfig } from "@/lib/cope-env";
import { IframeCheckoutClient } from "./IframeCheckoutClient";

export const metadata = {
  title: "Iframe Checkout — COPE Integration Samples",
};

export default function IframeCheckoutPage() {
  const env = getServerEnvConfig();

  return (
    <main
      style={{
        maxWidth: 960,
        margin: "3rem auto",
        padding: "0 1rem",
        lineHeight: 1.55,
      }}
    >
      <a href="/" style={{ fontSize: "0.85rem", color: "#6b7280" }}>
        ← Back
      </a>
      <h1 style={{ fontSize: "1.6rem", margin: "0.5rem 0 0.25rem" }}>
        Iframe Checkout (embedded)
      </h1>
      <p style={{ color: "#6b7280", marginTop: 0 }}>
        Same COPE checkout, but rendered inside an <code>&lt;iframe&gt;</code>{" "}
        on your domain. The buyer&apos;s URL bar never leaves your site.
        Better for in-app upsells, dashboard flows, and brand consistency.
      </p>

      <IframeCheckoutClient env={toPublicConfig(env)} />

      <section style={{ marginTop: "2rem", color: "#6b7280", fontSize: "0.9rem" }}>
        <h2 style={{ fontSize: "1rem", color: "#111827" }}>What the code does</h2>
        <p>
          Same cart-and-line setup as hosted checkout, but instead of{" "}
          <code>redirectToCheckout()</code> we take{" "}
          <code>checkout.checkoutUrl</code> from the response and render it as
          an <code>&lt;iframe src=…&gt;</code>. SDK 0.1.x does not expose a
          higher-level <code>mountCheckout()</code> helper yet; embedding the
          URL directly is the supported pattern.
        </p>
        <p>
          We pass <code>embed_origin: window.location.origin</code> on the
          checkout — COPE uses it as a <code>frame-ancestors</code> CSP
          allow-list. Wrong origin → iframe stays blank with no in-page error.{" "}
          <strong>Use the public URL from your tunnel/deploy</strong>, not{" "}
          <code>http://localhost:4000</code>, when testing on staging.
        </p>
      </section>
    </main>
  );
}
