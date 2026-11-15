"use server";
// Every action calls a database function that re-checks permissions; hidden buttons are
// only a convenience.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { isPartnerId } from "@/lib/agents/partners";
import { runPartnerTurn } from "@/lib/agents/run-partner-turn";
import { aiConfigured, runStoryBreakdown } from "@/lib/agents/run-story-breakdown";
import { friendlyError, withMessage } from "@/lib/errors";
import { TREATMENT_ATTRIBUTION, TREATMENT_NOTES, composeIntake } from "@/lib/intake";
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
  if (error) redirect(withMessage(`/projects/${projectId}/add`, "error", friendlyError(error).message));
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

// ---------------------------------------------------------------- Story Lead suggestions

const suggestionsPath = (p: string) => `/projects/${p}/suggestions`;

export async function requestBreakdown(fd: FormData) {
  const projectId = s(fd, "projectId");
  const entityId = s(fd, "entityId");
  if (!aiConfigured()) {
    redirect(withMessage(itemPath(projectId, entityId), "error", "The AI team isn't set up yet. Ask your Executive Producer."));
  }
  const sb = await supabaseServer();
  const { data: runId, error } = await sb.rpc("request_story_breakdown", { p_entity: entityId });
  if (error) redirect(withMessage(itemPath(projectId, entityId), "error", friendlyError(error).message));
  // Runs after the response is sent; the inbox shows progress.
  after(() => runStoryBreakdown(runId as string));
  redirect(suggestionsPath(projectId));
}

/**
 * The Story Lead reads the director's treatment. The browser fetched the text with the
 * Director's own Google permission; the database checks the treatment link belongs to this
 * story, stores the text with the run, and applies the usual access and budget rules.
 */
export async function requestTreatmentBreakdown(input: {
  projectId: string; storyId: string; referenceId: string; text: string;
}): Promise<{ error: string } | void> {
  if (!aiConfigured()) return { error: "The AI team isn't set up yet. Ask your Executive Producer." };
  if (typeof input?.text !== "string") return { error: "No treatment text was received." };
  const sb = await supabaseServer();
  const { data: runId, error } = await sb.rpc("request_treatment_breakdown", {
    p_entity: input.storyId,
    p_reference: input.referenceId,
    p_text: input.text,
  });
  if (error) return { error: friendlyError(error).message };
  after(() => runStoryBreakdown(runId as string));
  redirect(suggestionsPath(input.projectId));
}

export async function acceptProposal(fd: FormData) {
  const projectId = s(fd, "projectId");
  const sb = await supabaseServer();
  const { error } = await sb.rpc("accept_proposal", {
    p_proposal: s(fd, "proposalId"),
    p_name: opt(fd, "name"),
    p_summary: s(fd, "summary"),
  });
  if (error) redirect(withMessage(suggestionsPath(projectId), "error", friendlyError(error).message));
  revalidatePath(`/projects/${projectId}`, "layout");
  redirect(withMessage(suggestionsPath(projectId), "notice", "Added to your film as a proposed revision. Approve it from its page when you're happy."));
}

/**
 * Add every waiting suggestion that isn't a likely duplicate, as-is. Each one becomes a new
 * item with a proposed (unapproved) revision; possible duplicates are left for her to decide.
 */
export async function acceptAllProposals(fd: FormData) {
  const projectId = s(fd, "projectId");
  const sb = await supabaseServer();
  const { data: pending, error: readErr } = await sb.from("agent_proposals")
    .select("id, name, summary").eq("project_id", projectId).eq("status", "pending").is("match_entity_id", null)
    .order("created_at", { ascending: true }).limit(100);
  if (readErr) redirect(withMessage(suggestionsPath(projectId), "error", friendlyError(readErr).message));
  let added = 0;
  for (const p of pending ?? []) {
    const { error } = await sb.rpc("accept_proposal", { p_proposal: p.id, p_name: null, p_summary: p.summary ?? "" });
    if (error) {
      revalidatePath(`/projects/${projectId}`, "layout");
      redirect(withMessage(suggestionsPath(projectId), "error", `${added} added, then: ${friendlyError(error).message}`));
    }
    added++;
  }
  revalidatePath(`/projects/${projectId}`, "layout");
  redirect(withMessage(suggestionsPath(projectId), "notice",
    `Added ${added} ${added === 1 ? "item" : "items"} to your film as proposed revisions. Approve each from its page when you're happy.`));
}

export async function mergeProposal(fd: FormData) {
  const projectId = s(fd, "projectId");
  const sb = await supabaseServer();
  const { error } = await sb.rpc("merge_proposal", { p_proposal: s(fd, "proposalId"), p_entity: opt(fd, "targetId") });
  if (error) redirect(withMessage(suggestionsPath(projectId), "error", friendlyError(error).message));
  revalidatePath(`/projects/${projectId}`, "layout");
  redirect(withMessage(suggestionsPath(projectId), "notice", "Linked to your existing item."));
}

export async function dismissProposal(fd: FormData) {
  const projectId = s(fd, "projectId");
  const sb = await supabaseServer();
  const { error } = await sb.rpc("dismiss_proposal", { p_proposal: s(fd, "proposalId") });
  if (error) redirect(withMessage(suggestionsPath(projectId), "error", friendlyError(error).message));
  revalidatePath(suggestionsPath(projectId));
  redirect(suggestionsPath(projectId));
}

export async function setAiBudget(fd: FormData) {
  const projectId = s(fd, "projectId");
  const sb = await supabaseServer();
  const { error } = await sb.rpc("set_ai_budget", { p_project: projectId, p_budget_usd: Number(s(fd, "budget")) });
  if (error) redirect(withMessage(suggestionsPath(projectId), "error", friendlyError(error).message));
  revalidatePath(suggestionsPath(projectId));
  redirect(withMessage(suggestionsPath(projectId), "notice", "Monthly AI budget updated."));
}

// ---------------------------------------------------------------- Project intake (Start page)

const startPath = (p: string) => `/projects/${p}`;
const addPath = (p: string) => `/projects/${p}/add`;

export async function saveSynopsis(fd: FormData) {
  const projectId = s(fd, "projectId");
  const entityId = s(fd, "entityId");
  const sb = await supabaseServer();
  // The intake form sends three answers; they're saved together as one story revision.
  const body = fd.has("idea")
    ? composeIntake({ idea: s(fd, "idea"), who: s(fd, "who"), difficulty: s(fd, "difficulty") })
    : s(fd, "body");
  if (!body.trim()) redirect(withMessage(addPath(projectId), "error", "Start with your story idea: even one sentence is enough."));
  const { error } = await sb.rpc("create_revision", {
    p_entity: entityId,
    p_content: { body },
    p_change_summary: fd.has("idea") ? "Story intake" : "Synopsis",
    p_parent_version: opt(fd, "parentVersionId"),
    p_base_version: opt(fd, "baseVersionId"),
    p_asset_ids: [],
    p_status: "submitted",
  });
  if (error) redirect(withMessage(addPath(projectId), "error", friendlyError(error).message));
  revalidatePath(`/projects/${projectId}`, "layout");
  redirect(withMessage(addPath(projectId), "notice", "Saved as a new story revision. Earlier versions are kept in the story's history."));
}

export async function addTreatmentLink(fd: FormData) {
  const projectId = s(fd, "projectId");
  const entityId = s(fd, "entityId");
  const sb = await supabaseServer();
  const { error } = await sb.rpc("add_reference", {
    p_entity: entityId,
    p_url: s(fd, "url"),
    p_title: opt(fd, "title") ?? "Director treatment",
    p_attribution: TREATMENT_ATTRIBUTION,
    p_notes: TREATMENT_NOTES,
    p_rights_status: "permission_granted",
  });
  if (error) redirect(withMessage(addPath(projectId), "error", friendlyError(error).message));
  revalidatePath(addPath(projectId));
  redirect(withMessage(addPath(projectId), "notice", "Treatment link added to your story."));
}

export async function deleteProject(fd: FormData) {
  const projectId = s(fd, "projectId");
  const sb = await supabaseServer();
  const { error } = await sb.rpc("delete_project", { p_project: projectId, p_confirm_name: s(fd, "confirmName") });
  if (error) redirect(withMessage(`/projects/${projectId}/settings`, "error", friendlyError(error).message));
  revalidatePath("/projects");
  redirect(withMessage("/projects", "notice", "Film deleted. If that was a mistake, it can still be recovered — ask for help soon."));
}

/**
 * Talk to a creative partner. The database checks Edit access, the budget and that the
 * previous reply has finished; the reply is produced here and recorded by the service role.
 */
export async function sendPartnerMessage(input: {
  projectId: string; agent: string; threadId: string | null; content: string;
}): Promise<{ threadId?: string; error?: string }> {
  if (!aiConfigured()) return { error: "The AI team isn't set up yet. Ask your Executive Producer." };
  if (!isPartnerId(input?.agent)) return { error: "Unknown partner." };
  const sb = await supabaseServer();
  let threadId = input.threadId;
  if (!threadId) {
    const { data, error } = await sb.rpc("start_agent_thread", { p_project: input.projectId, p_agent: input.agent });
    if (error) return { error: friendlyError(error).message };
    threadId = data as string;
  }
  const { data: runId, error } = await sb.rpc("post_agent_message", { p_thread: threadId, p_content: input.content });
  if (error) return { threadId, error: friendlyError(error).message };
  const failure = await runPartnerTurn(runId as string);
  revalidatePath(`/projects/${input.projectId}`, "layout");
  return failure
    ? { threadId, error: "Your partner couldn't answer just now. Your message is saved; try sending a short follow-up." }
    : { threadId };
}

const scriptPath = (p: string) => `/projects/${p}/script`;

/** Save the screenplay as a new revision (the film's one screenplay item is created on first save). */
export async function saveScreenplay(fd: FormData) {
  const projectId = s(fd, "projectId");
  const sb = await supabaseServer();
  let entityId = s(fd, "entityId");
  if (!entityId) {
    const { data, error } = await sb.rpc("open_screenplay", { p_project: projectId });
    if (error) redirect(withMessage(scriptPath(projectId), "error", friendlyError(error).message));
    entityId = data as string;
  }
  const { data, error } = await sb.rpc("create_revision", {
    p_entity: entityId,
    p_content: { body: s(fd, "body") },
    p_change_summary: opt(fd, "changeSummary"),
    p_parent_version: opt(fd, "parentVersionId"),
    p_base_version: opt(fd, "baseVersionId"),
    p_asset_ids: [],
    p_status: "submitted",
  });
  if (error) redirect(withMessage(scriptPath(projectId), "error", friendlyError(error).message));
  revalidatePath(scriptPath(projectId));
  redirect(withMessage(`${scriptPath(projectId)}?v=${data}`, "notice", "Saved as a new revision. Earlier revisions are unchanged."));
}

export async function approveScreenplay(fd: FormData) {
  const projectId = s(fd, "projectId");
  const versionId = s(fd, "versionId");
  const sb = await supabaseServer();
  const { error } = await sb.rpc("approve_revision", { p_version: versionId, p_expected_current: opt(fd, "expectedCurrentId") });
  const back = `${scriptPath(projectId)}?v=${versionId}`;
  if (error) redirect(withMessage(back, "error", friendlyError(error).message));
  revalidatePath(`/projects/${projectId}`, "layout");
  redirect(withMessage(back, "notice", "Approved. This is now the script everyone sees."));
}
