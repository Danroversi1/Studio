// SERVER ONLY. What the Shot Builder sees of the storyboard she has open.
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanShot, labelOf, SIZES, ANGLES, sequenceTiming } from "./shot";

export async function renderStoryboard(db: SupabaseClient, projectId: string, sequenceId: string | null): Promise<string> {
  if (!sequenceId) return "<storyboard>She has no storyboard open. Help her pick a moment; shots can be added once she opens or creates a storyboard.</storyboard>";
  const [{ data: seq }, { data: shots }] = await Promise.all([
    db.from("storyboard_sequences").select("title, brief, entry").eq("id", sequenceId).eq("project_id", projectId).maybeSingle(),
    db.from("storyboard_shots").select("id, position, state, locked, origin, content, composition").eq("sequence_id", sequenceId)
      .is("archived_at", null).order("position").limit(60),
  ]);
  if (!seq) return "<storyboard>(not found)</storyboard>";
  const entry = (seq.entry ?? {}) as { scenes?: { heading?: string; text?: string }[]; images?: { title?: string; use?: string }[] };
  const list = (shots ?? []).map((s, i) => {
    const c = cleanShot(s.content);
    return `${i + 1}. ${c.action || "(no action)"} — ${[labelOf(SIZES, c.size), labelOf(ANGLES, c.angle)].filter(Boolean).join(", ") || "framing not set"}`
      + `${c.durationS ? `, ~${c.durationS}s` : ""} [${s.origin === "agent" ? "proposed by you" : "hers"}; ${s.locked ? "locked" : s.state}${(s.composition?.layers?.length ?? 0) ? `; ${s.composition.layers.length} layers composed` : "; empty frame"}]`;
  });
  const timing = sequenceTiming((shots ?? []).map((s) => ({ content: cleanShot(s.content) })));
  return `<storyboard>
Title: ${seq.title}
What it's about (her words): ${seq.brief || "(not written)"}
${entry.scenes?.length ? `From her script:\n${entry.scenes.map((x) => `${x.heading ?? ""}\n${(x.text ?? "").slice(0, 3000)}`).join("\n\n")}` : ""}
${entry.images?.length ? `Her images: ${entry.images.map((x) => `${x.title ?? "image"} (${x.use ?? "no note"})`).join("; ")}` : ""}
Shots so far (${list.length}; ${timing.label}):
${list.join("\n") || "(none yet)"}
</storyboard>`;
}
