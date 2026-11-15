import assert from "node:assert/strict";
import { test } from "node:test";
import { classify } from "../../lib/screenplay";
import { insertScenes, parseBreakdown, parseHeading, sceneBlock, uncoveredBeats, type PlannedScene } from "../../lib/scene-plan";

const scene: PlannedScene = {
  beat_id: "b1", int_ext: "EXT", location: "the lighthouse", time: "night", characters: ["Mira", "Old Tom"],
  set_dressing: ["broken lamp"], props: ["brass key"], wardrobe: [], special_effects: ["storm"],
};

test("a scene block prints like a screenplay and keeps notes out of print", () => {
  const b = sceneBlock(scene, "Mira climbs the tower.");
  const els = classify(b);
  assert.deepEqual(els.map((e) => e.type), ["scene", "action", "character", "parenthetical", "character", "parenthetical"]);
  assert.equal(els[0].text, "EXT. THE LIGHTHOUSE - NIGHT");
});

test("beats are laid out once", () => {
  const b = sceneBlock(scene, "Mira climbs.");
  assert.deepEqual(uncoveredBeats(b, [{ id: "b1", part: "beginning", text: "x" }, { id: "b2", part: "middle", text: "y" }]).map((x) => x.id), ["b2"]);
});

test("scenes go to the end of their part", () => {
  const src = "# BEGINNING\n\nINT. A - DAY\n\nOne.\n\n# MIDDLE\n\nINT. B - DAY\n\nTwo.\n";
  const out = insertScenes(src, [{ part: "beginning", text: "INT. C - DAY\n\nNew." }, { part: "ending", text: "EXT. D - DAY\n\nLast." }]);
  assert.ok(out.indexOf("INT. C") > out.indexOf("One.") && out.indexOf("INT. C") < out.indexOf("# MIDDLE"));
  assert.ok(out.indexOf("# ENDING") > out.indexOf("Two."));
  assert.equal(insertScenes("", [{ part: "middle", text: "X" }]), "# MIDDLE\n\nX\n");
});

test("breakdown reads places, cast and notes", () => {
  const src = insertScenes("", [{ part: "beginning", text: sceneBlock(scene, "Mira climbs.") }]) + "\nINT. KITCHEN - DAY\n\nMIRA\nHello.\n\nCUT TO:\n";
  const bd = parseBreakdown(src);
  assert.equal(bd.length, 2);
  assert.deepEqual([bd[0].intExt, bd[0].location, bd[0].time], ["Exterior", "THE LIGHTHOUSE", "NIGHT"]);
  assert.deepEqual(bd[0].characters, ["Mira", "Old Tom"]);
  assert.deepEqual(bd[0].props, ["brass key"]);
  assert.deepEqual(bd[1].characters, ["Mira"]);
  assert.deepEqual(parseHeading("INT./EXT. CAR - MOVING").intExt, "Interior & exterior");
});
