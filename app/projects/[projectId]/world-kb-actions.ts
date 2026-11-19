"use server";
// Character impressions (qualia) of World items: the only part of World that uses a model,
// and only when she asks (Claude Haiku, a few hundredths of a cent each).
import { revalidatePath } from "next/cache";
import { aiConfigured } from "@/lib/ai/configured";
import { friendlyError } from "@/lib/errors";
import { runImpression } from "@/lib/agents/run-impression";
import { supabaseServer } from "@/lib/supabase/server";

type R = { ok: true; id?: string; note?: string } | { ok: false; error: string };
const fail = (e: { code?: string; message?: string } | null): R => ({ ok: false, error: friendlyError(e).message });
const touch = (projectId: string) => { revalidatePath(`/projects/${projectId}/knowledge`); revalidatePath(`/projects/${projectId}/connections`); revalidatePath(`/projects/${projectId}/script`); };

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

