import type { Metadata, Viewport } from "next";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import { DevComments } from "@/components/dev-comments";
import { supabaseServer } from "@/lib/supabase/server";
import { cookies } from "next/headers";

export const metadata: Metadata = { title: "STUDIO", description: "A creative workspace for developing animated films." };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f4f3ee" }, { media: "(prefers-color-scheme: dark)", color: "#0b0d0b" }] };

// The developer comments layer renders only for accounts in studio_developers.
async function isDeveloper() {
  try {
    const sb = await supabaseServer();
    const { data } = await sb.rpc("is_studio_developer");
    return data === true;
  } catch {
    return false;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const dev = await isDeveloper();
  // Light or dark: her saved choice; without one, the device decides (see globals.css).
  const saved = (await cookies()).get("studio-theme")?.value;
  const theme = saved === "light" || saved === "dark" ? saved : undefined;
  return (
    <html lang="en" data-theme={theme}>
      <head>
        {/* Painwaves type: Instrument Serif (titles, figures) and DM Sans (reading). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300..700&family=Instrument+Serif:ital@0;1&display=swap" />
      </head>
      <body className="relative min-h-dvh antialiased">{children}{dev && <DevComments />}</body>
    </html>
  );
}
