import type { Metadata, Viewport } from "next";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import { DevComments } from "@/components/dev-comments";
import { supabaseServer } from "@/lib/supabase/server";
import { cookies } from "next/headers";

export const metadata: Metadata = { title: "STUDIO", description: "A creative workspace for developing animated films." };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f4f3ee" };

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
  // Light or dark: her saved choice; light until she picks.
  const saved = (await cookies()).get("studio-theme")?.value;
  const theme = saved === "dark" ? "dark" : "light";
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
