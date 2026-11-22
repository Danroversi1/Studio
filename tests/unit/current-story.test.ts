import { test } from "node:test";
import assert from "node:assert/strict";
import { currentSynopsis, savedLabel } from "../../lib/agents/current-story";
import { renderSnapshot, systemPrompt } from "../../lib/agents/partners";

const BODY = `## What's your story idea?
Johnny approves a powerful model's release.

## Whose story is it?
Johnny: A terrorist going thru an existential crisis.

Marie: His girlfriend.

Mr. X: the leader of the terrorist organization.

## What makes it difficult?
Mr. X has Marie under surveillance.`;

test("cast lines take each character's current description", () => {
  const out = currentSynopsis(BODY, [
    { name: "Johnny", summary: "A researcher going thru an existential crisis." },
    { name: "mr. x", summary: "A tech mogul whose chips power the AI race." },
    { name: "Marie", summary: "Not described yet. First appears in scene 2." },
  ]);
  assert.match(out, /Johnny: A researcher going thru an existential crisis\./);
  assert.match(out, /Mr\. X: A tech mogul whose chips power the AI race\./);
  assert.match(out, /Marie: His girlfriend\./);
  assert.doesNotMatch(out, /terrorist going/);
  assert.match(out, /## What's your story idea\?\nJohnny approves/);
  assert.match(out, /## What makes it difficult\?\nMr\. X has Marie under surveillance\./);
  assert.match(out, /current description from their character page/);
});

test("unchanged cast, free text and empty bodies are kept as written", () => {
  assert.equal(currentSynopsis(BODY, [{ name: "Johnny", summary: "A terrorist going thru an existential crisis." }]), BODY);
  assert.equal(currentSynopsis("Just a paragraph about Johnny: he is sad.", [{ name: "Johnny", summary: "Happy" }]), "Just a paragraph about Johnny: he is sad.");
  assert.equal(currentSynopsis("", []), "");
});

test("saved label is readable UTC", () => {
  assert.equal(savedLabel("2026-11-22T20:20:33.9Z"), "saved 22 Nov 2026, 20:20 UTC");
  assert.equal(savedLabel(null), "");
});

test("snapshot says it is the latest state and dates the synopsis, script and items", () => {
  const out = renderSnapshot({
    takenAt: "2026-11-22T21:00:00Z", filmTitle: "Emergence", synopsis: "Idea", synopsisApproved: false, synopsisSaved: "saved 22 Nov 2026, 20:20 UTC",
    treatment: { title: "Work In Progress", text: "Slide 1: Emergence", outline: true, read: "read 22 Nov 2026, 19:47 UTC" },
    items: [{ id: "1", kind: "character", name: "Johnny", approved: false, summary: "A researcher", notes: "", saved: "saved 19 Nov 2026, 04:06 UTC" }],
    references: [], pendingSuggestions: [], script: { text: "INT. LAB - DAY", approved: false, saved: "saved 21 Nov 2026, 10:00 UTC" },
  });
  assert.match(out, /LATEST SAVED STATE \(taken 22 Nov 2026, 21:00 UTC\)/);
  assert.match(out, /supersedes anything earlier in the conversation/);
  assert.match(out, /latest version, saved 22 Nov 2026, 20:20 UTC/);
  assert.match(out, /slide list only/);
  assert.match(out, /Johnny \[not approved yet; saved 19 Nov 2026, 04:06 UTC\]/);
  assert.match(out, /latest version, saved 21 Nov 2026, 10:00 UTC/);
});

test("every partner is told the snapshot wins over earlier turns", () => {
  for (const p of ["story", "design", "world", "dialogue", "shots"] as const) assert.match(systemPrompt(p), /the snapshot wins/);
});
