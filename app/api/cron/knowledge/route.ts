// Scheduled feed refresh (Vercel Cron, once a day; see vercel.json). Only refreshes feeds
// that are due, so calling it more often does no extra work. Model-free, and it never
// creates or changes dialogue. When CRON_SECRET is set in Vercel, only Vercel's scheduler
// (which sends it as a Bearer token) can call it.
import { NextResponse } from "next/server";
import { refreshDue } from "@/lib/knowledge/refresh";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const r = await refreshDue({ limit: 40, budgetMs: 50_000 });
  return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
}
