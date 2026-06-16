import { getServerEnvConfig, toPublicConfig } from "@/lib/cope-env";
import { IframeCheckoutClient } from "./IframeCheckoutClient";

export const metadata = {
  title: "Iframe Checkout — COPE Integration Samples",
};

// Read env at request time, not build time — see comment in app/page.tsx.
export const dynamic = "force-dynamic";

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
          <code>cope.redirectToCheckout(checkout)</code> we call{" "}
          <code>cope.mountCheckout(target, checkout, options)</code>. The SDK
          inserts an <code>&lt;iframe&gt;</code> pointed at the dedicated{" "}
          <code>/checkout/embed/&lt;token&gt;</code> route and runs a trusted{" "}
          postMessage handshake before reporting <code>onReady</code>. If the
          handshake never lands (CSP block, network), the{" "}
          <code>fallback: &quot;redirect&quot;</code> option sends the buyer
          to hosted checkout instead of leaving them stuck on a blank box.
        </p>
        <p>
          We pass <code>embed_origin: window.location.origin</code> on the
          checkout — COPE uses it for its per-business{" "}
          <code>frame-ancestors</code> CSP allow-list. <strong>The origin must
          be registered ahead of time</strong> at{" "}
          <a href="https://stg.cope-demo.com/settings/checkout">
            Settings → Checkout → Embed domains
          </a>{" "}
          (or POST <code>/v1/commerce/checkout/embed-domains</code>) — wrong
          / unregistered origin → CSP says <code>frame-ancestors &apos;none&apos;</code>
          and Chrome shows &quot;<code>&lt;host&gt;</code> refused to connect&quot;.
          Registration also registers the domain with Stripe Payment Method
          Domains so Apple Pay / Google Pay work inside the embed.
        </p>
      </section>
    </main>
  );
}
