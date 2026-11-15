// SERVER ONLY. Answers one message to a creative partner. The run was created (and
// authorized, and budget-checked) by post_agent_message(); this uses the service role only
// to read the film's snapshot and to record the reply through complete_agent_turn().
import Anthropic from "@anthropic-ai/sdk";
import { costUsd, type Usage } from "../ai/pricing";
import { supabaseService } from "../supabase/server";
import { isRuntime } from "../runtime";
import {
  type NoteOp, type PartnerProposal, type ProjectSnapshot, RECORD_RUNTIME_TOOL, type StoredMessage, SUGGEST_ITEM_TOOL,
  UPDATE_NOTEBOOK_TOOL, isPartnerId, notesFromTool, openingFor, proposalFromTool, renderSnapshot, systemPrompt, toApiMessages,
} from "./partners";
import { STORY_BREAKDOWN_MODEL } from "./story-breakdown";

const MODEL = STORY_BREAKDOWN_MODEL;
const MAX_TOOL_ROUNDS = 3;
const MAX_SUGGESTIONS_PER_TURN = 10;

type Db = ReturnType<typeof supabaseService>;

async function loadSnapshot(db: Db, projectId: string): Promise<{ snapshot: ProjectSnapshot; existing: { id: string; kind: string; name: string }[] }> {
  const [{ data: project }, { data: entities }, { data: treatmentRun }, { data: pending }, { data: notebook }] = await Promise.all([
    db.from("projects").select("name, runtime:settings->>runtime").eq("id", projectId).single(),
    db.from("entities").select("id, kind, name, current_version_id, created_at")
      .eq("project_id", projectId).in("kind", ["story", "character", "location", "screenplay"]).order("created_at"),
    db.from("agent_runs").select("title:input_payload->>title, text:input_payload->>text")
      .eq("project_id", projectId).eq("task_type", "story_breakdown").eq("input_payload->>source", "treatment")
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("agent_proposals").select("name").eq("project_id", projectId).eq("status", "pending").limit(50),
    db.from("story_notebook").select("id, kind, body, status").eq("project_id", projectId).neq("status", "archived")
      .order("created_at", { ascending: true }).limit(120),
  ]);
  const ents = entities ?? [];
  const ids = ents.map((e) => e.id);
  const [{ data: versions }, { data: boards }] = await Promise.all([
    ids.length
      ? db.from("versions").select("entity_id, version_number, content").in("entity_id", ids).order("version_number", { ascending: false })
      : Promise.resolve({ data: [] as { entity_id: string; version_number: number; content: Record<string, string> }[] }),
    ids.length ? db.from("research_boards").select("id, entity_id").in("entity_id", ids)
      : Promise.resolve({ data: [] as { id: string; entity_id: string }[] }),
  ]);
  const latest = new Map<string, Record<string, string>>();
  for (const v of versions ?? []) if (!latest.has(v.entity_id)) latest.set(v.entity_id, (v.content ?? {}) as Record<string, string>);
  const boardEntity = new Map((boards ?? []).map((b) => [b.id, b.entity_id]));
  const { data: refs } = boardEntity.size
    ? await db.from("research_references").select("board_id, title, attribution, observations, source_domain")
        .in("board_id", [...boardEntity.keys()]).order("created_at", { ascending: false }).limit(80)
    : { data: [] as { board_id: string; title: string | null; attribution: string | null; observations: string | null; source_domain: string | null }[] };

  const nameOf = new Map(ents.map((e) => [e.id, e.name]));
  const screenplay = ents.find((e) => e.kind === "screenplay");
  const story = ents.find((e) => e.kind === "story");
  const snapshot: ProjectSnapshot = {
    filmTitle: project?.name ?? "Untitled film",
    runtime: (project as { runtime?: string | null } | null)?.runtime ?? null,
    notebook: notebook ?? [],
    synopsis: story ? String(latest.get(story.id)?.body ?? "") : "",
    synopsisApproved: !!story?.current_version_id,
    treatment: treatmentRun?.text ? { title: String(treatmentRun.title ?? "Treatment"), text: String(treatmentRun.text) } : null,
    script: screenplay ? { text: String(latest.get(screenplay.id)?.body ?? ""), approved: !!screenplay.current_version_id } : null,
    items: ents.filter((e) => e.kind === "character" || e.kind === "location").map((e) => ({
      id: e.id, kind: e.kind as "character" | "location", name: e.name, approved: !!e.current_version_id,
      summary: String(latest.get(e.id)?.summary ?? ""), notes: String(latest.get(e.id)?.notes ?? ""),
    })),
    references: (refs ?? []).map((r) => ({
      item: nameOf.get(boardEntity.get(r.board_id) ?? "") ?? "the film",
      title: r.title ?? "", credit: r.attribution ?? "unknown", notes: r.observations ?? "", domain: r.source_domain ?? "",
    })),
    pendingSuggestions: (pending ?? []).map((p) => p.name),
  };
  return { snapshot, existing: ents.filter((e) => e.kind === "character" || e.kind === "location") };
}

function addUsage(a: Usage, b: Usage): Usage {
  const k = ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"] as const;
  const out: Usage = {};
  for (const key of k) out[key] = (a[key] ?? 0) + (b[key] ?? 0);
  return out;
}

/** Returns null on success, or a short reason the reply failed. */
export async function runPartnerTurn(runId: string): Promise<string | null> {
  const db = supabaseService();
  const { data: claimed } = await db.rpc("start_agent_run", { p_run: runId });
  if (!claimed) return "This message is already being answered.";

  let usage: Usage = {};
  let cost = 0;
  try {
    const { data: run } = await db.from("agent_runs").select("project_id, input_payload").eq("id", runId).single();
    if (!run) throw new Error("Run not found.");
    const partner = run.input_payload.agent;
    if (!isPartnerId(partner)) throw new Error("Unknown partner.");
    const { data: history } = await db.from("agent_messages").select("role, content")
      .eq("thread_id", run.input_payload.thread_id).order("created_at", { ascending: true }).limit(200);
    const { snapshot, existing } = await loadSnapshot(db, run.project_id);

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const messages: Anthropic.MessageParam[] = toApiMessages((history ?? []) as StoredMessage[]);
    if (!messages.length) throw new Error("No message to answer.");
    // She saw an opening line before her first message; tell the model what it said.
    const opening = openingFor(partner, { hasStory: !!snapshot.synopsis.trim(), runtime: snapshot.runtime ?? null, filmTitle: snapshot.filmTitle });
    if (typeof messages[0].content === "string") {
      messages[0] = { role: "user", content: `[STUDIO showed her this opening line from you before her first message: "${opening}"]\n\n${messages[0].content}` };
    }
    const system: Anthropic.TextBlockParam[] = [
      { type: "text", text: systemPrompt(partner), cache_control: { type: "ephemeral" } },
      { type: "text", text: renderSnapshot(snapshot), cache_control: { type: "ephemeral" } },
    ];

    const tools = partner === "story" ? [SUGGEST_ITEM_TOOL, RECORD_RUNTIME_TOOL, UPDATE_NOTEBOOK_TOOL] : [SUGGEST_ITEM_TOOL];
    const herMessage = [...(history ?? [])].reverse().find((m) => m.role === "user")?.content ?? "";
    const noteOps: NoteOp[] = [];
    let runtime: { value: string; words: string } | null = null;
    const proposals: PartnerProposal[] = [];
    const replyParts: string[] = [];
    let res: Anthropic.Message | null = null;
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      res = await client.messages.create({
        model: MODEL,
        max_tokens: 3000,
        system,
        tools,
        messages,
      });
      usage = addUsage(usage, res.usage as Usage);
      for (const b of res.content) if (b.type === "text" && b.text.trim()) replyParts.push(b.text.trim());
      if (res.stop_reason !== "tool_use" || round === MAX_TOOL_ROUNDS) break;

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const b of res.content) {
        if (b.type !== "tool_use") continue;
        if (partner === "story" && b.name === "update_notebook") {
          const { ops, report } = notesFromTool(b.input, herMessage);
          const room = 8 - noteOps.length;
          noteOps.push(...ops.slice(0, Math.max(0, room)));
          results.push({ type: "tool_result", tool_use_id: b.id, content: (room > 0 ? report : ["Notebook limit for this turn reached."]).join("\n") });
          continue;
        }
        if (partner === "story" && b.name === "record_runtime") {
          const inp = b.input as { runtime?: string; her_words?: string };
          const words = (inp.her_words ?? "").trim();
          const ok = isRuntime(inp.runtime) && !!words && herMessage.toLowerCase().includes(words.toLowerCase());
          if (ok) runtime = { value: inp.runtime as string, words };
          results.push({ type: "tool_result", tool_use_id: b.id, is_error: !ok,
            content: ok ? `Film length recorded: ${inp.runtime}.` : "Not recorded: use it only when her latest message states the length, with her exact words." });
          continue;
        }
        const p = b.name === "suggest_item" && proposals.length < MAX_SUGGESTIONS_PER_TURN ? proposalFromTool(b.input, existing) : null;
        if (p) proposals.push(p);
        results.push({
          type: "tool_result", tool_use_id: b.id,
          content: p
            ? `Placed "${p.name}" (${p.entity_kind}) in her Suggestions inbox${p.match_entity_id ? "; note: it has the same name as an existing item, so she'll be asked whether it's the same one" : ""}. It is not in the film until she adds it.`
            : "Not placed: the suggestion was incomplete or over this turn's limit.",
          is_error: !p,
        });
      }
      messages.push({ role: "assistant", content: res.content }, { role: "user", content: results });
    }
    cost = costUsd(MODEL, usage);

    let reply = replyParts.join("\n\n");
    if (res?.stop_reason === "max_tokens") reply += "\n\n(I ran out of room there. Ask me to continue.)";
    if (!reply) reply = proposals.length ? "I've put that in your Suggestions." : "Sorry, I lost my train of thought. Could you say that again?";

    if (partner === "story" && (noteOps.length || runtime)) {
      const rt = runtime as { value: string; words: string } | null;
      const { error: notesErr } = await db.rpc("apply_partner_notes", {
        p_run: runId, p_ops: noteOps, p_runtime: rt?.value ?? null, p_runtime_words: rt?.words ?? null,
      });
      if (notesErr) throw new Error(notesErr.message);
    }
    const { error } = await db.rpc("complete_agent_turn", {
      p_run: runId, p_reply: reply, p_proposals: proposals, p_usage: usage, p_cost_usd: cost, p_model: res?.model ?? MODEL,
    });
    if (error) throw new Error(error.message);
    return null;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    await db.rpc("fail_agent_run", { p_run: runId, p_error: message.slice(0, 300), p_usage: usage, p_cost_usd: cost });
    return message;
  }
}
