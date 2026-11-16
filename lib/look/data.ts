// SERVER. Load Look & Feel for a film (references, directions, and what can be reused).
import { thumbOf, type ThumbSource } from "../thumb";
import { supabaseServer } from "../supabase/server";
import { directionFromRow, refFromRow, type LookDirection, type LookRef } from "./types";

export interface FilmPicture { assetId: string; label: string; entityId: string | null; entityName: string | null; entityKind: string | null }
export interface FilmEntity { id: string; kind: "character" | "location"; name: string; thumb: ThumbSource }

export async function getLook(projectId: string): Promise<{ refs: LookRef[]; directions: LookDirection[] }> {
  const sb = await supabaseServer();
  const [{ data: refRows }, { data: dirRows }, { data: memb }] = await Promise.all([
    sb.from("look_references").select("*").eq("project_id", projectId).is("archived_at", null).order("position"),
    sb.from("look_directions").select("*").eq("project_id", projectId).order("position"),
    sb.from("look_direction_refs").select("direction_id, reference_id, position").eq("project_id", projectId),
  ]);
  const live = new Set((refRows ?? []).map((r) => r.id as string));
  const m = (memb ?? []).filter((x) => live.has(x.reference_id));
  return { refs: (refRows ?? []).map(refFromRow), directions: (dirRows ?? []).map((d) => directionFromRow(d, m)) };
}

/** Characters and locations, with their thumbnails (a treatment crop or a picture). */
export async function getFilmEntities(projectId: string): Promise<FilmEntity[]> {
  const sb = await supabaseServer();
  const { data } = await sb.from("entities").select("id, kind, name, metadata, status").eq("project_id", projectId)
    .in("kind", ["character", "location"]).neq("status", "archived").order("created_at");
  return (data ?? []).map((e) => ({ id: e.id, kind: e.kind as FilmEntity["kind"], name: e.name, thumb: thumbOf(e.metadata as Record<string, unknown>) }));
}

/** Pictures already in this film that can be reused (no copy is made). */
export async function getFilmPictures(projectId: string): Promise<FilmPicture[]> {
  const sb = await supabaseServer();
  const { data } = await sb.from("assets").select("id, display_name, entity_id, created_at, metadata")
    .eq("project_id", projectId).eq("kind", "image").eq("upload_status", "ready").is("deleted_at", null)
    .order("created_at", { ascending: false }).limit(300);
  const rows = (data ?? []).filter((a) => !(a.metadata as Record<string, unknown> | null)?.look_thumbnail);
  const ids = [...new Set(rows.map((a) => a.entity_id).filter(Boolean))] as string[];
  const { data: ents } = ids.length ? await sb.from("entities").select("id, name, kind").in("id", ids) : { data: [] as { id: string; name: string; kind: string }[] };
  const byId = new Map((ents ?? []).map((e) => [e.id, e]));
  return rows.map((a) => {
    const e = a.entity_id ? byId.get(a.entity_id) : undefined;
    return { assetId: a.id, label: a.display_name, entityId: a.entity_id, entityName: e?.name ?? null, entityKind: e?.kind ?? null };
  });
}
