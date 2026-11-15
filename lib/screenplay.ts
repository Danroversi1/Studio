// Screenplay text → formatted elements, page estimate and a 3-act timeline.
// Plain-text, Fountain-style conventions (https://fountain.io), kept deliberately simple:
//   INT. / EXT. / EST. / I/E lines (or a leading ".")  → scene heading
//   # ACT ONE (a line starting with #)                   → act marker (her own act breaks)
//   ALL CAPS line followed by text (or a leading "@")    → character, then dialogue
//   (whispering) inside dialogue                         → parenthetical
//   ALL CAPS ending in "TO:" (or a leading ">")          → transition
//   >centered<                                           → centered text
//   [[notes]] and /* boneyard */                         → ignored
// Page model: Courier 12pt, 55 lines per page, one page ≈ one minute of screen time.
// That is the industry rule of thumb, not a measurement; the desk labels it as an estimate.

export type ElementType =
  | "scene" | "action" | "character" | "dialogue" | "parenthetical" | "transition" | "centered" | "act";

export interface ScriptElement {
  type: ElementType;
  text: string;
  page: number;      // 1-based page where the element starts
  lineOnPage: number;
}

export interface Scene {
  heading: string;
  number: number;
  startPage: number; // fractional page position, 0-based (0 = top of page 1)
  endPage: number;
  act: number | null; // from her act markers, if any
}

export interface ActMarker { label: string; position: number } // fractional page, 0-based

export interface ParsedScript {
  elements: ScriptElement[];
  scenes: Scene[];
  acts: ActMarker[];
  totalPages: number; // fractional
}

export const LINES_PER_PAGE = 55;
export const TARGET_MINUTES = 90;
const WIDTH: Record<ElementType, number> = {
  scene: 60, action: 60, character: 38, dialogue: 35, parenthetical: 26, transition: 60, centered: 60, act: 60,
};

const SCENE_RE = /^(?:INT|EXT|EST|INT\.?\/EXT|I\/E)[.\s]/i;
const TRANSITION_RE = /^[A-Z0-9 .'-]+TO:$/;

function isAllCaps(s: string) {
  const letters = s.replace(/\([^)]*\)/g, "").replace(/[^A-Za-z]/g, "");
  return letters.length > 0 && letters === letters.toUpperCase();
}

function wrapCount(text: string, width: number) {
  let lines = 0;
  for (const raw of text.split("\n")) {
    const words = raw.split(/\s+/).filter(Boolean);
    if (!words.length) { lines += 1; continue; }
    let len = 0;
    let n = 1;
    for (const w of words) {
      const add = len === 0 ? w.length : w.length + 1;
      if (len + add > width && len > 0) { n++; len = w.length; } else len += add;
    }
    lines += n;
  }
  return lines;
}

function clean(src: string) {
  return src
    .replace(/\r\n?/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\[\[[\s\S]*?\]\]/g, "");
}

/** Split into typed elements (no paging yet). */
export function classify(src: string): { type: ElementType; text: string }[] {
  const blocks = clean(src).split(/\n\s*\n/).map((b) => b.replace(/^\n+|\s+$/g, "")).filter((b) => b.trim());
  const out: { type: ElementType; text: string }[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const first = lines[0].trim();
    if (first.startsWith("#")) {
      out.push({ type: "act", text: first.replace(/^#+\s*/, "") || "Act" });
      if (lines.length > 1) out.push({ type: "action", text: lines.slice(1).join("\n") });
      continue;
    }
    if (lines.length === 1 && (SCENE_RE.test(first) || /^\.[A-Za-z0-9]/.test(first))) {
      out.push({ type: "scene", text: first.replace(/^\./, "").toUpperCase() });
      continue;
    }
    if (lines.length === 1 && (first.startsWith(">") && first.endsWith("<"))) {
      out.push({ type: "centered", text: first.slice(1, -1).trim() });
      continue;
    }
    if (lines.length === 1 && (first.startsWith(">") || (TRANSITION_RE.test(first) && isAllCaps(first)))) {
      out.push({ type: "transition", text: first.replace(/^>\s*/, "").toUpperCase() });
      continue;
    }
    const isCharacter = lines.length > 1 && (first.startsWith("@") || (isAllCaps(first) && first.length <= 40 && !SCENE_RE.test(first)));
    if (isCharacter) {
      out.push({ type: "character", text: first.replace(/^@/, "").toUpperCase() });
      let dialogue: string[] = [];
      const flush = () => { if (dialogue.length) out.push({ type: "dialogue", text: dialogue.join("\n") }); dialogue = []; };
      for (const l of lines.slice(1)) {
        const t = l.trim();
        if (/^\(.*\)$/.test(t)) { flush(); out.push({ type: "parenthetical", text: t }); } else dialogue.push(t);
      }
      flush();
      continue;
    }
    out.push({ type: "action", text: lines.map((l) => l.replace(/^!/, "")).join("\n") });
  }
  return out;
}

export function parseScript(src: string): ParsedScript {
  const typed = classify(src);
  const elements: ScriptElement[] = [];
  const scenes: Scene[] = [];
  const acts: ActMarker[] = [];
  let line = 0; // absolute line from the top of page 1
  let actIndex = 0;

  typed.forEach((el, i) => {
    // Blank line before an element, except inside a dialogue block and at the very start.
    const inDialogueBlock = el.type === "dialogue" || el.type === "parenthetical";
    const blank = line === 0 || inDialogueBlock ? 0 : el.type === "scene" ? 2 : 1;
    if (el.type === "act") {
      acts.push({ label: el.text, position: line / LINES_PER_PAGE });
      actIndex = acts.length;
      return; // act markers don't print
    }
    line += blank;
    const height = wrapCount(el.text, WIDTH[el.type]);
    // Keep a scene heading with what follows it: push to the next page if it would be last.
    const onPage = line % LINES_PER_PAGE;
    if (el.type === "scene" && onPage > LINES_PER_PAGE - 3) line += LINES_PER_PAGE - onPage;
    elements.push({ type: el.type, text: el.text, page: Math.floor(line / LINES_PER_PAGE) + 1, lineOnPage: line % LINES_PER_PAGE });
    if (el.type === "scene") {
      if (scenes.length) scenes[scenes.length - 1].endPage = line / LINES_PER_PAGE;
      scenes.push({ heading: el.text, number: scenes.length + 1, startPage: line / LINES_PER_PAGE, endPage: line / LINES_PER_PAGE, act: actIndex || null });
    }
    line += height;
    void i;
  });
  const totalPages = line / LINES_PER_PAGE;
  if (scenes.length) scenes[scenes.length - 1].endPage = totalPages;
  return { elements, scenes, acts, totalPages };
}

/** Group elements by page for the paged preview. */
export function pages(elements: ScriptElement[]): ScriptElement[][] {
  const out: ScriptElement[][] = [];
  for (const e of elements) (out[e.page - 1] ??= []).push(e);
  return out.map((p) => p ?? []);
}

/** Common beginning / middle / ending guide, as fractions of the film (a rule of thumb). */
export const ACT_GUIDE = [
  { label: "Beginning", from: 0, to: 0.25 },
  { label: "Middle", from: 0.25, to: 0.75 },
  { label: "Ending", from: 0.75, to: 1 },
] as const;

/** Common turning points for longer films only (10+ minutes); fractions of the film. */
export const BEAT_GUIDE = [
  { at: 0.11, label: "Disruption" },
  { at: 0.25, label: "Commitment" },
  { at: 0.5, label: "Midpoint" },
  { at: 0.75, label: "Crisis" },
  { at: 0.92, label: "Climax" },
] as const;
