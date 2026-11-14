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
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getProjectShell(projectId: string) {
  const sb = await supabaseServer();
  const [{ data: project }, { data: caps }, { data: entities }] = await Promise.all([
    sb.from("projects").select("id, name, description").eq("id", projectId).maybeSingle(),
    sb.rpc("my_project_capabilities", { p_project: projectId }),
    sb.from("entities").select("id, kind, name, status, current_version_id, created_at")
      .eq("project_id", projectId).in("kind", ["story", "character", "location"]).order("created_at"),
  ]);
  if (!project) return null;
  return { project, caps: (caps ?? { member: false }) as Capabilities, entities: (entities ?? []) as EntityRow[] };
}

export async function getEntityWorkspace(projectId: string, entityId: string) {
  const sb = await supabaseServer();
  const { data: entity } = await sb
    .from("entities")
    .select("id, kind, name, status, current_version_id, created_at")
    .eq("id", entityId).eq("project_id", projectId).maybeSingle();
  if (!entity) return null;

  const [versionsRes, assetsRes, relsRes, boardsRes] = await Promise.all([
    sb.from("versions")
      .select("id, version_number, status, content, change_summary, created_by, created_at, parent_version_id, base_version_id")
      .eq("entity_id", entityId).order("version_number", { ascending: false }),
    sb.from("assets").select("id, display_name, mime_type, byte_size, created_at")
      .eq("entity_id", entityId).order("created_at", { ascending: false }),
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
          .select("id, title, source_url, source_domain, attribution, rights_status, observations, created_at")
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
