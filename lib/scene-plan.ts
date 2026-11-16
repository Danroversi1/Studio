// Scenes from the outline, and the script's breakdown. Pure (unit-tested).
//
// Each outline beat becomes a scene in her script: a heading (INT./EXT., place, time),
// her beat text as the action, breakdown notes for the art department as [[Set: …]],
// [[Props: …]], [[Wardrobe: …]], [[SFX: …]] (notes never print), and a line for each
// character for her to write. A [[beat:ID]] note remembers which beat a scene came from,
// so a beat is only laid out once.

export type Part = "beginning" | "middle" | "ending";
export const PARTS: Part[] = ["beginning", "middle", "ending"];
const PART_LABEL: Record<Part, string> = { beginning: "BEGINNING", middle: "MIDDLE", ending: "ENDING" };

export interface Beat { id: string; part: Part; text: string }
export interface PlannedScene {
  beat_id: string;
  /** Her words from the beat that belong to this scene (copied exactly), when a beat spans several scenes. */
  excerpt?: string;
  int_ext: "INT" | "EXT" | "INT/EXT";
  location: string;
  time: string;
  characters: string[];
  set_dressing: string[];
  props: string[];
  wardrobe: string[];
  special_effects: string[];
}

const BEAT_RE = /\[\[\s*beat:\s*([\w-]+)\s*\]\]/gi;
export const SCENE_HEADING_RE = /^(?:INT\.?\/EXT|I\/E|INT|EXT|EST)[.\s]/i;

export function coveredBeats(src: string): Set<string> {
  return new Set([...(src ?? "").matchAll(BEAT_RE)].map((m) => m[1]));
}

export function uncoveredBeats(src: string, beats: Beat[]): Beat[] {
  const done = coveredBeats(src);
  return beats.filter((b) => b.text.trim() && !done.has(b.id));
}

const clean = (s: string, max = 60) => s.replace(/[\[\]\n\r]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const list = (xs: string[]) => xs.map((x) => clean(x, 80)).filter(Boolean).slice(0, 12).join(", ");

export function sceneHeading(s: Pick<PlannedScene, "int_ext" | "location" | "time">) {
  const ie = s.int_ext === "INT/EXT" ? "INT./EXT." : `${s.int_ext}.`;
  const where = clean(s.location).toUpperCase() || "SOMEWHERE";
  const when = clean(s.time, 20).toUpperCase();
  return `${ie} ${where}${when ? ` - ${when}` : ""}`;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Which of her words go in each scene of one beat. Her text is never rewritten: a scene
 *  gets an exact excerpt from the beat, or the beat's own lines in order, and if neither
 *  fits, the whole beat goes in the first scene. */
export function excerptsFor(beatText: string, scenes: PlannedScene[]): string[] {
  const text = beatText.trim();
  if (scenes.length <= 1) return [text];
  const ex = scenes.map((s) => (s.excerpt ?? "").trim());
  if (ex.every((e) => e && norm(text).includes(norm(e)))) return ex;
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === scenes.length) return lines;
  if (lines.length > scenes.length) {
    // More lines than scenes: walk forward, moving to the next scene when a line names
    // someone who isn't in the current scene but is in a later one.
    const has = (line: string, name: string) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(line);
    const out: string[][] = scenes.map(() => []);
    let idx = 0;
    for (const line of lines) {
      const names = [...new Set(scenes.flatMap((sc) => sc.characters))].filter((n) => has(line, n));
      const inCur = names.some((n) => scenes[idx].characters.includes(n));
      if (names.length && !inCur) {
        const j = scenes.findIndex((sc, k) => k > idx && names.some((n) => sc.characters.includes(n)));
        if (j > idx) idx = j;
      }
      out[idx].push(line);
    }
    return out.map((x) => x.join("\n"));
  }
  return scenes.map((_, i) => (i === 0 ? text : ""));
}

export function sceneBlock(scene: PlannedScene, beatText: string): string {
  const out = [`${sceneHeading(scene)}\n[[beat:${scene.beat_id}]]`];
  if (beatText.trim()) out.push(beatText.trim().replace(/\n{2,}/g, "\n"));
  const notes: [string, string[]][] = [["Set", scene.set_dressing], ["Props", scene.props], ["Wardrobe", scene.wardrobe], ["SFX", scene.special_effects]];
  for (const [k, xs] of notes) if (list(xs)) out.push(`[[${k}: ${list(xs)}]]`);
  for (const c of scene.characters.map((c) => clean(c, 40).toUpperCase()).filter(Boolean).slice(0, 8)) {
    out.push(`${c}\n(write the line)`);
  }
  return out.join("\n\n");
}

/** Puts each new scene at the end of its part (# BEGINNING / # MIDDLE / # ENDING),
 *  adding a part marker when the script doesn't have one yet. */
export function insertScenes(src: string, blocks: { part: Part; text: string }[]): string {
  let body = (src ?? "").replace(/\r\n?/g, "\n").replace(/\s+$/, "");
  for (const part of PARTS) {
    const mine = blocks.filter((b) => b.part === part).map((b) => b.text);
    if (!mine.length) continue;
    const marker = new RegExp(`^#\\s*${PART_LABEL[part]}\\b.*$`, "im");
    const m = marker.exec(body);
    if (!m) {
      // Missing marker: place it after the previous part's section (or at the end).
      body = `${body}${body ? "\n\n" : ""}# ${PART_LABEL[part]}\n\n${mine.join("\n\n")}`;
      continue;
    }
    const after = m.index + m[0].length;
    const next = /^#[^\n]*$/m.exec(body.slice(after + 1));
    const end = next ? after + 1 + next.index : body.length;
    const head = body.slice(0, end).replace(/\s+$/, "");
    const tail = body.slice(end);
    body = `${head}\n\n${mine.join("\n\n")}${tail ? `\n\n${tail.replace(/^\s+/, "")}` : ""}`;
  }
  return `${body}\n`;
}

export interface BreakdownScene {
  number: number;
  heading: string;
  intExt: "Interior" | "Exterior" | "Interior & exterior" | "—";
  location: string;
  time: string;
  characters: string[];
  set: string[]; props: string[]; wardrobe: string[]; sfx: string[];
}

export function parseHeading(h: string): { intExt: BreakdownScene["intExt"]; location: string; time: string } {
  const t = h.trim().replace(/^\./, "");
  const pre = /^(INT\.?\/EXT\.?|I\/E\.?|INT\.?|EXT\.?|EST\.?)\s*/i.exec(t);
  const p = (pre?.[1] ?? "").toUpperCase();
  const intExt = p.startsWith("INT") && p.includes("EXT") || p.startsWith("I/E") ? "Interior & exterior"
    : p.startsWith("INT") ? "Interior" : p.startsWith("EXT") || p.startsWith("EST") ? "Exterior" : "—";
  const rest = t.slice(pre?.[0].length ?? 0);
  const dash = rest.lastIndexOf(" - ");
  const location = (dash >= 0 ? rest.slice(0, dash) : rest).trim();
  const time = dash >= 0 ? rest.slice(dash + 3).trim() : "";
  return { intExt, location, time };
}

const ACRONYMS = new Set(["CIA", "FBI", "NASA", "NYC", "USA", "UK", "TV", "DJ", "ER", "ICU", "HQ", "UN"]);
export const titleCase = (s: string) =>
  s.split(/(\s+|-)/).map((w) => {
    if (ACRONYMS.has(w.toUpperCase().replace(/[^A-Z]/g, "")) && /^[A-Za-z.]+$/.test(w)) return w.toUpperCase();
    return w.toLowerCase().replace(/^(\p{L})/u, (c) => c.toUpperCase());
  }).join("");

/** Scenes, places, cast and art-department notes, read straight from the script text. */
export function parseBreakdown(src: string): BreakdownScene[] {
  const blocks = (src ?? "").replace(/\r\n?/g, "\n").split(/\n\s*\n/);
  const scenes: BreakdownScene[] = [];
  let cur: BreakdownScene | null = null;
  const note = (b: string, key: string) =>
    [...b.matchAll(new RegExp(`\\[\\[\\s*${key}\\s*:\\s*([^\\]]*)\\]\\]`, "gi"))].flatMap((m) => m[1].split(",").map((x) => x.trim()).filter(Boolean));
  for (const raw of blocks) {
    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const first = lines[0].replace(/\[\[[^\]]*\]\]/g, "").trim();
    const onlyNotes = lines.slice(1).every((l) => /^\[\[[^\]]*\]\]$/.test(l));
    if (first && onlyNotes && (SCENE_HEADING_RE.test(first) || /^\.[A-Za-z0-9]/.test(first))) {
      const h = parseHeading(first);
      cur = { number: scenes.length + 1, heading: first.replace(/^\./, "").toUpperCase(), ...h, characters: [], set: [], props: [], wardrobe: [], sfx: [] };
      scenes.push(cur);
      continue;
    }
    if (!cur) continue;
    cur.set.push(...note(raw, "set"));
    cur.props.push(...note(raw, "props"));
    cur.wardrobe.push(...note(raw, "wardrobe"));
    cur.sfx.push(...note(raw, "sfx"));
    const cue = lines[0].replace(/^@/, "").replace(/\s*\([^)]*\)\s*$/, "").trim();
    const letters = cue.replace(/[^A-Za-z]/g, "");
    if (lines.length > 1 && letters && letters === letters.toUpperCase() && cue.length <= 40 && !cue.startsWith("[[") && !cue.startsWith("#")
        && !/TO:$/.test(cue) && !SCENE_HEADING_RE.test(cue)) {
      const name = titleCase(cue);
      if (!cur.characters.includes(name)) cur.characters.push(name);
    }
  }
  for (const s of scenes) for (const k of ["set", "props", "wardrobe", "sfx"] as const) s[k] = [...new Set(s[k])];
  return scenes;
}

/** Script blocks for a plan: scenes in order, each with its share of her beat text. */
export function blocksFor(plan: PlannedScene[], beats: Beat[], order?: Beat[]): { part: Part; text: string; afterBeat?: string | null }[] {
  const byId = new Map(beats.map((b) => [b.id, b]));
  const out: { part: Part; text: string; afterBeat?: string | null }[] = [];
  for (const b of beats) {
    const mine = plan.filter((p) => p.beat_id === b.id);
    if (!mine.length || !byId.has(b.id)) continue;
    const ex = excerptsFor(b.text, mine);
    // The beat before this one in the same part (from the full outline, when given).
    const samePart = order?.filter((x) => x.part === b.part);
    const idx = samePart ? samePart.findIndex((x) => x.id === b.id) : -1;
    const prev = samePart && idx >= 0 ? (idx === 0 ? null : samePart[idx - 1].id) : undefined;
    mine.forEach((sc, i) => out.push({ part: b.part, text: sceneBlock(sc, ex[i] ?? ""), afterBeat: i === 0 ? prev : b.id }));
  }
  return out;
}

/** Insert scenes in outline order: each block goes right after the scenes of the beat before
 *  it (`afterBeat`), at the start of its part when it is the part's first beat (`afterBeat`
 *  null), or at the end of its part when neither can be found. */
export function insertScenesInOrder(src: string, blocks: { part: Part; text: string; afterBeat?: string | null }[]): string {
  let body = (src ?? "").replace(/\r\n?/g, "\n").replace(/\s+$/, "");
  for (const b of blocks) {
    const at = insertionPoint(body, b.part, b.afterBeat);
    if (at == null) { body = insertScenes(body, [b]).replace(/\s+$/, ""); continue; }
    const head = body.slice(0, at).replace(/\s+$/, "");
    const tail = body.slice(at).replace(/^\s+/, "");
    body = `${head}\n\n${b.text}${tail ? `\n\n${tail}` : ""}`;
  }
  return `${body}\n`;
}

function insertionPoint(body: string, part: Part, afterBeat: string | null | undefined): number | null {
  // Line starts of scene headings and part markers: where one scene ends and the next begins.
  const starts: number[] = [];
  const re = /^(#[^\n]*|(?:INT\.?\/EXT|I\/E|INT|EXT|EST)[.\s][^\n]*|\.[A-Za-z0-9][^\n]*)$/gim;
  for (const m of body.matchAll(re)) starts.push(m.index ?? 0);
  if (afterBeat) {
    const i = body.lastIndexOf(`[[beat:${afterBeat}]]`);
    if (i < 0) return null;
    const next = starts.find((s) => s > i);
    return next ?? body.length;
  }
  if (afterBeat === null) {
    const marker = new RegExp(`^#\\s*${PART_LABEL[part]}\\b.*$`, "im").exec(body);
    if (!marker) return null;
    const after = marker.index + marker[0].length;
    const next = starts.find((s) => s > after);
    return next ?? body.length;
  }
  return null;
}
