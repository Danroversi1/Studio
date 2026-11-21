// Reads for "How {name} is doing" (as the signed-in user; RLS applies).
import { supabaseServer } from "../supabase/server";
import { isTracked } from "../sim/rules";
import { DEFAULT_START, eventNudge, type Judgment, type MoodPayload } from "./score";

export interface MoodDay {
  id: string; day: string; status: string; needs_judging: boolean; score: number | null; override: number | null; override_note: string | null;
  harmony: number | null; target: number | null; prev_score: number | null; judgments: Judgment[]; payload: Partial<MoodPayload>; model: string | null; error: string | null; scored_at: string | null;
}

export async function getCharacterMood(projectId: string, characterId: string, role: string | null) {
  if (!isTracked(role)) return null;
  const sb = await supabaseServer();
  const [{ data: days }, { data: st }, { data: set }, { data: devices }] = await Promise.all([
    sb.from("mood_days").select("id, day, status, needs_judging, score, override, override_note, harmony, target, prev_score, judgments, payload, model, error, scored_at")
      .eq("character_id", characterId).order("day", { ascending: false }).limit(30),
    sb.from("sim_char_states").select("mood_start").eq("character_id", characterId).maybeSingle(),
    sb.from("bubble_settings").select("judge_device").eq("project_id", projectId).maybeSingle(),
    sb.from("renderer_devices").select("id, name, last_seen_at").is("revoked_at", null).order("created_at"),
  ]);
  const list = ((days ?? []) as MoodDay[]).map((d) => ({ ...d, score: d.score === null ? null : Number(d.score), override: d.override === null ? null : Number(d.override),
    harmony: d.harmony === null ? null : Number(d.harmony), target: d.target === null ? null : Number(d.target), prev_score: d.prev_score === null ? null : Number(d.prev_score) }));
  const start = Number(st?.mood_start ?? DEFAULT_START);
  const latest = list.find((d) => d.score !== null && d.status !== "waiting" && d.status !== "judged") ?? null;
  const base = latest ? (latest.override ?? latest.score!) : start;
  // Approved story events since the last scored day still nudge the mood.
  const since = latest?.scored_at ?? "1970-01-01T00:00:00Z";
  const { data: changes } = await sb.from("sim_state_changes").select("d_stress, d_happiness").eq("character_id", characterId).gt("created_at", since);
  const nudge = eventNudge((changes ?? []) as { d_stress: number; d_happiness: number }[]);
  const judge = (devices ?? []).find((d) => d.id === set?.judge_device) ?? null;
  return {
    start, current: Math.max(0, Math.min(10, base + nudge)), nudge, latest,
    days: list, waiting: list.filter((d) => d.status === "waiting" && d.needs_judging).length,
    judge: judge ? { id: judge.id as string, name: judge.name as string, lastSeen: (judge.last_seen_at as string | null) } : null,
    judgeSet: !!set?.judge_device, devices: ((devices ?? []) as { id: string; name: string; last_seen_at: string | null }[]),
  };
}
export type CharacterMood = NonNullable<Awaited<ReturnType<typeof getCharacterMood>>>;
