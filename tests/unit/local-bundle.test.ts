import assert from "node:assert/strict";
import { test } from "node:test";
import { fitToWorkflow, instructionFor, outputSize, type Candidate } from "../../lib/local/bundle";
import { isOnline, type WorkflowReport } from "../../lib/local/types";

const wf = (maxImages: number, distinct = false): Pick<WorkflowReport, "maxImages" | "conditioning"> => ({ maxImages,
  conditioning: { editInput: true, referenceImages: true, sketchControl: false, depthControl: false, poseControl: false, masks: false, characterAdapter: false, distinctRoles: distinct } });
const c = (role: Candidate["role"], label: string, available = true, extra: Partial<Candidate> = {}): Candidate => ({ role, label, asset_id: `${role}-${label}`, available, ...extra });

test("bundle keeps one of each role first and shows what was left out", () => {
  const r = fitToWorkflow([c("look", "Fog"), c("cast", "Johnny"), c("cast", "Marie"), c("location", "Cafe"), c("composition", "Frame 1"), c("look", "Slide 3", false, { why: "Treatment crop (not an image file)" })], wf(4));
  assert.deepEqual(r.inputs.map((i) => i.label), ["Frame 1", "Johnny", "Cafe", "Fog"]);
  assert.deepEqual(r.omitted.map((o) => `${o.label}: ${o.reason}`), ["Slide 3: Treatment crop (not an image file)", "Marie: This workflow takes 4 images in total"]);
  assert.ok(r.warnings.some((w) => w.includes("can't keep image roles apart")));
});

test("two characters are flagged; an earlier frame replaces the composition", () => {
  const r = fitToWorkflow([c("composition", "Frame"), c("start_frame", "Approved v2"), c("cast", "A"), c("cast", "B")], wf(5, true));
  assert.equal(r.inputs[0].role, "start_frame");
  assert.ok(r.omitted.some((o) => o.label === "Frame"));
  assert.ok(r.warnings.some((w) => w.includes("Two or more characters")));
  assert.ok(!r.warnings.some((w) => w.includes("can't keep image roles apart")));
});

test("instruction states each image's job and never asks for stick figures", () => {
  const r = fitToWorkflow([c("composition", "Frame 1"), c("cast", "Johnny"), c("location", "Cafe"), c("look", "Fog", true, { use_for: "the muted greens", leave_out: "the furniture" })], wf(4));
  const t = instructionFor({ description: "Johnny drinks coffee; an explosion outside.", dialogue: "Hey!", size: "Medium", angle: "Eye level", aspectLabel: "16:9", castNames: ["Johnny", "Marie"],
    lookName: "Everyday warmth", palette: ["#556b2f"], lensNote: "35 mm on Super 35" }, r.inputs);
  assert.match(t, /Turn image 1 into a finished storyboard illustration/);
  assert.match(t, /placeholders: draw real characters/);
  assert.match(t, /Image 2 shows Johnny: use it only for who this character is/);
  assert.match(t, /Image 3 shows the location Cafe/);
  assert.match(t, /Image 4 is a style reference: use it only for the muted greens\. Ignore the furniture\./);
  assert.match(t, /Also in the frame: Marie \(no reference picture\)/);
  assert.match(t, /Do not write the dialogue/);
  assert.match(t, /approximate/);
  assert.equal(instructionFor({ description: "x", aspectLabel: "1:1", castNames: [] }, r.inputs), instructionFor({ description: "x", aspectLabel: "1:1", castNames: [] }, r.inputs), "deterministic");
});

test("sizes and online status", () => {
  assert.deepEqual(outputSize(16 / 9, 1024, { min: 256, max: 2048, multiple: 16 }), { width: 1024, height: 576 });
  assert.deepEqual(outputSize(9 / 16, 1000, { min: 256, max: 2048, multiple: 64 }), { width: 576, height: 1024 });
  assert.equal(isOnline({ lastSeenAt: new Date(1_000_000).toISOString(), revokedAt: null }, 1_000_000 + 30_000), true);
  assert.equal(isOnline({ lastSeenAt: new Date(1_000_000).toISOString(), revokedAt: null }, 1_000_000 + 600_000), false);
});
