// SERVER ONLY. A character's agent configuration, connected research and recent partner turns.
import { supabaseServer } from "../supabase/server";
import type { CharacterProfile } from "./fields";

export async function getCharacterAgent(projectId: string, entityId: string) {
  const sb = await supabaseServer();
  const [p, links, runs] = await Promise.all([
    sb.from("character_profiles").select("version, confirmed, proposed").eq("entity_id", entityId).maybeSingle(),
    sb.from("character_knowledge").select("id, purpose, temporal, scope_terms, collection_id, knowledge_collections(name)").eq("project_id", projectId)
      .eq("character_id", entityId).is("archived_at", null),
    sb.from("agent_runs").select("id, status, created_at, input_payload, output_payload, error_message").eq("project_id", projectId)
      .eq("task_type", "character_talk").eq("input_payload->>entity_id", entityId).order("created_at", { ascending: false }).limit(6),
  ]);
  const profile: CharacterProfile = p.data ? { version: p.data.version, confirmed: p.data.confirmed ?? {}, proposed: p.data.proposed ?? [] } : { version: 0, confirmed: {}, proposed: [] };
  return {
    profile,
    links: ((links.data ?? []) as unknown as { id: string; purpose: string; temporal: string; scope_terms: string[]; collection_id: string; knowledge_collections: { name: string } | null }[])
      .map((l) => ({ id: l.id, purpose: l.purpose, temporal: l.temporal, scope: l.scope_terms, collection: l.knowledge_collections?.name ?? "Collection" })),
    turns: ((runs.data ?? []) as { id: string; status: string; created_at: string; input_payload: { message?: string } | null; output_payload: { reply?: string } | null; error_message: string | null }[])
      .reverse().map((r) => ({ id: r.id, at: r.created_at, message: String(r.input_payload?.message ?? ""), reply: r.status === "succeeded" ? String(r.output_payload?.reply ?? "") : "", failed: r.status === "failed" })),
  };
}
