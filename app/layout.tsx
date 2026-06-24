import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "COPE Integration Samples",
  description:
    "Reference Next.js app showing hosted checkout, iframe checkout, and webhook receiver against the COPE API.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fbfbfb",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          rel="preconnect"
          href="https://api.fontshare.com"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=satoshi@500,600,700,400&display=swap"
        />
      </head>
      <body>
        <header className="cope-nav">
          <div className="cope-nav-inner">
            <Link href="/" className="cope-brand">
              <span className="cope-brand-mark" aria-hidden>
                C
              </span>
              COPE <span className="cope-brand-suffix">Samples</span>
            </Link>
            <ul className="cope-nav-links">
              <li>
                <Link href="/" className="cope-nav-link">
                  Home
                </Link>
              </li>
              <li>
                <Link href="/catalog" className="cope-nav-link cope-nav-link--cta">
                  Products
                </Link>
              </li>
            </ul>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
