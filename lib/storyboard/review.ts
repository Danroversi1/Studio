// Script scenes as text (for "Use your script"), and which shots need another look when the
// script, cast or locations change. Images and notes are never touched: the director decides
// what to regenerate. Pure (unit-tested).
import type { ShotContent } from "./shot";

export interface ScriptScene { number: number; heading: string; text: string }

const HEADING = /^(\.(?!\.)|(?:INT|EXT|EST|INT\.?\/EXT|I\/E)[.\s])/i;

export function scriptScenes(body: string): ScriptScene[] {
  const out: ScriptScene[] = [];
  let cur: ScriptScene | null = null;
  for (const raw of (body ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\[\[[^\]]*\]\]/g, "").trimEnd();
    const t = line.trim();
    if (HEADING.test(t) && t.length < 120) {
      cur = { number: out.length + 1, heading: t.replace(/^\./, "").toUpperCase(), text: "" };
      out.push(cur);
      continue;
    }
    if (!cur || /^#\s/.test(t) || /^\(write the line\)$/i.test(t)) continue;
    cur.text += (cur.text && !cur.text.endsWith("\n") ? "\n" : "") + (t ? t.replace(/^-\s+/, "") : "");
  }
  for (const s of out) s.text = s.text.replace(/\n{3,}/g, "\n\n").trim();
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9']+/g, " ").trim();

export interface ReviewNote { reason: string; was?: string; now?: string; at: string }

/** Why a shot needs another look now, or null. */
export function reviewFor(shot: ShotContent, ctx: { scenes: ScriptScene[]; cast: string[]; locations: string[] }, now = new Date()): ReviewNote | null {
  const at = now.toISOString();
  const src = shot.source;
  if (src?.kind === "script" && src.heading && src.excerpt) {
    const scene = ctx.scenes.find((s) => norm(s.heading) === norm(src.heading!));
    if (!scene) return { reason: `The scene “${src.heading}” is no longer in the script (renamed or removed).`, was: src.excerpt.slice(0, 400), at };
    if (!norm(scene.text).includes(norm(src.excerpt).slice(0, 400))) {
      return { reason: `Scene ${scene.number} (${scene.heading}) changed in the script.`, was: src.excerpt.slice(0, 400), now: scene.text.slice(0, 400), at };
    }
  }
  const cast = new Set(ctx.cast.map(norm));
  const gone = (shot.characters ?? []).filter((c) => !cast.has(norm(c)));
  if (gone.length) return { reason: `${gone.join(", ")} ${gone.length === 1 ? "is" : "are"} no longer in the cast (renamed or removed).`, at };
  if (shot.location && ctx.locations.length && !ctx.locations.map(norm).includes(norm(shot.location))) {
    return { reason: `The location “${shot.location}” is no longer in Locations (renamed or removed).`, at };
  }
  return null;
}
