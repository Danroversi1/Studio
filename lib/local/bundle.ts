// Build the explicit reference bundle for one frame, fit it to what the chosen local workflow
// really supports, and write the generation instruction from a fixed template (no language
// model). Pure; unit-tested.
import type { BundleInput, BundleOmission, InputRole, WorkflowReport } from "./types";

export interface Candidate extends BundleInput { /** null = no usable image (e.g. a treatment crop or link) */ available: boolean; why?: string }

/** Order in which images are kept when the workflow takes fewer than she selected. */
const PRIORITY: InputRole[] = ["composition", "start_frame", "cast", "location", "look"];

export function fitToWorkflow(cands: Candidate[], wf: Pick<WorkflowReport, "maxImages" | "conditioning"> | null) {
  const inputs: BundleInput[] = [];
  const omitted: BundleOmission[] = [];
  const warnings: string[] = [];
  const usable = cands.filter((c) => { if (!c.available) omitted.push({ role: c.role, label: c.label, reason: c.why ?? "No image file to send" }); return c.available; });
  // First of each role, in priority order; then the rest, in the same order.
  const firsts = PRIORITY.map((r) => usable.find((c) => c.role === r)).filter((c): c is Candidate => !!c);
  const rest = usable.filter((c) => !firsts.includes(c)).sort((a, b) => PRIORITY.indexOf(a.role) - PRIORITY.indexOf(b.role));
  const max = wf ? Math.max(1, wf.maxImages) : 1;
  const starts = firsts.filter((c) => c.role === "composition" || c.role === "start_frame");
  if (starts.length > 1) { const drop = starts.find((c) => c.role === "composition")!; firsts.splice(firsts.indexOf(drop), 1); omitted.push({ role: drop.role, label: drop.label, reason: "Starting from the earlier frame instead" }); }
  for (const c of [...firsts, ...rest]) {
    if (inputs.length < max) inputs.push(strip(c));
    else omitted.push({ role: c.role, label: c.label, reason: `This workflow takes ${max} image${max === 1 ? "" : "s"} in total` });
  }
  const cast = inputs.filter((i) => i.role === "cast").length;
  if (cast >= 2) warnings.push("Two or more characters: this workflow has no way to tie each picture to one person in the frame, so their looks may be mixed up. Check the result carefully, or generate one character at a time.");
  if (wf && !wf.conditioning.distinctRoles && inputs.length > 1) warnings.push("This model can't keep image roles apart by itself. Studio tells it each picture's job in words and by order; it may still borrow things you didn't intend (for example, the style picture's colors on a character's clothes).");
  if (!inputs.some((i) => i.role === "composition" || i.role === "start_frame")) warnings.push("No composition: draw or arrange the frame first.");
  return { inputs, omitted, warnings };
}
function strip(c: Candidate): BundleInput { const { available: _a, why: _w, ...rest } = c; return rest; }

export interface ShotFacts {
  description: string; dialogue?: string; size?: string; angle?: string; cameraNotes?: string; aspectLabel: string;
  lensNote?: string; castNames: string[]; place?: string;
  lookName?: string; lookIntention?: string; palette?: string[];
}

/** The instruction for an image-editing model, from structured fields. Image numbers follow
 *  the order of `inputs`. */
export function instructionFor(s: ShotFacts, inputs: BundleInput[]): string {
  const L: string[] = [];
  const n = (i: BundleInput) => `image ${inputs.indexOf(i) + 1}`;
  const start = inputs.find((i) => i.role === "composition" || i.role === "start_frame");
  if (start?.role === "start_frame") L.push(`Revise ${n(start)}, an earlier storyboard frame, keeping its layout, framing and the characters' positions.`);
  else if (start) L.push(`Turn ${n(start)} into a finished storyboard illustration. Keep its layout, framing, camera angle, and where each figure stands and how it is posed. The simple shapes and stick figures in it are placeholders: draw real characters and objects in their place, not shapes.`);
  if (s.description.trim()) L.push(`The moment: ${s.description.trim().slice(0, 900)}`);
  if (s.size || s.angle) L.push(`Shot: ${[s.size, s.angle].filter(Boolean).join(", ")}.`);
  for (const c of inputs.filter((i) => i.role === "cast")) L.push(`${cap(n(c))} shows ${c.label}: use it only for who this character is (face, hair, body, clothes). Do not copy its background, framing or style.`);
  const loc = inputs.find((i) => i.role === "location");
  if (loc) L.push(`${cap(n(loc))} shows the location ${loc.label}: use it for the setting's features and layout, not for its people or its camera angle.`);
  else if (s.place) L.push(`The location is ${s.place}.`);
  for (const l of inputs.filter((i) => i.role === "look")) {
    const use = l.use_for?.trim() ? `use it only for ${l.use_for.trim().slice(0, 200)}` : "use it only for the drawing style, colors, lighting, texture and mood";
    L.push(`${cap(n(l))} is a style reference: ${use}.${l.leave_out?.trim() ? ` Ignore ${l.leave_out.trim().slice(0, 200)}.` : ""} Do not copy its people, faces, places, objects or layout.`);
  }
  if (s.lookName || s.lookIntention) L.push(`Overall look: ${[s.lookName, s.lookIntention].filter(Boolean).join(": ").slice(0, 300)}.`);
  if (s.palette?.length) L.push(`Keep to this palette where it fits: ${s.palette.slice(0, 8).join(", ")}.`);
  if (s.lensNote) L.push(`Camera feel (approximate): ${s.lensNote.slice(0, 120)}.`);
  const names = s.castNames.filter((nm) => !inputs.some((i) => i.role === "cast" && i.label === nm));
  if (names.length) L.push(`Also in the frame: ${names.join(", ")} (no reference picture).`);
  if (s.dialogue?.trim()) L.push("Do not write the dialogue or any captions into the picture.");
  L.push(`Frame shape ${s.aspectLabel}. No borders, panel numbers or text.`);
  return L.join("\n").slice(0, 4000);
}
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Output size for a preset: long side from the workflow, rounded to its size multiple. */
export function outputSize(aspect: number, longSide: number, sizes: WorkflowReport["sizes"]): { width: number; height: number } {
  const m = Math.max(1, sizes.multiple);
  const r = (v: number) => Math.min(sizes.max, Math.max(sizes.min, Math.round(v / m) * m));
  return aspect >= 1 ? { width: r(longSide), height: r(longSide / aspect) } : { width: r(longSide * aspect), height: r(longSide) };
}
