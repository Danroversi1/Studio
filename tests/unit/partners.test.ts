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
