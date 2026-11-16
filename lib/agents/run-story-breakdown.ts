// SERVER ONLY. Runs one queued Story Lead breakdown. Uses the service role solely to read
// the run's inputs and to record results through the trusted database functions.
import type Anthropic from "@anthropic-ai/sdk";
import { anthropicClient } from "../ai/client";
import { costUsd, type Usage } from "../ai/pricing";
import { supabaseService } from "../supabase/server";
import {
  STORY_BREAKDOWN_MODEL,
  STORY_BREAKDOWN_SCHEMA,
  STORY_BREAKDOWN_SYSTEM,
  buildUserMessage,
  validateBreakdown,
  type ExistingItem,
} from "./story-breakdown";

export { aiConfigured } from "../ai/configured";

export async function runStoryBreakdown(runId: string): Promise<void> {
  const db = supabaseService();
  const { data: claimed } = await db.rpc("start_agent_run", { p_run: runId });
  if (!claimed) return; // already taken or finished

  let usage: Usage = {};
  let cost = 0;
  try {
    const { data: run, error: runErr } = await db
      .from("agent_runs").select("project_id, input_payload").eq("id", runId).single();
    if (runErr || !run) throw new Error("Run not found.");
    // Either the director's treatment (a text snapshot stored with the run when it was
    // requested) or the saved synopsis revision.
    const fromTreatment = run.input_payload.source === "treatment";
    let story = "";
    if (fromTreatment) {
      story = String(run.input_payload.text ?? "");
    } else {
      const { data: version } = await db
        .from("versions").select("content").eq("id", run.input_payload.version_id).single();
      story = String(version?.content?.body ?? "");
    }
    const { data: existing } = await db
      .from("entities").select("id, kind, name").eq("project_id", run.project_id).in("kind", ["character", "location"]);

    const client = anthropicClient();
    const res = await client.messages.create({
      model: STORY_BREAKDOWN_MODEL,
      max_tokens: 8000,
      system: STORY_BREAKDOWN_SYSTEM,
      messages: [{ role: "user", content: buildUserMessage(story, (existing ?? []) as ExistingItem[], fromTreatment ? "treatment" : "story") }],
      output_config: { effort: "medium", format: { type: "json_schema", schema: STORY_BREAKDOWN_SCHEMA as unknown as Record<string, unknown> } },
    });
    usage = res.usage as Usage;
    cost = costUsd(STORY_BREAKDOWN_MODEL, usage);
    if (res.stop_reason !== "end_turn") throw new Error(`The Story Lead stopped early (${res.stop_reason}).`);
    const text = res.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") throw new Error("The Story Lead returned no suggestions.");

    const { proposals, dropped } = validateBreakdown(JSON.parse(text.text), story, (existing ?? []) as ExistingItem[]);
    const { error } = await db.rpc("complete_story_breakdown", {
      p_run: runId,
      p_proposals: proposals,
      p_usage: { ...usage, dropped_unverified: dropped },
      p_cost_usd: cost,
      p_model: res.model,
    });
    if (error) throw new Error(error.message);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    await db.rpc("fail_agent_run", { p_run: runId, p_error: message.slice(0, 300), p_usage: usage, p_cost_usd: cost });
  }
}
