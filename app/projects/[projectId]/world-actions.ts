"use server";
// World & Time edits. Each returns a result instead of redirecting, so what she typed
// stays on screen if anything goes wrong.
import { revalidatePath } from "next/cache";
import { aiConfigured } from "@/lib/agents/run-story-breakdown";
import { runWorldRead } from "@/lib/agents/run-world-read";
import { friendlyError } from "@/lib/errors";
import { getWorld } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { SECTIONS, cleanValue, reviewNotes, type Section } from "@/lib/world";

export interface WorldResult { ok: boolean; version?: number; error?: string; conflict?: boolean }

const isSection = (x: unknown): x is Section => (SECTIONS as readonly string[]).includes(x as string);

export async function saveWorldSection(input: { projectId: string; section: string; value: unknown; baseVersion: number }): Promise<WorldResult> {
  if (!isSection(input?.section)) return { ok: false, error: "Unknown part of World & Time." };
  const value = cleanValue(input.section, input.value);
  if (value == null) return { ok: false, error: input.section === "summary" ? "Write a sentence first." : "Nothing to save yet." };
  const before = await getWorld(input.projectId);
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("save_world_section", {
    p_project: input.projectId, p_section: input.section, p_value: value, p_base_version: input.baseVersion,
    p_reviews: reviewNotes(input.section, before.confirmed[input.section]?.value, value),
  });
  if (error) return { ok: false, error: friendlyError(error).message, conflict: error.code === "PT409" };
  revalidatePath(`/projects/${input.projectId}`, "layout");
  return { ok: true, version: data as number };
}

export async function acceptWorldSuggestion(input: { projectId: string; section: string }): Promise<WorldResult> {
  if (!isSection(input?.section)) return { ok: false, error: "Unknown part of World & Time." };
  const w = await getWorld(input.projectId);
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("accept_world_proposal", {
    p_project: input.projectId, p_section: input.section,
    p_reviews: reviewNotes(input.section, w.confirmed[input.section]?.value, w.proposals[input.section]?.value),
  });
  if (error) return { ok: false, error: friendlyError(error).message };
  revalidatePath(`/projects/${input.projectId}`, "layout");
  return { ok: true, version: data as number };
}

export async function dismissWorldSuggestion(input: { projectId: string; section: string }): Promise<WorldResult> {
  if (!isSection(input?.section)) return { ok: false, error: "Unknown part of World & Time." };
  const sb = await supabaseServer();
  const { error } = await sb.rpc("dismiss_world_proposal", { p_project: input.projectId, p_section: input.section });
  if (error) return { ok: false, error: friendlyError(error).message };
  revalidatePath(`/projects/${input.projectId}`, "layout");
  return { ok: true };
}

/** Reads her story once for a setting she already wrote down (suggestions only). */
export async function readStoryForWorld(input: { projectId: string }): Promise<{ suggested: boolean }> {
  if (!aiConfigured()) return { suggested: false };
  const sb = await supabaseServer();
  const { data: ents } = await sb.from("entities").select("id, kind").eq("project_id", input.projectId).in("kind", ["story", "screenplay"]).neq("status", "archived");
  const latest = async (id: string) => (await sb.from("versions").select("content").eq("entity_id", id)
    .order("version_number", { ascending: false }).limit(1).maybeSingle()).data?.content as Record<string, string> | undefined;
  // Read once per change: skip if her story and script haven't changed since the last read.
  const ids = (ents ?? []).map((e) => e.id);
  const [{ data: lastRead }, { data: lastEdit }] = await Promise.all([
    sb.from("agent_runs").select("created_at").eq("project_id", input.projectId).eq("task_type", "world_read").eq("status", "succeeded")
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ids.length ? sb.from("versions").select("created_at").in("entity_id", ids).order("created_at", { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (lastRead && (!lastEdit || lastEdit.created_at < lastRead.created_at)) return { suggested: false };
  const sources: { label: string; text: string }[] = [];
  for (const e of ents ?? []) {
    const body = String((await latest(e.id))?.body ?? "");
    if (body.trim()) sources.push({ label: e.kind === "story" ? "Her story (synopsis and answers)" : "Her script", text: body });
  }
  const { data: proj } = await sb.from("projects").select("description").eq("id", input.projectId).single();
  if (proj?.description) sources.push({ label: "Her one-line idea", text: String(proj.description) });
  const { data: tr } = await sb.from("agent_runs").select("text:input_payload->>text").eq("project_id", input.projectId)
    .eq("task_type", "story_breakdown").eq("input_payload->>source", "treatment").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (tr?.text) sources.push({ label: "Her treatment", text: String(tr.text) });
  if (!sources.length) return { suggested: false };
  const { data: runId, error } = await sb.rpc("request_world_read", { p_project: input.projectId });
  if (error || !runId) return { suggested: false };
  const ok = await runWorldRead(String(runId), sources);
  if (ok) revalidatePath(`/projects/${input.projectId}/world`);
  return { suggested: ok };
}
