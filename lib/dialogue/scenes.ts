// Scenes in her script, and how proposed dialogue goes into one. Pure (unit-tested).
//
// A scene runs from its heading to the next heading or part marker (# …). Its key is stable
// across edits elsewhere in the script: b:<beat id>:<n> for scenes laid out from an outline
// beat (the [[beat:ID]] note), h:<heading>:<n> otherwise.
//
// Accepting a proposal never touches anything outside that one scene. Inside it, her
// heading, her art-department notes ([[…]]) and her opening action (the beat text) stay
// exactly as written; the dialogue that follows is what a proposal replaces.
import { SCENE_HEADING_RE } from "../scene-plan";

export interface ScriptScene {
  key: string;
  beatId: string | null;
  heading: string;
  start: number;   // offset of the heading line
  end: number;     // offset just past the scene's text (before the next heading/marker)
  text: string;    // the scene's full text, heading included
  characters: string[];
}

export type Basis = "research" | "canon" | "invention" | "adaptation";
export interface DialogueElement {
  type: "action" | "dialogue";
  speaker?: string;
  parenthetical?: string;
  text: string;
  basis: Basis;
  item_ids?: string[];
}

const PART_RE = /^#/;
const BEAT_RE = /\[\[\s*beat:\s*([\w-]+)\s*\]\]/i;
const isHeading = (line: string) => SCENE_HEADING_RE.test(line.trim()) || /^\.[A-Za-z0-9]/.test(line.trim());
const slug = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "SCENE";

export function splitScenes(src: string): ScriptScene[] {
  const body = (src ?? "").replace(/\r\n?/g, "\n");
  const lines = body.split("\n");
  const starts: { at: number; heading: string }[] = [];
  const stops: number[] = [];
  let off = 0;
  for (const line of lines) {
    if (isHeading(line)) starts.push({ at: off, heading: line.trim().replace(/^\./, "") });
    else if (PART_RE.test(line.trim())) stops.push(off);
    off += line.length + 1;
  }
  const scenes: ScriptScene[] = [];
  const seen = new Map<string, number>();
  starts.forEach((s, i) => {
    const nextHead = starts[i + 1]?.at ?? Infinity;
    const nextStop = stops.find((x) => x > s.at) ?? Infinity;
    const end = Math.min(nextHead, nextStop, body.length);
    const text = body.slice(s.at, end).replace(/\s+$/, "");
    const beat = BEAT_RE.exec(text)?.[1] ?? null;
    const base = beat ? `b:${beat}` : `h:${slug(s.heading)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    scenes.push({ key: `${base}:${n}`, beatId: beat, heading: s.heading.toUpperCase(), start: s.at, end: s.at + text.length, text, characters: speakersIn(text) });
  });
  return scenes;
}

function blocksOf(text: string): string[] {
  return text.split(/\n\s*\n/).map((b) => b.replace(/^\n+|\s+$/g, "")).filter((b) => b.trim());
}
const isNoteBlock = (b: string) => b.split("\n").every((l) => /^\s*\[\[[^\]]*\]\]\s*$/.test(l));
function isCueBlock(b: string) {
  const lines = b.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return false;
  const cue = lines[0].replace(/^@/, "").replace(/\s*\([^)]*\)\s*$/, "");
  const letters = cue.replace(/[^A-Za-z]/g, "");
  return !!letters && letters === letters.toUpperCase() && cue.length <= 40 && !cue.startsWith("[[") && !/TO:$/.test(cue) && !isHeading(cue);
}

export function speakersIn(text: string): string[] {
  const out: string[] = [];
  for (const b of blocksOf(text).slice(1)) {
    if (!isCueBlock(b)) continue;
    const name = b.split("\n")[0].trim().replace(/^@/, "").replace(/\s*\([^)]*\)\s*$/, "").toUpperCase();
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/** The parts of a scene a proposal keeps: heading, notes, and her action before any dialogue. */
export function sceneFrame(scene: ScriptScene): { kept: string[]; rest: string[] } {
  const bs = blocksOf(scene.text);
  const kept: string[] = [bs[0] ?? scene.heading];
  let i = 1;
  for (; i < bs.length; i++) {
    if (isNoteBlock(bs[i]) || (!isCueBlock(bs[i]) && !/^\(write the line\)$/i.test(bs[i].trim()))) kept.push(bs[i]);
    else break;
  }
  return { kept, rest: bs.slice(i) };
}

/** Her existing dialogue in the scene (placeholders dropped), for comparison and context. */
export function currentDialogue(scene: ScriptScene): string {
  return sceneFrame(scene).rest.filter((b) => !/\(write the line\)\s*$/i.test(b.trim())).join("\n\n");
}

const clean = (s: string, max: number) => (s ?? "").replace(/\[\[|\]\]/g, "").replace(/\r/g, "").trim().slice(0, max);

export function renderElements(els: DialogueElement[]): string {
  return els.map((e) => {
    if (e.type === "action") return clean(e.text, 1200);
    const who = clean(e.speaker ?? "", 40).toUpperCase().replace(/[^A-Z0-9 .'-]/g, "") || "SOMEONE";
    const paren = e.parenthetical ? `\n(${clean(e.parenthetical, 80).replace(/^\(|\)$/g, "")})` : "";
    return `${who}${paren}\n${clean(e.text, 1200)}`;
  }).filter(Boolean).join("\n\n");
}

/** The scene as it would read after accepting a proposal. */
export function sceneWithProposal(scene: ScriptScene, els: DialogueElement[]): string {
  const { kept } = sceneFrame(scene);
  const add = renderElements(els);
  return [...kept, ...(add ? [add] : [])].join("\n\n");
}

/** The scene with some proposed lines adopted: each fills that speaker's "(write the line)"
 *  placeholder if there is one, otherwise it is added at the end of the scene. */
export function sceneWithAdopted(scene: ScriptScene, els: DialogueElement[]): string {
  const bs = blocksOf(scene.text);
  const extra: string[] = [];
  for (const e of els) {
    const block = renderElements([e]);
    if (e.type === "dialogue") {
      const who = (e.speaker ?? "").toUpperCase().trim();
      const i = bs.findIndex((b) => isCueBlock(b) && b.split("\n")[0].trim().toUpperCase().replace(/\s*\([^)]*\)\s*$/, "") === who && /\(write the line\)\s*$/i.test(b.trim()));
      if (i >= 0) { bs[i] = block; continue; }
    }
    extra.push(block);
  }
  return [...bs, ...extra].join("\n\n");
}

/** Replace one scene's text in the whole script; everything else is untouched. */
export function replaceScene(src: string, scene: ScriptScene, newText: string): string {
  const body = (src ?? "").replace(/\r\n?/g, "\n");
  const before = body.slice(0, scene.start);
  const after = body.slice(scene.end);
  return `${before}${newText.replace(/\s+$/, "")}${after.startsWith("\n") || !after ? after : `\n\n${after}`}`;
}

/** A short, stable fingerprint input for "has this scene changed since the draft?". */
export function sceneSignature(scene: ScriptScene): string {
  return scene.text.replace(/\s+/g, " ").trim();
}
