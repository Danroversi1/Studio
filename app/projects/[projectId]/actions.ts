"use server";
// Every action calls a database function that re-checks permissions; hidden buttons are
// only a convenience.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { friendlyError, withMessage } from "@/lib/errors";
import { supabaseServer } from "@/lib/supabase/server";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const opt = (fd: FormData, k: string) => s(fd, k).trim() || null;
const itemPath = (p: string, e: string) => `/projects/${p}/items/${e}`;

export async function createEntity(fd: FormData) {
  const projectId = s(fd, "projectId");
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("create_entity", {
    p_project: projectId,
    p_kind: s(fd, "kind"),
    p_name: s(fd, "name"),
  });
  if (error) redirect(withMessage(`/projects/${projectId}`, "error", friendlyError(error).message));
  revalidatePath(`/projects/${projectId}`, "layout");
  redirect(itemPath(projectId, data));
}

export async function saveRevision(fd: FormData) {
  const projectId = s(fd, "projectId");
  const entityId = s(fd, "entityId");
  const kind = s(fd, "kind");
  const content: Record<string, string> =
    kind === "story" ? { body: s(fd, "body") } : { summary: s(fd, "summary"), notes: s(fd, "notes") };
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("create_revision", {
    p_entity: entityId,
    p_content: content,
    p_change_summary: opt(fd, "changeSummary"),
    p_parent_version: opt(fd, "parentVersionId"),
    p_base_version: opt(fd, "baseVersionId"),
    p_asset_ids: fd.getAll("assetIds").map(String),
    p_status: s(fd, "intent") === "draft" ? "working" : "submitted",
  });
  if (error) redirect(withMessage(itemPath(projectId, entityId), "error", friendlyError(error).message));
  revalidatePath(itemPath(projectId, entityId));
  redirect(withMessage(`${itemPath(projectId, entityId)}?v=${data}`, "notice", "Saved as a new revision. Earlier revisions are unchanged."));
}

export async function approveRevision(fd: FormData) {
  const projectId = s(fd, "projectId");
  const entityId = s(fd, "entityId");
  const versionId = s(fd, "versionId");
  const sb = await supabaseServer();
  const { error } = await sb.rpc("approve_revision", {
    p_version: versionId,
    p_expected_current: opt(fd, "expectedCurrentId"),
  });
  const back = `${itemPath(projectId, entityId)}?v=${versionId}`;
  if (error) redirect(withMessage(back, "error", friendlyError(error).message));
  revalidatePath(`/projects/${projectId}`, "layout");
  redirect(withMessage(back, "notice", "Approved. This is now the version everyone sees."));
}

export async function renameEntity(fd: FormData) {
  const projectId = s(fd, "projectId");
  const entityId = s(fd, "entityId");
  const sb = await supabaseServer();
  const { error } = await sb.rpc("rename_entity", { p_entity: entityId, p_name: s(fd, "name") });
  if (error) redirect(withMessage(itemPath(projectId, entityId), "error", friendlyError(error).message));
  revalidatePath(`/projects/${projectId}`, "layout");
  redirect(itemPath(projectId, entityId));
}

export async function linkEntities(fd: FormData) {
  const projectId = s(fd, "projectId");
  const entityId = s(fd, "entityId");
  const [direction, type] = s(fd, "link").split(":");
  const other = s(fd, "otherId");
  const sb = await supabaseServer();
  const { error } = await sb.rpc("link_entities", {
    p_source: direction === "out" ? entityId : other,
    p_target: direction === "out" ? other : entityId,
    p_type: type,
  });
  if (error) redirect(withMessage(itemPath(projectId, entityId), "error", friendlyError(error).message));
  revalidatePath(itemPath(projectId, entityId));
  redirect(itemPath(projectId, entityId));
}

export async function unlinkEntities(fd: FormData) {
  const projectId = s(fd, "projectId");
  const entityId = s(fd, "entityId");
  const sb = await supabaseServer();
  const { error } = await sb.rpc("unlink_entities", { p_relationship: s(fd, "relationshipId") });
  if (error) redirect(withMessage(itemPath(projectId, entityId), "error", friendlyError(error).message));
  revalidatePath(itemPath(projectId, entityId));
  redirect(itemPath(projectId, entityId));
}

export async function addReference(fd: FormData) {
  const projectId = s(fd, "projectId");
  const entityId = s(fd, "entityId");
  const sb = await supabaseServer();
  const { error } = await sb.rpc("add_reference", {
    p_entity: entityId,
    p_url: s(fd, "url"),
    p_title: opt(fd, "title"),
    p_attribution: s(fd, "attribution"),
    p_notes: opt(fd, "notes"),
    p_rights_status: s(fd, "rights") || "unknown",
  });
  if (error) redirect(withMessage(itemPath(projectId, entityId), "error", friendlyError(error).message));
  revalidatePath(itemPath(projectId, entityId));
  redirect(withMessage(itemPath(projectId, entityId), "notice", "Reference added."));
}
