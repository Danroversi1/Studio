// Judgments back from her computer. Studio keeps only judgments about the day's real items and
// rules, then computes the 0–10 mood itself (lib/mood/score.ts).
import { deviceFrom, json, readJson } from "@/lib/local/server";
import { supabaseService } from "@/lib/supabase/server";
import { cleanJudgments, type MoodPayload } from "@/lib/mood/score";
import { settleCharacter } from "@/lib/mood/run";

export async function POST(req: Request, { params }: { params: Promise<{ dayId: string }> }) {
  const { dayId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(dayId)) return json({ error: "Not found." }, 404);
  const body = await readJson<{ judgments?: unknown; model?: string }>(req, 200_000);
  const who = await deviceFrom(req);
  if ("error" in who) return who.error;
  const sb = supabaseService();
  const { data: m } = await sb.from("mood_days").select("character_id, payload").eq("id", dayId).maybeSingle();
  if (!m) return json({ error: "Not found." }, 404);
  const judgments = cleanJudgments(body?.judgments, m.payload as MoodPayload);
  const { error } = await sb.rpc("mood_complete", { p_id: dayId, p_device: who.deviceId, p_judgments: judgments, p_model: String(body?.model ?? "local").slice(0, 120) });
  if (error) return json({ error: "This day isn't waiting for this computer." }, 409);
  await settleCharacter(m.character_id as string);
  return json({ ok: true, kept: judgments.length });
}
