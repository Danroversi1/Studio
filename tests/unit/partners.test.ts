import assert from "node:assert/strict";
import { test } from "node:test";
import { PARTNERS, proposalFromTool, renderSnapshot, systemPrompt, toApiMessages } from "../../lib/agents/partners";

test("partners use the parent's specs verbatim, plus STUDIO facts", () => {
  assert.ok(systemPrompt("story").startsWith("STUDIO — CLAUDE WRITING PARTNER WITH EMBEDDED FILM KNOWLEDGE"));
  assert.ok(systemPrompt("design").startsWith("STUDIO — PRODUCTION DESIGN PARTNER"));
  assert.ok(systemPrompt("story").includes("NV | Nausicaä of the Valley of the Wind (1984)"));
  for (const p of ["story", "design"] as const) {
    assert.match(systemPrompt(p), /RUNNING INSIDE STUDIO/);
    assert.match(systemPrompt(p), /cannot see images/);
  }
  assert.match(systemPrompt("story"), /Design partner does not see this conversation/);
  assert.match(PARTNERS.design.opening, /Which place in the story/);
});

test("history alternates roles and starts with her message", () => {
  const out = toApiMessages([
    { role: "assistant", content: "stray" },
    { role: "user", content: "a" },
    { role: "user", content: "b" },
    { role: "assistant", content: "c" },
  ]);
  assert.deepEqual(out, [{ role: "user", content: "a\n\nb" }, { role: "assistant", content: "c" }]);
});

test("tool suggestions are cleaned and matched to existing items", () => {
  const existing = [{ id: "e1", kind: "location", name: "The Lighthouse" }];
  assert.deepEqual(proposalFromTool({ kind: "location", name: "  the  lighthouse ", description: "Tall." }, existing),
    { entity_kind: "location", name: "the lighthouse", summary: "Tall.", evidence: [], match_entity_id: "e1" });
  assert.equal(proposalFromTool({ kind: "prop", name: "Key", description: "" }, existing), null);
  assert.equal(proposalFromTool({ kind: "character", name: "   ", description: "x" }, existing), null);
  assert.equal(proposalFromTool("nope", existing), null);
});

test("snapshot labels approval and marks references link-only", () => {
  const s = renderSnapshot({
    filmTitle: "Keeper", synopsis: "Mira keeps the light.", synopsisApproved: false, treatment: null,
    items: [{ id: "1", kind: "character", name: "Mira", approved: true, summary: "Keeper", notes: "" }],
    references: [{ item: "Mira", title: "Raincoat", credit: "Museum", notes: "", domain: "example.org" }],
    pendingSuggestions: [],
  });
  assert.match(s, /Mira \[approved by her\]/);
  assert.match(s, /her working draft/);
  assert.match(s, /access_status=link_only/);
  assert.match(s, /Locations:\n\(none yet\)/);
});

import { notesFromTool, storyProcess } from "../../lib/agents/partners";
import { runtimeInfo, targetPages } from "../../lib/runtime";

test("story partner follows the parent's process (sections 1–11), not the developer notes", () => {
  const p = storyProcess();
  assert.match(p, /^The goal is a story development experience/);
  assert.match(p, /## 1\. Establish film length early/);
  assert.match(p, /“How long are you imagining your film\?”/);
  assert.match(p, /## 11\. Example interaction/);
  assert.doesNotMatch(p, /## 12\. Acceptance checks/);
  assert.doesNotMatch(p, /Before making changes, inspect the available implementation/);
  const sys = systemPrompt("story");
  assert.ok(sys.includes(p));
  assert.match(sys, /record_runtime with her exact words/);
  assert.doesNotMatch(systemPrompt("design"), /STORY DEVELOPMENT PROCESS/);
});

test("a decision is only hers when her words are in her message", () => {
  const msg = "One minute. It wants to dance!";
  const { ops, report } = notesFromTool({ changes: [
    { op: "add", kind: "decision", text: "The robot wants to dance.", her_words: "it wants to dance" },
    { op: "add", kind: "decision", text: "There's a rival.", her_words: "a rival" },
    { op: "add", kind: "middle", text: "She reaches for the switch." },
    { op: "resolve_question", id: "q-1" },
    { op: "add", kind: "villain", text: "x" },
  ] }, msg);
  assert.equal(ops[0].her_words, "it wants to dance");
  assert.equal(ops[1].her_words, undefined);
  assert.match(report[1], /saved as a proposed idea/);
  assert.equal(ops[2].her_words, undefined);
  assert.deepEqual(ops[3], { op: "resolve", id: "q-1" });
  assert.equal(ops.length, 4);
});

test("film length drives the timeline target", () => {
  assert.equal(targetPages("1"), 1);
  assert.equal(targetPages("3-5"), 5);
  assert.equal(targetPages("10-15"), 15);
  assert.equal(targetPages("longer"), 90);
  assert.equal(targetPages(null), 90);
  assert.equal(runtimeInfo("bogus"), null);
});

test("snapshot shows film length and notebook with question ids", () => {
  const s = renderSnapshot({
    filmTitle: "Robot", synopsis: "", synopsisApproved: false, treatment: null, items: [], references: [], pendingSuggestions: [],
    runtime: "1",
    notebook: [
      { id: "q1", kind: "question", body: "What does it want?", status: "open" },
      { id: "d1", kind: "decision", body: "It wants to dance.", status: "confirmed" },
      { id: "x", kind: "idea", body: "Removed", status: "archived" },
    ],
  });
  assert.match(s, /Film length: About 1 minute \(her choice\)/);
  assert.match(s, /\[id q1, open\] What does it want\?/);
  assert.match(s, /\[her decision\] It wants to dance\./);
  assert.doesNotMatch(s, /Removed/);
});
