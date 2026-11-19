"use server";
// World knowledge base: searching the world (cloud model + Anthropic web search) and
// character impressions (cloud model). Keeping findings and deciding on impressions are
// plain data work.
import { revalidatePath } from "next/cache";
import { aiConfigured } from "@/lib/ai/configured";
import { friendlyError } from "@/lib/errors";
import { runImpression } from "@/lib/agents/run-impression";
import { runWorldSearch } from "@/lib/knowledge/world-search";
import { parseIntake } from "@/lib/intake";
import { supabaseServer } from "@/lib/supabase/server";

type R = { ok: true; id?: string; note?: string } | { ok: false; error: string };
const fail = (e: { code?: string; message?: string } | null): R => ({ ok: false, error: friendlyError(e).message });
const touch = (projectId: string) => { revalidatePath(`/projects/${projectId}/knowledge`); revalidatePath(`/projects/${projectId}/connections`); revalidatePath(`/projects/${projectId}/script`); };

export async function worldSetUp(input: { projectId: string; connectAll: boolean }): Promise<R> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("kb_world_collection", { p_project: input.projectId, p_connect_all: input.connectAll });
  if (error) return fail(error);
  const row = (data as { collection_id: string; connected: number }[])[0];
  touch(input.projectId);
  return { ok: true, id: row.collection_id, note: row.connected ? `Connected to ${row.connected} character${row.connected === 1 ? "" : "s"}.` : undefined };
}

export async function worldSearch(input: { projectId: string; prompt: string; focus: string; period: string }): Promise<R> {
  if (!aiConfigured()) return { ok: false, error: "World search isn't set up on this server." };
  const sb = await supabaseServer();
  const { data: id, error } = await sb.rpc("world_search_request", { p_project: input.projectId, p_prompt: input.prompt, p_focus: input.focus, p_period: input.period });
  if (error) return fail(error);
  const [{ data: story }, { data: proj }] = await Promise.all([
    sb.from("entities").select("id").eq("project_id", input.projectId).eq("kind", "story").limit(1).maybeSingle(),
    sb.from("projects").select("name").eq("id", input.projectId).single(),
  ]);
  let context = String(proj?.name ?? "");
  if (story) {
    const { data: v } = await sb.from("versions").select("content").eq("entity_id", story.id).order("version_number", { ascending: false }).limit(1).maybeSingle();
    context = `${context}: ${parseIntake(String((v?.content as { body?: string } | null)?.body ?? "")).idea}`.slice(0, 500);
  }
  const r = await runWorldSearch(String(id), { prompt: input.prompt, focus: input.focus, period: input.period, context });
  touch(input.projectId);
  return r.ok ? { ok: true, id: String(id), note: r.count ? `Found ${r.count}. Pick what to keep.` : "Nothing useful came back. Try different words." } : { ok: false, error: r.error };
}

export async function worldKeep(input: { projectId: string; searchId: string; resultIds: string[] }): Promise<R> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("world_search_keep", { p_project: input.projectId, p_search: input.searchId, p_result_ids: input.resultIds });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true, note: `Kept ${data} in World.` };
}

/** How would this character experience this World item? (character agent, cloud model) */
export async function formImpression(input: { projectId: string; characterId: string; itemId: string }): Promise<R> {
  if (!aiConfigured()) return { ok: false, error: "Character agents aren't set up on this server." };
  const sb = await supabaseServer();
  const { data: runId, error } = await sb.rpc("impression_request", { p_project: input.projectId, p_character: input.characterId, p_item: input.itemId });
  if (error) return fail(error);
  const [{ data: ent }, { data: ver }, { data: prof }, { data: item }] = await Promise.all([
    sb.from("entities").select("name").eq("id", input.characterId).single(),
    sb.from("versions").select("content").eq("entity_id", input.characterId).order("version_number", { ascending: false }).limit(1).maybeSingle(),
    sb.from("character_profiles").select("version, confirmed").eq("entity_id", input.characterId).maybeSingle(),
    sb.from("knowledge_items").select("title, content, published_at, version, knowledge_sources(title, origin)").eq("id", input.itemId).single(),
  ]);
  const it = item as unknown as { title: string; content: string; published_at: string | null; version: number; knowledge_sources: { title: string; origin: string | null } | null };
  const r = await runImpression(String(runId), {
    name: String(ent?.name ?? "Character"), description: String((ver?.content as { summary?: string } | null)?.summary ?? ""),
    profile: (prof?.confirmed ?? {}) as Record<string, string>, profileVersion: prof?.version ?? 0,
    item: { title: it.title, source: it.knowledge_sources?.origin ?? it.knowledge_sources?.title ?? "", date: it.published_at?.slice(0, 10) ?? null, content: it.content, version: it.version },
  });
  touch(input.projectId);
  return r.ok ? { ok: true } : r;
}

export async function decideImpression(input: { projectId: string; impressionId: string; accept: boolean; text?: string }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("impression_decide", { p_project: input.projectId, p_impression: input.impressionId, p_accept: input.accept, p_text: input.text ?? null });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true, note: input.accept ? "Accepted. It will color this character's dialogue." : "Dismissed." };
}
