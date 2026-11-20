"use server";
// Characters' daily media bubbles. Every action is plain data work (no model). Refreshing
// stores what's available to each main character; it never exposes them to anything, changes
// feelings or knowledge, advances story time, creates events or drafts dialogue.
import { revalidatePath } from "next/cache";
import { friendlyError } from "@/lib/errors";
import { supabaseServer } from "@/lib/supabase/server";
import { refreshBubbles } from "@/lib/bubbles/run";
import { cleanTerms } from "@/lib/bubbles/select";

export type BR = { ok: true; note?: string } | { ok: false; error: string };
const fail = (e: { code?: string; message?: string } | null): BR => ({ ok: false, error: friendlyError(e).message });
const touch = (projectId: string, characterId?: string) => {
  revalidatePath(`/projects/${projectId}/world`);
  if (characterId) revalidatePath(`/projects/${projectId}/items/${characterId}`);
  else revalidatePath(`/projects/${projectId}`, "layout");
};

export async function bubbleRefreshNow(input: { projectId: string }): Promise<BR> {
  const sb = await supabaseServer();
  const r = await refreshBubbles({ projectId: input.projectId, trigger: "manual", userClient: sb });
  touch(input.projectId);
  if (!r.ok) return { ok: false, error: r.error ?? "The refresh failed." };
  const failed = Object.values(r.sources ?? {}).filter((s) => !s.ok).length;
  return { ok: true, note: `Refreshed. ${r.selected ?? 0} new item${r.selected === 1 ? "" : "s"} available across the bubbles${failed ? `; ${failed} source${failed === 1 ? "" : "s"} couldn't be reached (earlier material kept)` : ""}.` };
}

export async function bubbleSaveSettings(input: { projectId: string; paused?: boolean; timezone?: string; preferredTime?: string }): Promise<BR> {
  const sb = await supabaseServer();
  const data: Record<string, unknown> = {};
  if (input.paused !== undefined) data.paused = input.paused;
  if (input.timezone) data.timezone = input.timezone;
  if (input.preferredTime) data.preferred_time = input.preferredTime;
  const { error } = await sb.rpc("bubble_settings_save", { p_project: input.projectId, p_data: data });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true, note: input.paused === true ? "Daily refresh paused." : input.paused === false ? "Daily refresh resumed. Missed days aren't filled in." : "Saved." };
}

export async function bubbleSaveProfile(input: { projectId: string; characterId: string; topics: string; avoid: string; attention: number }): Promise<BR> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("bubble_profile_save", {
    p_project: input.projectId, p_character: input.characterId, p_topics: cleanTerms(input.topics), p_avoid: cleanTerms(input.avoid), p_attention: Math.round(input.attention),
  });
  if (error) return fail(error);
  touch(input.projectId, input.characterId);
  return { ok: true, note: "Saved. It applies from the next refresh." };
}

export async function bubbleSetActive(input: { projectId: string; characterId: string; active: boolean }): Promise<BR> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("bubble_set_active", { p_project: input.projectId, p_character: input.characterId, p_active: input.active });
  if (error) return fail(error);
  touch(input.projectId, input.characterId);
  return { ok: true, note: input.active ? "Resumed from the next refresh. Missed days aren't filled in." : "Paused. Earlier days are kept." };
}
