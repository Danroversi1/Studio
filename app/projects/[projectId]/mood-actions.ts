"use server";
// "How {name} is doing" controls: starting point, overriding a day, and which of her paired
// computers judges. Plain data work (no model); scores are recomputed by Studio's code.
import { revalidatePath } from "next/cache";
import { friendlyError } from "@/lib/errors";
import { supabaseServer } from "@/lib/supabase/server";
import { settleCharacter } from "@/lib/mood/run";

export type MR = { ok: true; note?: string } | { ok: false; error: string };
const fail = (e: { code?: string; message?: string } | null): MR => ({ ok: false, error: friendlyError(e).message });
const touch = (projectId: string, characterId: string) => revalidatePath(`/projects/${projectId}/items/${characterId}`);

export async function moodSetStart(input: { projectId: string; characterId: string; value: number }): Promise<MR> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("mood_set_start", { p_project: input.projectId, p_character: input.characterId, p_value: input.value });
  if (error) return fail(error);
  await settleCharacter(input.characterId);
  touch(input.projectId, input.characterId);
  return { ok: true, note: "Starting point saved. Scored days were worked out again from it." };
}

export async function moodOverride(input: { projectId: string; characterId: string; day: string; score: number | null; note: string }): Promise<MR> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("mood_override", { p_project: input.projectId, p_character: input.characterId, p_day: input.day, p_score: input.score, p_note: input.note });
  if (error) return fail(error);
  await settleCharacter(input.characterId);
  touch(input.projectId, input.characterId);
  return { ok: true, note: input.score === null ? "Back to the worked-out score." : "Saved. Later days build on your number." };
}

export async function moodSetJudge(input: { projectId: string; characterId: string; deviceId: string | null }): Promise<MR> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("mood_set_judge", { p_project: input.projectId, p_device: input.deviceId });
  if (error) return fail(error);
  touch(input.projectId, input.characterId);
  return { ok: true, note: input.deviceId ? "This computer judges the film's moods from now on." : "No computer judges moods now; days wait." };
}
