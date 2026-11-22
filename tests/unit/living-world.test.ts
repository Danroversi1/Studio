import { test } from "node:test";
import assert from "node:assert/strict";
import { renderLivingWorld, type LivingWorld } from "../../lib/agents/living-world";
import { renderSnapshot, systemPrompt } from "../../lib/agents/partners";

const w: LivingWorld = {
  storyDay: 3, storyDate: "2026-11-22", approved: [{ day: 1, title: "A leak at the lab", what: "Johnny finds a hidden result." }], openProposals: 2,
  worldTopics: ["AI", "Semiconductors"], worldHeadlines: [{ title: "Lab hides model results", outlet: "News: AI", date: "2026-11-21" }],
  worldRules: ["Big tech news from San Francisco reaches Washington by the next morning."],
  society: [{ region: "US", theme: "jobs", mood_0_10: 1.9, mood: "Very gloomy", trend: "worse", as_of: "2026-10", evidence: [] }],
  polls: [{ title: "More U.S. Workers Fear Losing Their Jobs to Technology", publisher: "Gallup", date: "2026-11-10" }],
  characters: [
    { name: "Johnny", role: "protagonist", tracked: true, mood: { score: 3, label: "Troubled", day: "2026-11-22", why: ["at odds: “Lab hides model results” (he hates secrecy)"] },
      rules: ["Gets anxious when AI labs hide results."], interests: ["AI safety"], avoid: ["gossip"], follows: ["BAIR blog"],
      coverage: { day: "2026-11-22", titles: ["Lab hides model results"] }, knows: { knows: "The lab's secret project exists." },
      collections: [{ name: "AI research papers", purpose: "profession", items: 265 }] },
    { name: "The President", role: "featured", tracked: false, mood: null, rules: [], interests: [], avoid: [], follows: [], coverage: null, knows: {}, collections: [] },
  ],
};

test("the living world reads as a compact, labelled briefing", () => {
  const t = renderLivingWorld(w);
  for (const s of ["day 3", "Day 1: A leak at the lab", "Big tech news from San Francisco", "topics she follows: AI; Semiconductors", "not story facts",
    "US jobs: 1.9/10 Very gloomy, worse than last month", "Johnny [Protagonist]", "3/10 Troubled", "at odds", "their rules: Gets anxious", "into: AI safety; avoids: gossip",
    "follows: BAIR blog", "not necessarily read", "knows: The lab's secret project exists.", "AI research papers (their work, 265 items)",
    "The President [Featured; a voice of society, feelings not tracked]"]) assert.ok(t.includes(s), s);
});

test("only the Storybuilder's snapshot carries it, and the Storybuilder is told how to use it", () => {
  const base = { filmTitle: "Emergence", synopsis: "", synopsisApproved: false, treatment: null, items: [], references: [], pendingSuggestions: [] };
  assert.match(renderSnapshot({ ...base, living: "LIVING-MARKER" }), /The living world[\s\S]*LIVING-MARKER/);
  assert.doesNotMatch(renderSnapshot(base), /The living world/);
  assert.match(systemPrompt("story"), /Ground your recommendations in it/);
  assert.doesNotMatch(systemPrompt("design"), /living world/);
});
