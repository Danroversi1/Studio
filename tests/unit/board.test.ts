import assert from "node:assert/strict";
import { test } from "node:test";
import { autoEdges, buildNodes } from "../../lib/board";

const script = `# BEGINNING\n\nINT. COFFEE SHOP - DAY\n\nJOHNNY\n(write the line)\n\nINT. MARIE'S APARTMENT - MORNING\n\nMARIE\nHi.\n\nJOHNNY\nHey.\n\nEXT. STREET - DAY\n\nJOHNNY\n(write the line)\n`;
const entities = [
  { id: "1", kind: "character" as const, name: "Johnny", summary: "" },
  { id: "2", kind: "character" as const, name: "Marie", summary: "" },
  { id: "3", kind: "location" as const, name: "Coffee Shop", summary: "" },
  { id: "4", kind: "location" as const, name: "Marie's Apartment", summary: "" },
];

test("automatic strings from the script (scenes hidden)", () => {
  const e = autoEdges({ entities, script, showScenes: false });
  const has = (a: string, b: string, l: string) => e.some((x) => ((x.from === a && x.to === b) || (x.from === b && x.to === a)) && x.label === l);
  assert.ok(has("e:1", "e:3", "in a scene here"));
  assert.ok(has("e:1", "e:4", "in a scene here"));
  assert.ok(has("e:2", "e:4", "in a scene here"));
  assert.ok(has("e:1", "e:2", "share a scene"));
  assert.equal(e.length, 4, "the street isn't a Location yet, so no string");
});

test("with scenes shown, strings go through the scene cards", () => {
  const e = autoEdges({ entities, script, showScenes: true });
  assert.ok(e.some((x) => x.from === "s:2" && x.to === "e:4"));
  assert.equal(e.filter((x) => x.label === "share a scene").length, 0);
});

test("new cards get a tidy spot; saved ones stay put", () => {
  const n = buildNodes({ entities, references: [], notes: [{ id: "n", body: "hm", color: "yellow" }], positions: { "e:2": { x: 999, y: 5 } }, script, showScenes: false, base: "/p" });
  assert.deepEqual([n[1].x, n[1].y], [999, 5]);
  assert.ok(n[0].y < n[2].y, "characters above locations");
  assert.equal(n.find((x) => x.kind === "note")?.body, "hm");
});
