// Fetches a slide picture Google just rendered for her (a short-lived googleusercontent.com
// URL returned by the Slides API to her own Google token) and passes the bytes back, so her
// browser can crop it. Only signed-in members; only Google's picture hosts; bounded size.
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED = /^([a-z0-9-]+\.)*googleusercontent\.com$/i;

export async function POST(request: Request) {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  let url: URL;
  try { url = new URL(String(body?.url ?? "")); } catch { return NextResponse.json({ error: "That isn't a picture address." }, { status: 400 }); }
  if (url.protocol !== "https:" || !ALLOWED.test(url.hostname)) return NextResponse.json({ error: "Only Google slide pictures can be fetched." }, { status: 400 });
  const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!res || !res.ok) return NextResponse.json({ error: "Google didn't return the slide picture. Try again." }, { status: 502 });
  const type = res.headers.get("content-type") ?? "";
  if (!/^image\/(png|jpeg)/.test(type)) return NextResponse.json({ error: "Google returned something other than a picture." }, { status: 502 });
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) return NextResponse.json({ error: "That slide picture is too large." }, { status: 413 });
  return new NextResponse(bytes, { headers: { "Content-Type": type, "Cache-Control": "no-store" } });
}
