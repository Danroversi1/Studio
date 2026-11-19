"use server";
// Connections desk: knowledge collection → character, its preview, and scene time.
// Plain data work: nothing here calls or imports a model.
import { revalidatePath } from "next/cache";
import { friendlyError } from "@/lib/errors";
import type { LinkRule } from "@/lib/knowledge/eligibility";
import { previewLink, type PreviewItem } from "@/lib/knowledge/connect-data";
import { supabaseServer } from "@/lib/supabase/server";

type R = { ok: true; id?: string; version?: number } | { ok: false; error: string; conflict?: boolean };
const fail = (e: { code?: string; message?: string } | null): R => ({ ok: false, error: friendlyError(e).message, conflict: e?.code === "PT409" });
const touch = (projectId: string) => {
  revalidatePath(`/projects/${projectId}/connections`); revalidatePath(`/projects/${projectId}/script`);
  revalidatePath(`/projects/${projectId}/knowledge`); revalidatePath(`/projects/${projectId}/items/[entityId]`, "page");
};

export async function saveKnowledgeLink(input: { projectId: string; linkId: string | null; data: Record<string, unknown> }): Promise<R> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("character_knowledge_save", { p_project: input.projectId, p_link: input.linkId, p_data: input.data });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true, id: data as string };
}

export async function removeKnowledgeLink(input: { projectId: string; linkId: string }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("character_knowledge_remove", { p_project: input.projectId, p_link: input.linkId });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true };
}

export async function previewKnowledgeLink(input: { projectId: string; rule: LinkRule & { collection_id: string }; sceneKey: string | null }): Promise<
  { ok: true; items: PreviewItem[]; scene: { key: string; story_date: string | null } | null } | { ok: false; error: string }> {
  const sb = await supabaseServer();
  const { data: caps } = await sb.rpc("my_project_capabilities", { p_project: input.projectId });
  if (!caps?.can_review) return { ok: false, error: "Your access level does not allow that." };
  const r = await previewLink(input.projectId, input.rule, input.sceneKey);
  return { ok: true, items: r.items.slice(0, 60), scene: r.scene };
}

export async function saveSceneContext(input: { projectId: string; sceneKey: string; data: Record<string, unknown> }): Promise<R> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("scene_context_save", { p_project: input.projectId, p_scene_key: input.sceneKey, p_data: input.data });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true, version: data as number };
}
