// What a character could draw on from a connected collection, in one scene. Pure
// (unit-tested); no model. These rules keep three kinds of time apart:
//   story-dated knowledge  — only material dated on or before the scene's story date;
//   background research    — shapes how they think and talk; never an in-world event;
//   contemporary inspiration — real developments she may adapt; always a proposal.
// Unknown dates stay unknown: they are never assumed to be "before" a scene.
// "Could draw on" is not "knows": whether a character has read something is her call.

export type Purpose = "profession" | "interests" | "story_info" | "belief" | "director_only";
export type Temporal = "story_dated" | "background" | "inspiration";
export type Use = "in_world" | "background" | "adaptation" | "excluded";

export const PURPOSE_LABEL: Record<Purpose, string> = {
  profession: "Professional background",
  interests: "General interests",
  story_info: "Information received during the story",
  belief: "Belief or bias",
  director_only: "Director research only",
};
export const TEMPORAL_LABEL: Record<Temporal, string> = {
  story_dated: "Story-dated: only what exists by the scene's date",
  background: "Background: shapes how they think, not news they've heard",
  inspiration: "Contemporary inspiration: real events you might adapt",
};
export const USE_LABEL: Record<Use, string> = {
  in_world: "Could know by this scene",
  background: "Background (informs voice and expertise)",
  adaptation: "Possible adaptation (needs your OK)",
  excluded: "Not available",
};

export interface LinkRule { purpose: Purpose; temporal: Temporal; scope_terms: string[]; from_beat: string | null }
export interface ItemFacts { title: string; content: string; published_at: string | null }
export interface SceneTime { story_date: string | null; beat_id: string | null }

export interface Eligibility { use: Use; reason: string }

export function inScope(item: ItemFacts, terms: string[]): boolean {
  const ts = terms.map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (!ts.length) return true;
  const hay = `${item.title}\n${item.content}`.toLowerCase();
  return ts.some((t) => hay.includes(t));
}

const day = (iso: string) => iso.slice(0, 10);

export function eligibility(rule: LinkRule, item: ItemFacts, scene: SceneTime, beatOrder: string[]): Eligibility {
  if (rule.purpose === "director_only") return { use: "excluded", reason: "Marked as your research only: the character never uses it." };
  if (!inScope(item, rule.scope_terms)) return { use: "excluded", reason: `Outside the scope you set (${rule.scope_terms.join(", ")}).` };
  if (rule.temporal === "background") {
    return { use: "background", reason: `${PURPOSE_LABEL[rule.purpose]}: shapes what they understand and how they talk. It isn't treated as something that happened in the story.` };
  }
  if (rule.temporal === "inspiration") {
    return { use: "adaptation", reason: "Real-world material you might adapt. Anything drawn from it is marked as a proposed adaptation for you to accept or reject." };
  }
  // story-dated
  if (rule.from_beat) {
    const at = beatOrder.indexOf(rule.from_beat);
    const here = scene.beat_id ? beatOrder.indexOf(scene.beat_id) : -1;
    if (at >= 0 && (here < 0 || here < at)) {
      return { use: "excluded", reason: here < 0 ? "They learn this at a set point in the outline, and this scene isn't placed in the outline." : "They only learn this later in the story." };
    }
  }
  if (!item.published_at) return { use: "excluded", reason: "Its date is unknown, so it isn't assumed to exist yet in this scene." };
  if (!scene.story_date) return { use: "excluded", reason: "This scene has no story date yet, so dated material can't be placed." };
  if (day(item.published_at) > scene.story_date) {
    return { use: "excluded", reason: `Dated ${day(item.published_at)}, after this scene (${scene.story_date}).` };
  }
  return { use: "in_world", reason: `Dated ${day(item.published_at)}, on or before this scene (${scene.story_date}). Available to the character, not proof they've seen it.` };
}
