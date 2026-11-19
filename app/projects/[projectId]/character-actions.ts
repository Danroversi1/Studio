"use server";
// Character agents: her confirmed facts (no model), and one optional partner turn (model).
import { revalidatePath } from "next/cache";
import { aiConfigured } from "@/lib/ai/configured";
import { friendlyError } from "@/lib/errors";
import { runCharacterTalk } from "@/lib/agents/run-character-talk";
import { PURPOSE_LABEL, type Purpose } from "@/lib/knowledge/eligibility";
import { renderWorld, toWorld } from "@/lib/world";
import { supabaseServer } from "@/lib/supabase/server";

type R = { ok: true; version?: number; reply?: string } | { ok: false; error: string; conflict?: boolean };
const fail = (e: { code?: string; message?: string } | null): R => ({ ok: false, error: friendlyError(e).message, conflict: e?.code === "PT409" });
const touch = (projectId: string, entityId: string) => { revalidatePath(`/projects/${projectId}/items/${entityId}`); revalidatePath(`/projects/${projectId}/script`); };

export async function saveCharacterProfile(input: { projectId: string; entityId: string; baseVersion: number | null; confirmed: Record<string, string> }): Promise<R> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("character_profile_save", { p_project: input.projectId, p_entity: input.entityId,
    p_base_version: input.baseVersion || null, p_confirmed: input.confirmed });
  if (error) return fail(error);
  touch(input.projectId, input.entityId);
  return { ok: true, version: data as number };
}

export async function decideCharacterProposal(input: { projectId: string; entityId: string; proposalId: string; accept: boolean; text?: string }): Promise<R> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("character_proposal_decide", { p_project: input.projectId, p_entity: input.entityId,
    p_proposal: input.proposalId, p_accept: input.accept, p_text: input.text ?? null });
  if (error) return fail(error);
  touch(input.projectId, input.entityId);
  return { ok: true, version: data as number };
}

/** One turn with the character partner (cloud model: Anthropic Claude). */
export async function talkAboutCharacter(input: { projectId: string; entityId: string; message: string }): Promise<R> {
  if (!aiConfigured()) return { ok: false, error: "The character partner isn't set up on this server." };
  const sb = await supabaseServer();
  const { data: runId, error } = await sb.rpc("character_talk_request", { p_project: input.projectId, p_entity: input.entityId, p_message: input.message.slice(0, 4000) });
  if (error) return fail(error);
  const latest = async (id: string) => (await sb.from("versions").select("content").eq("entity_id", id).order("version_number", { ascending: false }).limit(1).maybeSingle()).data;
  const [{ data: ent }, { data: story }, { data: prof }, { data: links }, { data: world }, { data: runs }] = await Promise.all([
    sb.from("entities").select("name").eq("id", input.entityId).single(),
    sb.from("entities").select("id").eq("project_id", input.projectId).eq("kind", "story").limit(1).maybeSingle(),
    sb.from("character_profiles").select("confirmed, proposed").eq("entity_id", input.entityId).maybeSingle(),
    sb.from("character_knowledge").select("purpose, knowledge_collections(name)").eq("character_id", input.entityId).is("archived_at", null),
    sb.from("story_world").select("data, version").eq("project_id", input.projectId).maybeSingle(),
    sb.from("agent_runs").select("input_payload, output_payload").eq("project_id", input.projectId).eq("task_type", "character_talk")
      .eq("status", "succeeded").eq("input_payload->>entity_id", input.entityId).order("created_at", { ascending: false }).limit(4),
  ]);
  const summary = String((await latest(input.entityId))?.content?.summary ?? "");
  const storyBody = story ? String((await latest(story.id))?.content?.body ?? "") : "";
  const r = await runCharacterTalk(String(runId), {
    name: String(ent?.name ?? "Character"), summary, confirmed: (prof?.confirmed ?? {}) as Record<string, string>,
    pending: ((prof?.proposed ?? []) as { field: string; text: string }[]).map((p) => ({ field: p.field, text: p.text })),
    story: storyBody, world: renderWorld(toWorld(world)),
    collections: ((links ?? []) as unknown as { purpose: Purpose; knowledge_collections: { name: string } | null }[]).map((l) => ({ name: l.knowledge_collections?.name ?? "", purpose: PURPOSE_LABEL[l.purpose] })),
    message: input.message,
    recent: ((runs ?? []) as { input_payload: { message?: string }; output_payload: { reply?: string } }[]).reverse().map((x) => ({ message: String(x.input_payload?.message ?? ""), reply: String(x.output_payload?.reply ?? "") })),
  });
  touch(input.projectId, input.entityId);
  if ("error" in r) return { ok: false, error: r.error };
  return { ok: true, reply: r.reply };
}
