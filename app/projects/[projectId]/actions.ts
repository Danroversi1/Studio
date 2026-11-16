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
import { parseCast } from "@/lib/cast";
import { between, sortByOrder } from "@/lib/notebook-order";
import { runScenePlan } from "@/lib/agents/run-scene-plan";
import { PARTS, blocksFor, insertScenesInOrder, parseBreakdown, titleCase, uncoveredBeats, type Beat, type Part } from "@/lib/scene-plan";
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
  const back = backTo(fd, projectId, itemPath(projectId, entityId));
  const { data: refId, error } = await sb.rpc("add_reference", {
    p_entity: entityId,
    p_url: s(fd, "url"),
    p_title: opt(fd, "title"),
    p_attribution: s(fd, "attribution"),
    p_notes: (() => {
      // World & Time references carry their tag (and "imagined" when it isn't a real place).
      const tag = opt(fd, "tag") === "world" ? `World & Time${fd.get("imagined") === "1" ? " · imagined image, not a real place" : ""}` : null;
      const n = opt(fd, "notes");
      return tag ? (n ? `${tag} — ${n}` : tag) : n;
    })(),
    p_rights_status: s(fd, "rights") || "unknown",
  });
  if (error) redirect(withMessage(back, "error", friendlyError(error).message));
  const dept = opt(fd, "department");
  if (dept) {
    const { error: e2 } = await sb.rpc("set_reference_department", { p_reference: refId, p_department: dept });
    if (e2) redirect(withMessage(back, "error", friendlyError(e2).message));
  }
  revalidatePath(`/projects/${projectId}`, "layout");
  redirect(withMessage(back, "notice", "Reference added."));
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
    ? composeIntake({ idea: s(fd, "idea"), who: s(fd, "who"), difficulty: s(fd, "difficulty"), climax: s(fd, "climax") })
    : s(fd, "body");
  const back = backTo(fd, projectId, addPath(projectId));
  if (!body.trim()) redirect(withMessage(back, "error", "Start with your story idea: even one sentence is enough."));
  const { data: newVersion, error } = await sb.rpc("create_revision", {
    p_entity: entityId,
    p_content: { body },
    p_change_summary: fd.has("idea") ? "Story" : "Synopsis",
    p_parent_version: opt(fd, "parentVersionId"),
    p_base_version: opt(fd, "baseVersionId"),
    p_asset_ids: [],
    p_status: "submitted",
  });
  if (error) redirect(withMessage(back, "error", friendlyError(error).message));
  revalidatePath(`/projects/${projectId}`, "layout");
  const added = fd.get("syncCast") === "1" ? await addCastFromText(sb, projectId, s(fd, "who")) : [];
  revalidatePath(`/projects/${projectId}`, "layout");
  const note = added.length
    ? `Saved. Characters updated: ${joinNames(added)}.`
    : "Saved. Earlier versions are kept under Revisions.";
  redirect(withMessage(back.includes("/items/") ? `${back}?v=${newVersion}` : back, "notice", note));
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
  if (error) redirect(withMessage(backTo(fd, projectId, `/projects/${projectId}/treatment`), "error", friendlyError(error).message));
  revalidatePath(backTo(fd, projectId, `/projects/${projectId}/treatment`));
  redirect(withMessage(backTo(fd, projectId, `/projects/${projectId}/treatment`), "notice", "Treatment link added to your story."));
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
}): Promise<{ threadId?: string; error?: string; unsent?: boolean }> {
  if (!aiConfigured()) return { error: "The AI team isn't set up yet. Ask your Executive Producer.", unsent: true };
  if (!isPartnerId(input?.agent)) return { error: "Unknown partner.", unsent: true };
  const sb = await supabaseServer();
  let threadId = input.threadId;
  if (!threadId) {
    const { data, error } = await sb.rpc("start_agent_thread", { p_project: input.projectId, p_agent: input.agent });
    if (error) return { error: friendlyError(error).message, unsent: true };
    threadId = data as string;
  }
  const { data: runId, error } = await sb.rpc("post_agent_message", { p_thread: threadId, p_content: input.content });
  if (error) return { threadId, error: friendlyError(error).message, unsent: true };
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
  const newPlaces = await syncLocationsFromScript(sb, projectId, s(fd, "body"));
  revalidatePath(`/projects/${projectId}`, "layout");
  redirect(withMessage(`${scriptPath(projectId)}?v=${data}`, "notice",
    newPlaces.length ? `Saved. Added ${joinNames(newPlaces)} to Locations.` : "Saved as a new revision. Earlier revisions are unchanged."));
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

/** Where to return after a small form; only paths inside this film are accepted. */
function backTo(fd: FormData, projectId: string, fallback: string) {
  const b = s(fd, "back");
  return b.startsWith(`/projects/${projectId}/`) || b === `/projects/${projectId}` ? b : fallback;
}

export async function setRuntime(fd: FormData) {
  const projectId = s(fd, "projectId");
  const back = backTo(fd, projectId, addPath(projectId));
  const value = s(fd, "runtime");
  const sb = await supabaseServer();
  const { error } = await sb.rpc("set_film_runtime", { p_project: projectId, p_runtime: value || null });
  if (error) redirect(withMessage(back, "error", friendlyError(error).message));
  revalidatePath(`/projects/${projectId}`, "layout");
  redirect(back);
}

export async function addNote(fd: FormData) {
  const projectId = s(fd, "projectId");
  const back = backTo(fd, projectId, `/projects/${projectId}/partners/story`);
  const sb = await supabaseServer();
  const { error } = await sb.rpc("add_notebook_item", { p_project: projectId, p_kind: s(fd, "kind"), p_body: s(fd, "body") });
  if (error) redirect(withMessage(back, "error", friendlyError(error).message));
  if ((PARTS as string[]).includes(s(fd, "kind"))) after(() => planScenes(projectId).catch(() => undefined));
  revalidatePath(back);
  redirect(back);
}

export async function updateNote(fd: FormData) {
  const projectId = s(fd, "projectId");
  const back = backTo(fd, projectId, `/projects/${projectId}/partners/story`);
  const sb = await supabaseServer();
  const { error } = await sb.rpc("update_notebook_item", {
    p_item: s(fd, "itemId"), p_status: opt(fd, "status"), p_kind: opt(fd, "kind"), p_body: opt(fd, "body"),
  });
  if (error) redirect(withMessage(back, "error", friendlyError(error).message));
  revalidatePath(back);
  redirect(back);
}

export async function fileReference(fd: FormData) {
  const projectId = s(fd, "projectId");
  const back = backTo(fd, projectId, `/projects/${projectId}/references`);
  const sb = await supabaseServer();
  const { error } = await sb.rpc("set_reference_department", { p_reference: s(fd, "referenceId"), p_department: opt(fd, "department") });
  if (error) redirect(withMessage(back, "error", friendlyError(error).message));
  revalidatePath(back);
  redirect(back);
}

export async function setThumbnail(fd: FormData) {
  const projectId = s(fd, "projectId");
  const entityId = s(fd, "entityId");
  const sb = await supabaseServer();
  const { error } = await sb.rpc("set_entity_thumbnail", { p_entity: entityId, p_asset: opt(fd, "assetId") });
  if (error) redirect(withMessage(itemPath(projectId, entityId), "error", friendlyError(error).message));
  revalidatePath(`/projects/${projectId}`, "layout");
  redirect(`${withMessage(itemPath(projectId, entityId), "notice", "Thumbnail updated.")}#thumbnail`);
}

type Sb = Awaited<ReturnType<typeof supabaseServer>>;

/** Keeps Characters in step with her cast answer: new names become characters, and a
 *  changed "Name: who they are" line becomes a new revision of that character. */
async function addCastFromText(sb: Sb, projectId: string, text: string): Promise<string[]> {
  const changed: string[] = [];
  const { data: existing } = await sb.from("entities").select("id, name").eq("project_id", projectId).eq("kind", "character").neq("status", "archived");
  const byName = new Map((existing ?? []).map((e) => [String(e.name).trim().toLowerCase(), String(e.id)]));
  const ids = [...byName.values()];
  const latest = new Map<string, { id: string; content: Record<string, string> }>();
  if (ids.length) {
    const { data: vers } = await sb.from("versions").select("id, entity_id, version_number, content").in("entity_id", ids).order("version_number", { ascending: false });
    for (const v of vers ?? []) if (!latest.has(v.entity_id)) latest.set(v.entity_id, v as never);
  }
  for (const c of parseCast(text)) {
    let id = byName.get(c.name.toLowerCase()) ?? null;
    if (!id) {
      const { data, error } = await sb.rpc("create_entity", { p_project: projectId, p_kind: "character", p_name: c.name });
      if (error || !data) continue;
      id = String(data);
      byName.set(c.name.toLowerCase(), id);
    }
    const prev = latest.get(id);
    if (c.description && (prev?.content?.summary ?? "").trim() !== c.description.trim()) {
      await sb.rpc("create_revision", {
        p_entity: id, p_content: { summary: c.description, notes: prev?.content?.notes ?? "" }, p_change_summary: "From your cast answer",
        p_parent_version: prev?.id ?? null, p_base_version: null, p_asset_ids: [], p_status: "submitted",
      });
      changed.push(c.name);
    } else if (!prev) changed.push(c.name);
  }
  return changed;
}

const joinNames = (n: string[]) => (n.length === 1 ? n[0] : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`);

export async function addCharacter(fd: FormData) {
  const projectId = s(fd, "projectId");
  const back = backTo(fd, projectId, `/projects/${projectId}`);
  const sb = await supabaseServer();
  const { data: id, error } = await sb.rpc("create_entity", { p_project: projectId, p_kind: "character", p_name: s(fd, "name") });
  if (error || !id) redirect(withMessage(back, "error", friendlyError(error!).message));
  const summary = s(fd, "summary").trim();
  if (summary) {
    const { error: e2 } = await sb.rpc("create_revision", {
      p_entity: id, p_content: { summary, notes: "" }, p_change_summary: null,
      p_parent_version: null, p_base_version: null, p_asset_ids: [], p_status: "submitted",
    });
    if (e2) redirect(withMessage(back, "error", friendlyError(e2).message));
  }
  revalidatePath(`/projects/${projectId}`, "layout");
  redirect(withMessage(back, "notice", `Added ${s(fd, "name").trim()} to Characters.`));
}

/** Edit a character's description from any desk: a new revision of that same character. */
export async function saveCharacter(fd: FormData) {
  const projectId = s(fd, "projectId");
  const back = backTo(fd, projectId, `/projects/${projectId}`);
  const sb = await supabaseServer();
  const { error } = await sb.rpc("create_revision", {
    p_entity: s(fd, "entityId"), p_content: { summary: s(fd, "summary"), notes: s(fd, "notes") }, p_change_summary: null,
    p_parent_version: opt(fd, "parentVersionId"), p_base_version: null, p_asset_ids: [], p_status: "submitted",
  });
  if (error) redirect(withMessage(back, "error", friendlyError(error).message));
  revalidatePath(`/projects/${projectId}`, "layout");
  redirect(withMessage(back, "notice", "Saved. Every desk shows the new description."));
}

/** New places in the script's scene headings become Locations (interior/exterior noted). */
async function syncLocationsFromScript(sb: Sb, projectId: string, body: string): Promise<string[]> {
  const scenes = parseBreakdown(body);
  if (!scenes.length) return [];
  const { data: existing } = await sb.from("entities").select("name").eq("project_id", projectId).eq("kind", "location").neq("status", "archived");
  const have = new Set((existing ?? []).map((e) => String(e.name).trim().toLowerCase()));
  const added: string[] = [];
  const seen = new Map<string, { name: string; kinds: Set<string>; first: number }>();
  for (const sc of scenes) {
    const name = titleCase(sc.location).slice(0, 120);
    if (!name || name.length < 2) continue;
    const k = name.toLowerCase();
    if (!seen.has(k)) seen.set(k, { name, kinds: new Set(), first: sc.number });
    if (sc.intExt !== "—") seen.get(k)!.kinds.add(sc.intExt);
  }
  for (const [k, v] of seen) {
    if (have.has(k) || added.length >= 20) continue;
    const { data: id, error } = await sb.rpc("create_entity", { p_project: projectId, p_kind: "location", p_name: v.name });
    if (error || !id) continue;
    const kind = v.kinds.size > 1 ? "Interior & exterior" : [...v.kinds][0] ?? "";
    await sb.rpc("create_revision", {
      p_entity: id, p_content: { summary: `${kind ? `${kind}. ` : ""}First appears in scene ${v.first} of the script.`, notes: "" },
      p_change_summary: "From your script", p_parent_version: null, p_base_version: null, p_asset_ids: [], p_status: "submitted",
    });
    have.add(k);
    added.push(v.name);
  }
  return added;
}

/** Lays out a scene in the script for each outline beat that doesn't have one yet. */
async function planScenes(projectId: string): Promise<number> {
  if (!aiConfigured()) return 0;
  const sb = await supabaseServer();
  const [{ data: notes }, { data: sp }, { data: ents }] = await Promise.all([
    sb.from("story_notebook").select("id, kind, body, status, created_at, position").eq("project_id", projectId)
      .in("kind", PARTS).neq("status", "archived").order("created_at"),
    sb.from("entities").select("id, current_version_id").eq("project_id", projectId).eq("kind", "screenplay").order("created_at").limit(1).maybeSingle(),
    sb.from("entities").select("id, kind, name").eq("project_id", projectId).in("kind", ["character", "location", "story"]).neq("status", "archived"),
  ]);
  const beats: Beat[] = sortByOrder((notes ?? []) as { id: string; kind: string; body: string; created_at: string; position: number | null }[])
    .map((n) => ({ id: String(n.id), part: n.kind as Part, text: String(n.body ?? "") }));
  const latestOf = async (id: string) => (await sb.from("versions").select("id, content").eq("entity_id", id)
    .order("version_number", { ascending: false }).limit(1).maybeSingle()).data;
  const script = sp ? await latestOf(sp.id) : null;
  const body = String(script?.content?.body ?? "");
  const todo = uncoveredBeats(body, beats).slice(0, 40);
  if (!todo.length) return 0;

  // After a failed attempt, wait a few minutes instead of retrying on every visit.
  const { data: failed } = await sb.from("agent_runs").select("id").eq("project_id", projectId).eq("task_type", "scene_plan")
    .eq("status", "failed").gt("created_at", new Date(Date.now() - 10 * 60_000).toISOString()).limit(1);
  if (failed?.length) return 0;
  const { data: runId, error } = await sb.rpc("request_scene_plan", { p_project: projectId, p_beats: todo });
  if (error || !runId) return 0;
  const chars = (ents ?? []).filter((e) => e.kind === "character");
  const cast = await Promise.all(chars.map(async (c) => ({ name: String(c.name), summary: String((await latestOf(c.id))?.content?.summary ?? "") })));
  const storyEnt = (ents ?? []).find((e) => e.kind === "story");
  const story = storyEnt ? String((await latestOf(storyEnt.id))?.content?.body ?? "") : "";
  const scenes = await runScenePlan(String(runId), {
    beats: todo, cast, story, locations: (ents ?? []).filter((e) => e.kind === "location").map((e) => String(e.name)),
  });
  if (!scenes?.length) return 0;

  // Re-read the script: she may have saved while the plan was running.
  let entityId = sp?.id as string | undefined;
  if (!entityId) {
    const { data } = await sb.rpc("open_screenplay", { p_project: projectId });
    entityId = String(data);
  }
  const fresh = await latestOf(entityId);
  const current = String(fresh?.content?.body ?? "");
  const stillTodo = uncoveredBeats(current, todo);
  const blocks = blocksFor(scenes, stillTodo, beats);
  if (!blocks.length) return 0;
  const next = insertScenesInOrder(current, blocks);
  const { data: cur } = await sb.from("entities").select("current_version_id").eq("id", entityId).single();
  const { error: e2 } = await sb.rpc("create_revision", {
    p_entity: entityId, p_content: { body: next }, p_change_summary: `Scenes from your outline (${blocks.length})`,
    p_parent_version: fresh?.id ?? null, p_base_version: cur?.current_version_id ?? null, p_asset_ids: [], p_status: "submitted",
  });
  if (e2) return 0;
  await syncLocationsFromScript(sb, projectId, next);
  revalidatePath(`/projects/${projectId}`, "layout");
  return blocks.length;
}

/** Called by the Script desk when it sees outline beats without scenes. */
export async function planScenesNow(input: { projectId: string }): Promise<{ added: number }> {
  return { added: await planScenes(input.projectId) };
}

// ---- Outline: edit in place --------------------------------------------------------------
async function outlineBeats(sb: Sb, projectId: string) {
  const { data } = await sb.from("story_notebook").select("id, kind, created_at, position").eq("project_id", projectId)
    .in("kind", PARTS).not("status", "in", "(archived,done)");
  return sortByOrder((data ?? []) as { id: string; kind: string; created_at: string; position: number | null }[]);
}

/** Add a beat at a chosen spot: after `afterId`, or at the start of its part. */
export async function insertBeat(fd: FormData) {
  const projectId = s(fd, "projectId");
  const back = backTo(fd, projectId, `/projects/${projectId}`);
  const kind = s(fd, "kind");
  const sb = await supabaseServer();
  const beats = (await outlineBeats(sb, projectId)).filter((b) => b.kind === kind);
  const afterId = opt(fd, "afterId");
  const i = afterId ? beats.findIndex((b) => b.id === afterId) : -1;
  const position = between(i >= 0 ? beats[i] : null, beats[i + 1] ?? null);
  const { data: id, error } = await sb.rpc("add_notebook_item", { p_project: projectId, p_kind: kind, p_body: s(fd, "body") });
  if (error || !id) redirect(withMessage(back, "error", friendlyError(error!).message));
  const { error: e2 } = await sb.rpc("place_notebook_item", { p_item: id, p_kind: null, p_position: position });
  if (e2) redirect(withMessage(back, "error", friendlyError(e2).message));
  after(() => planScenes(projectId).catch(() => undefined));
  revalidatePath(back);
  redirect(`${back}#outline-h`);
}

/** Move a beat one step up or down; at the edge of a part it moves into the next part. */
export async function moveBeat(fd: FormData) {
  const projectId = s(fd, "projectId");
  const back = backTo(fd, projectId, `/projects/${projectId}`);
  const sb = await supabaseServer();
  const all = await outlineBeats(sb, projectId);
  const me = all.find((b) => b.id === s(fd, "itemId"));
  if (!me) redirect(back);
  const parts = PARTS as string[];
  const list = all.filter((b) => b.kind === me.kind);
  const i = list.findIndex((b) => b.id === me.id);
  const up = s(fd, "dir") === "up";
  let kind: string | null = null;
  let position: number;
  if (up && i > 0) position = between(list[i - 2] ?? null, list[i - 1]);
  else if (!up && i < list.length - 1) position = between(list[i + 1], list[i + 2] ?? null);
  else {
    const pi = parts.indexOf(me.kind) + (up ? -1 : 1);
    if (pi < 0 || pi >= parts.length) redirect(back);
    kind = parts[pi];
    const other = all.filter((b) => b.kind === kind);
    position = up ? between(other[other.length - 1] ?? null, null) : between(null, other[0] ?? null);
  }
  const { error } = await sb.rpc("place_notebook_item", { p_item: me.id, p_kind: kind, p_position: position });
  if (error) redirect(withMessage(back, "error", friendlyError(error).message));
  revalidatePath(back);
  redirect(`${back}#outline-h`);
}
