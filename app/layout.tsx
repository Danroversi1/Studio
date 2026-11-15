import type { Metadata, Viewport } from "next";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/tektur";
import "./globals.css";

export const metadata: Metadata = { title: "STUDIO", description: "A creative workspace for developing animated films." };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#e4e4e4" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
