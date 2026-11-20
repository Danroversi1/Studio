// Scheduled daily refresh (Vercel Cron, once a day at 09:17 UTC; see vercel.json). Runs
// whether or not anyone has Studio open. First the feeds that are due (one fetch per address,
// shared by every film), then each film's characters' media bubbles. Model-free, and it never
// creates or changes dialogue, events, feelings or story time. When CRON_SECRET is set in
// Vercel, only Vercel's scheduler (which sends it as a Bearer token) can call it.
import { NextResponse } from "next/server";
import { refreshDue, type FetchCache } from "@/lib/knowledge/refresh";
import { refreshBubbles, scheduledBubbleFilms } from "@/lib/bubbles/run";

export const maxDuration = 240;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const cache: FetchCache = new Map();
  const feeds = await refreshDue({ limit: 60, budgetMs: 90_000, cache });
  const films = await scheduledBubbleFilms(12);
  const bubbles: { film: string; ok: boolean; skipped?: boolean; selected?: number; error?: string }[] = [];
  for (const film of films) {
    if (Date.now() - started > 200_000) break;
    const r = await refreshBubbles({ projectId: film, trigger: "scheduled", cache, budgetMs: 25_000 });
    bubbles.push({ film, ok: r.ok, skipped: r.skipped, selected: r.selected, error: r.error });
  }
  return NextResponse.json({ feeds, bubbles, fetched: cache.size }, { headers: { "Cache-Control": "no-store" } });
}
