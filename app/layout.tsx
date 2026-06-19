import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "COPE Integration Samples",
  description:
    "Reference Next.js app showing hosted checkout, iframe checkout, and webhook receiver against the COPE API.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily:
            "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          margin: 0,
          color: "#111827",
          background: "#f9fafb",
        }}
      >
        {children}
      </body>
    </html>
  );
}
