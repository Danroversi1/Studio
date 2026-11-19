import { isTreatmentRef, parseIntake } from "./intake";
import { supabaseServer } from "./supabase/server";

export type Kind = "story" | "character" | "location";
export type VersionStatus = "working" | "submitted" | "approved" | "rejected" | "superseded";

export interface Capabilities {
  member: boolean;
  project_role?: "director" | "executive_producer" | "collaborator";
  access_level?: "view" | "review" | "edit" | "commit";
  can_view?: boolean;
  can_review?: boolean;
  can_edit?: boolean;
  can_commit?: boolean;
  can_admin?: boolean;
  can_approve_creative?: boolean;
  can_authorize_spend?: boolean;
  can_approve_canonical?: boolean;
}

export interface EntityRow {
  id: string;
  kind: Kind;
  name: string;
  status: string;
  current_version_id: string | null;
  created_at: string;
  metadata?: Record<string, unknown> | null;
}

export interface VersionRow {
  id: string;
  version_number: number;
  status: VersionStatus;
  content: Record<string, string>;
  change_summary: string | null;
  created_by: string;
  created_at: string;
  parent_version_id: string | null;
  base_version_id: string | null;
}

export async function currentUser() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  return data.user;
}

export async function listProjects() {
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from("projects")
    .select("id, name, description, created_at, updated_at")
    .neq("status", "deleted")
    .order("created_at", { ascending: true });
  if (error) throw error;
  // The card shows her current synopsis from the Story desk (her own words), falling back
  // to the one-line idea she typed when she created the film.
  const ids = (data ?? []).map((p) => p.id);
  const ideas = new Map<string, string>();
  if (ids.length) {
    const { data: stories } = await sb.from("entities").select("id, project_id").in("project_id", ids).eq("kind", "story").is("archived_at", null);
    const storyIds = (stories ?? []).map((s) => s.id);
    if (storyIds.length) {
      const { data: vs } = await sb.from("versions").select("entity_id, version_number, content")
        .in("entity_id", storyIds).order("version_number", { ascending: false });
      const seen = new Set<string>();
      const projOf = new Map((stories ?? []).map((s) => [s.id, s.project_id]));
      for (const v of vs ?? []) {
        if (seen.has(v.entity_id)) continue;
        seen.add(v.entity_id);
        const idea = parseIntake(String((v.content as Record<string, unknown>)?.body ?? "")).idea.replace(/\s+/g, " ").trim();
        if (idea) ideas.set(projOf.get(v.entity_id)!, idea.length > 280 ? `${idea.slice(0, 277).trimEnd()}…` : idea);
      }
    }
  }
  return (data ?? []).map((p) => ({ ...p, description: ideas.get(p.id) ?? p.description }));
}

export async function getProjectShell(projectId: string) {
  const sb = await supabaseServer();
  const [{ data: project }, { data: caps }, { data: entities }] = await Promise.all([
    sb.from("projects").select("id, name, description, runtime:settings->>runtime").eq("id", projectId).maybeSingle(),
    sb.rpc("my_project_capabilities", { p_project: projectId }),
    sb.from("entities").select("id, kind, name, status, current_version_id, created_at, metadata")
      .eq("project_id", projectId).in("kind", ["story", "character", "location"]).neq("status", "archived").order("created_at"),
  ]);
  if (!project) return null;
  return { project, caps: (caps ?? { member: false }) as Capabilities, entities: (entities ?? []) as EntityRow[] };
}

/** Latest visible revision per item, for overview card previews. */
export async function getLatestVersions(projectId: string) {
  const sb = await supabaseServer();
  const { data } = await sb
    .from("versions").select("entity_id, version_number, status, content")
    .eq("project_id", projectId).order("version_number", { ascending: false });
  const latest = new Map<string, { version_number: number; status: VersionStatus; content: Record<string, string> }>();
  for (const v of data ?? []) if (!latest.has(v.entity_id)) latest.set(v.entity_id, v as never);
  return latest;
}

export async function getStoryReferences(projectId: string, storyId: string) {
  const sb = await supabaseServer();
  const { data: boards } = await sb.from("research_boards").select("id").eq("project_id", projectId).eq("entity_id", storyId);
  const ids = (boards ?? []).map((b) => b.id);
  if (!ids.length) return [];
  const { data } = await sb.from("research_references")
    .select("id, title, source_url, source_domain, attribution, observations, preview_asset_id, created_at, metadata")
    .in("board_id", ids).order("created_at", { ascending: false });
  return data ?? [];
}

export interface AiBudget {
  can_manage: boolean;
  available: boolean;
  budget_usd?: number;
  spent_usd?: number;
  remaining_usd?: number;
}

export async function getAiBudget(projectId: string) {
  const sb = await supabaseServer();
  const { data } = await sb.rpc("my_ai_budget", { p_project: projectId });
  return (data ?? { can_manage: false, available: false }) as AiBudget;
}

export async function countPendingSuggestions(projectId: string) {
  const sb = await supabaseServer();
  const { count } = await sb
    .from("agent_proposals").select("id", { count: "exact", head: true })
    .eq("project_id", projectId).eq("status", "pending");
  return count ?? 0;
}

export async function getSuggestions(projectId: string) {
  const sb = await supabaseServer();
  const [runs, proposals] = await Promise.all([
    sb.from("agent_runs")
      .select("id, status, task_type, created_at, completed_at, error_message, output_payload, source:input_payload->>source")
      .eq("project_id", projectId).eq("task_type", "story_breakdown").order("created_at", { ascending: false }).limit(5),
    sb.from("agent_proposals")
      .select("id, agent_run_id, entity_kind, name, summary, evidence, match_entity_id, status, result_entity_id, created_at")
      .eq("project_id", projectId).order("created_at", { ascending: true }).limit(200),
  ]);
  return { runs: runs.data ?? [], proposals: proposals.data ?? [] };
}

export async function getEntityWorkspace(projectId: string, entityId: string) {
  const sb = await supabaseServer();
  const { data: entity } = await sb
    .from("entities")
    .select("id, kind, name, status, current_version_id, created_at, metadata")
    .eq("id", entityId).eq("project_id", projectId).maybeSingle();
  if (!entity) return null;

  const [versionsRes, assetsRes, relsRes, boardsRes] = await Promise.all([
    sb.from("versions")
      .select("id, version_number, status, content, change_summary, created_by, created_at, parent_version_id, base_version_id")
      .eq("entity_id", entityId).order("version_number", { ascending: false }),
    sb.from("assets").select("id, display_name, mime_type, byte_size, created_at")
      .eq("entity_id", entityId).neq("origin", "import").order("created_at", { ascending: false }),
    sb.from("entity_relationships").select("id, source_entity_id, target_entity_id, relationship_type")
      .eq("project_id", projectId).or(`source_entity_id.eq.${entityId},target_entity_id.eq.${entityId}`),
    sb.from("research_boards").select("id").eq("entity_id", entityId),
  ]);
  const versions = (versionsRes.data ?? []) as VersionRow[];
  const boardIds = (boardsRes.data ?? []).map((b) => b.id);
  const [versionAssetsRes, refsRes] = await Promise.all([
    versions.length
      ? sb.from("version_assets").select("version_id, asset_id, position").in("version_id", versions.map((v) => v.id))
      : Promise.resolve({ data: [] as { version_id: string; asset_id: string; position: number }[] }),
    boardIds.length
      ? sb.from("research_references")
          .select("id, title, source_url, source_domain, attribution, rights_status, observations, preview_asset_id, created_at")
          .in("board_id", boardIds).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const artworkByVersion = new Map<string, string[]>();
  for (const va of (versionAssetsRes.data ?? []).sort((a, b) => a.position - b.position)) {
    artworkByVersion.set(va.version_id, [...(artworkByVersion.get(va.version_id) ?? []), va.asset_id]);
  }

  return {
    entity: entity as EntityRow,
    versions,
    assets: assetsRes.data ?? [],
    artworkByVersion,
    relationships: relsRes.data ?? [],
    references: refsRes.data ?? [],
  };
}

export async function getPartnerThreads(projectId: string, agent: string) {
  const sb = await supabaseServer();
  const { data } = await sb.from("agent_threads").select("id, title, created_at, last_message_at")
    .eq("project_id", projectId).eq("agent", agent).order("last_message_at", { ascending: false }).limit(30);
  return data ?? [];
}

export async function getThreadMessages(projectId: string, threadId: string) {
  const sb = await supabaseServer();
  const { data } = await sb.from("agent_messages").select("id, role, content, created_at")
    .eq("project_id", projectId).eq("thread_id", threadId).order("created_at", { ascending: true }).limit(400);
  return (data ?? []) as { id: string; role: "user" | "assistant"; content: string; created_at: string }[];
}

/** The film's screenplay item and its revisions (newest first), or null if not started. */
export async function getScreenplay(projectId: string) {
  const sb = await supabaseServer();
  const { data: entity } = await sb.from("entities").select("id, current_version_id")
    .eq("project_id", projectId).eq("kind", "screenplay").order("created_at").limit(1).maybeSingle();
  if (!entity) return null;
  const { data: versions } = await sb.from("versions")
    .select("id, version_number, status, content, change_summary, created_at, base_version_id")
    .eq("entity_id", entity.id).order("version_number", { ascending: false });
  return { entity, versions: (versions ?? []) as { id: string; version_number: number; status: string; content: { body?: string }; change_summary: string | null; created_at: string; base_version_id: string | null }[] };
}

export interface NotebookItem {
  id: string; kind: string; body: string; status: string; source: string; her_words: string | null; created_at: string; position?: number | null;
}

/** The story notebook (everything except removed items), oldest first. */
export async function getNotebook(projectId: string) {
  const sb = await supabaseServer();
  const { data } = await sb.from("story_notebook").select("id, kind, body, status, source, her_words, created_at, position")
    .eq("project_id", projectId).neq("status", "archived").order("created_at", { ascending: true }).limit(300);
  const { sortByOrder } = await import("./notebook-order");
  return sortByOrder((data ?? []) as NotebookItem[]);
}

export interface ReferenceRow {
  id: string; title: string | null; source_url: string; source_domain: string; attribution: string;
  rights_status: string; observations: string | null; preview_asset_id: string | null; department: string | null;
  created_at: string; entity_id: string;
}

/** Every reference in the film with the item it belongs to (treatment links excluded). */
export async function getAllReferences(projectId: string) {
  const sb = await supabaseServer();
  const { data: boards } = await sb.from("research_boards").select("id, entity_id").eq("project_id", projectId);
  const entityOf = new Map((boards ?? []).map((b) => [b.id, b.entity_id as string]));
  if (!entityOf.size) return [] as ReferenceRow[];
  const { data } = await sb.from("research_references")
    .select("id, board_id, title, source_url, source_domain, attribution, rights_status, observations, preview_asset_id, department, created_at")
    .in("board_id", [...entityOf.keys()]).order("created_at", { ascending: false }).limit(500);
  return (data ?? [])
    .filter((r) => !isTreatmentRef(r))
    .map((r) => ({ ...r, entity_id: entityOf.get(r.board_id) ?? "" })) as ReferenceRow[];
}

/** The film's characters with their latest description: the one cast every desk shows. */
export async function getCast(projectId: string) {
  const sb = await supabaseServer();
  const [{ data: ents }, { data: vers }] = await Promise.all([
    sb.from("entities").select("id, name, current_version_id, created_at, metadata")
      .eq("project_id", projectId).eq("kind", "character").neq("status", "archived").order("created_at"),
    sb.from("versions").select("id, entity_id, version_number, content")
      .eq("project_id", projectId).order("version_number", { ascending: false }),
  ]);
  const latest = new Map<string, { id: string; content: Record<string, string> }>();
  for (const v of vers ?? []) if (!latest.has(v.entity_id)) latest.set(v.entity_id, v as never);
  const { byRole, roleOf } = await import("./characters/roles");
  const seen = await getAppearances(projectId, (ents ?? []).map((e) => e.name as string));
  return byRole((ents ?? []).map((e) => {
    const l = latest.get(e.id);
    return {
      id: e.id as string, name: e.name as string, role: roleOf(e.metadata as Record<string, unknown> | null), approved: !!e.current_version_id, latestId: l?.id ?? null,
      summary: String(l?.content?.summary ?? ""), notes: String(l?.content?.notes ?? ""),
    };
  }), seen);
}

/** Her own words for each character, from the cast answer in her story (lowercase name → text). */
export async function getCastOriginals(projectId: string): Promise<Record<string, string>> {
  const sb = await supabaseServer();
  const { data: story } = await sb.from("entities").select("id").eq("project_id", projectId).eq("kind", "story").order("created_at").limit(1).maybeSingle();
  if (!story) return {};
  const { data: v } = await sb.from("versions").select("content").eq("entity_id", story.id).order("version_number", { ascending: false }).limit(1).maybeSingle();
  const { parseIntake } = await import("./intake");
  const { parseCast } = await import("./cast");
  return Object.fromEntries(parseCast(parseIntake(String(v?.content?.body ?? "")).who).map((c) => [c.name.toLowerCase(), c.description]));
}

/** Scenes each character appears in, from her latest script (keyed by lowercase name). */
export async function getAppearances(projectId: string, names: string[]): Promise<Record<string, number>> {
  const sb = await supabaseServer();
  const { latestScript } = await import("./knowledge/connect-data");
  const { countAppearances } = await import("./characters/appearances");
  const script = await latestScript(sb, projectId);
  return countAppearances(script.body, names);
}

/** Her earlier "world in a sentence" versions, newest first (distinct texts). */
export async function getWorldSentenceVersions(projectId: string): Promise<{ text: string; at: string }[]> {
  const sb = await supabaseServer();
  const { data } = await sb.from("story_world_history").select("value, created_at").eq("project_id", projectId).eq("section", "summary")
    .in("change", ["set", "accept"]).order("created_at", { ascending: false }).limit(30);
  const seen = new Set<string>(); const out: { text: string; at: string }[] = [];
  for (const r of (data ?? []) as { value: { text?: unknown } | null; created_at: string }[]) {
    const t = typeof r.value?.text === "string" ? r.value.text.trim() : "";
    if (!t || seen.has(t)) continue;
    seen.add(t); out.push({ text: t, at: r.created_at });
  }
  return out.slice(0, 10);
}

/** World & Time for a film (empty world if nothing yet). */
export async function getWorld(projectId: string) {
  const sb = await supabaseServer();
  const { data } = await sb.from("story_world").select("data, version").eq("project_id", projectId).maybeSingle();
  const { toWorld } = await import("./world");
  return toWorld(data);
}

/** Everything the Connections board shows. */
export async function getBoard(projectId: string) {
  const sb = await supabaseServer();
  const [{ data: notes }, { data: positions }, { data: links }] = await Promise.all([
    sb.from("story_board_notes").select("id, body, color").eq("project_id", projectId).order("created_at"),
    sb.from("story_board_positions").select("node_key, x, y").eq("project_id", projectId),
    sb.from("story_board_links").select("id, from_key, to_key, label").eq("project_id", projectId).order("created_at"),
  ]);
  return {
    notes: (notes ?? []) as { id: string; body: string; color: string }[],
    positions: Object.fromEntries((positions ?? []).map((p) => [p.node_key, { x: Number(p.x), y: Number(p.y) }])) as Record<string, { x: number; y: number }>,
    links: (links ?? []).map((l) => ({ id: l.id as string, from: l.from_key as string, to: l.to_key as string, label: (l.label as string | null) ?? null })),
  };
}
