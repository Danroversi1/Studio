import assert from "node:assert/strict";
import { test } from "node:test";
import { currentDialogue, renderElements, replaceScene, sceneWithAdopted, sceneWithProposal, splitScenes, type DialogueElement } from "../../lib/dialogue/scenes";

const SCRIPT = `# BEGINNING

INT. MARIE'S APARTMENT - NIGHT
[[beat:b-1]]

Johnny comes home late. Marie is waiting.

[[Props: laptop]]

JOHNNY
(write the line)

MARIE
(write the line)

EXT. STREET - DAY

Rain.

# MIDDLE

INT. MARIE'S APARTMENT - NIGHT
[[beat:b-1]]

They argue.

MARIE
You said ten.
`;

test("scenes and their stable keys", () => {
  const s = splitScenes(SCRIPT);
  assert.deepEqual(s.map((x) => x.key), ["b:b-1:1", "h:EXT-STREET-DAY:1", "b:b-1:2"]);
  assert.deepEqual(s[0].characters, ["JOHNNY", "MARIE"]);
  assert.ok(!s[1].text.includes("# MIDDLE"), "a part marker ends a scene");
});

test("a proposal keeps her heading, notes and opening action", () => {
  const [scene] = splitScenes(SCRIPT);
  const els: DialogueElement[] = [
    { type: "dialogue", speaker: "Johnny", text: "Before you say anything—", basis: "invention" },
    { type: "dialogue", speaker: "Marie", parenthetical: "not looking up", text: "It's eleven.", basis: "canon" },
  ];
  const out = sceneWithProposal(scene, els);
  assert.ok(out.startsWith("INT. MARIE'S APARTMENT - NIGHT\n[[beat:b-1]]"));
  assert.ok(out.includes("Johnny comes home late. Marie is waiting."));
  assert.ok(out.includes("[[Props: laptop]]"));
  assert.ok(!out.includes("(write the line)"));
  assert.ok(out.endsWith("MARIE\n(not looking up)\nIt's eleven."));
});

test("accepting changes one scene only", () => {
  const scenes = splitScenes(SCRIPT);
  const next = replaceScene(SCRIPT, scenes[0], sceneWithProposal(scenes[0], [{ type: "dialogue", speaker: "JOHNNY", text: "Hi.", basis: "invention" }]));
  const after = splitScenes(next);
  assert.equal(after.length, 3);
  assert.equal(after[1].text, scenes[1].text);
  assert.equal(after[2].text, scenes[2].text);
  assert.ok(next.startsWith("# BEGINNING"));
});

test("adopting selected lines fills placeholders first", () => {
  const [scene] = splitScenes(SCRIPT);
  const out = sceneWithAdopted(scene, [
    { type: "dialogue", speaker: "MARIE", text: "Where were you?", basis: "invention" },
    { type: "action", text: "The kettle clicks off.", basis: "invention" },
  ]);
  assert.ok(out.includes("MARIE\nWhere were you?"));
  assert.ok(out.includes("JOHNNY\n(write the line)"), "other placeholders stay");
  assert.ok(out.endsWith("The kettle clicks off."));
});

test("existing dialogue and safe rendering", () => {
  const scenes = splitScenes(SCRIPT);
  assert.equal(currentDialogue(scenes[0]), "");
  assert.equal(currentDialogue(scenes[2]), "MARIE\nYou said ten.");
  assert.equal(renderElements([{ type: "dialogue", speaker: "mr. x [[beat:z]]", text: "[[Set: x]] Hello", basis: "invention" }]), "MR. X BEATZ\nSet: x Hello");
});
