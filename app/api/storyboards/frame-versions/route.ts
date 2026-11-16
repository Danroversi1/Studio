// Saved versions of a frame (RLS decides who can see them). No AI.
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(req: Request) {
  const shot = new URL(req.url).searchParams.get("shot") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(shot)) return NextResponse.json({ versions: [] }, { status: 400 });
  const sb = await supabaseServer();
  const { data } = await sb.from("storyboard_shot_revisions").select("revision, created_at").eq("shot_id", shot).order("revision", { ascending: false }).limit(50);
  return NextResponse.json({ versions: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
