// Scheduled world simulation (Vercel Cron, once a day, after the feed refresh; see vercel.json).
// For films that turned on "Prepare a new day each morning" and aren't paused, it prepares the
// open day's PROPOSALS. It never approves anything and never drafts dialogue. Runs are
// idempotent per film and fictional day: an already-prepared day, or one with proposals still
// waiting, is skipped. When CRON_SECRET is set in Vercel, only Vercel's scheduler can call it.
import { NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase/server";
import { advanceDay } from "@/lib/sim/run";
import { aiConfigured } from "@/lib/ai/configured";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!aiConfigured()) return NextResponse.json({ skipped: "AI not configured" });
  const db = supabaseService();
  const { data } = await db.from("sim_settings").select("project_id, projects!inner(status)").eq("auto_daily", true).eq("paused", false)
    .neq("projects.status", "deleted").limit(8);
  const started = Date.now();
  const results: { project: string; ok: boolean; detail: string }[] = [];
  for (const row of (data ?? []) as { project_id: string }[]) {
    if (Date.now() - started > 240_000) { results.push({ project: row.project_id, ok: false, detail: "out of time; next run" }); continue; }
    const r = await advanceDay({ projectId: row.project_id, trigger: "scheduled" });
    results.push({ project: row.project_id, ok: r.ok, detail: r.ok ? `day ${r.day}: ${r.proposed} proposed` : r.error });
  }
  return NextResponse.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
