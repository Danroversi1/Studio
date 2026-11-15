import type { Metadata, Viewport } from "next";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/tektur";
import "./globals.css";
import { DevComments } from "@/components/dev-comments";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "STUDIO", description: "A creative workspace for developing animated films." };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#e4e4e4" };

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
  return (
    <html lang="en">
      <body className="relative min-h-dvh antialiased">{children}{dev && <DevComments />}</body>
    </html>
  );
}
