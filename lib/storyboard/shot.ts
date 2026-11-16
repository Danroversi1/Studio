// What a storyboard shot holds, with labels for the simple and expanded controls. Story facts
// (action, dialogue, source) are hers; staging (size, angle, movement, lens) may be proposed
// by the Shot Builder; approval and generation are tracked separately. Pure (unit-tested).
import type { CameraSetup } from "./camera";

export const SIZES = [
  ["extreme_wide", "Extreme wide"], ["wide", "Wide"], ["full", "Full"], ["medium_wide", "Medium wide"],
  ["medium", "Medium"], ["medium_close", "Medium close"], ["close", "Close"], ["extreme_close", "Extreme close"],
] as const;
export const SIMPLE_SIZES = ["wide", "medium", "close"] as const;
export const ANGLES = [
  ["eye", "Eye level"], ["high", "High angle"], ["low", "Low angle"], ["overhead", "Overhead"], ["dutch", "Tilted (Dutch)"], ["pov", "Point of view"],
] as const;
export const FOCUS = [["deep", "Deep focus (most things sharp)"], ["shallow", "Shallow focus (background soft)"]] as const;
export const STYLES = [
  ["pencil", "Pencil sketch"], ["ink", "Ink drawing"], ["grayscale", "Grayscale tonal"], ["color", "Color illustration"],
] as const;

export type Size = (typeof SIZES)[number][0];
export type Angle = (typeof ANGLES)[number][0];
export type Style = (typeof STYLES)[number][0];

export interface ShotSource { kind: "text" | "script" | "image"; scene?: number; heading?: string; excerpt?: string }

export interface ShotContent {
  action: string;              // what happens (her words or close to them)
  dialogue?: string;           // lines spoken, if any
  notice?: string;             // "What should we notice?"
  cameraNotes?: string;        // notes for the real shoot
  source?: ShotSource;         // where it comes from
  size?: Size;
  angle?: Angle;
  focus?: "deep" | "shallow";
  distanceM?: number;          // simple control: camera distance
  movement?: string;           // a note; a still frame never shows it
  durationS?: number;          // proposed, not measured
  characters?: string[];
  location?: string;
  camera?: CameraSetup;        // expanded controls
  lensId?: string;
  lensCharacter?: string;      // optional descriptors (creative guidance)
  why?: string;                // the reason for the choice (agent or director)
}

const clip = (s: unknown, n: number) => (typeof s === "string" ? s.replace(/\s+$/g, "").slice(0, n) : undefined);
const num = (x: unknown, lo: number, hi: number) => (typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi ? x : undefined);
const oneOf = <T extends string>(x: unknown, list: readonly (readonly [T, string])[]) => (list.some(([k]) => k === x) ? (x as T) : undefined);

/** Keep only known fields with sensible values. */
export function cleanShot(x: unknown): ShotContent {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const src = (o.source && typeof o.source === "object" ? o.source : null) as Record<string, unknown> | null;
  const cam = (o.camera && typeof o.camera === "object" ? o.camera : null) as Record<string, unknown> | null;
  const out: ShotContent = { action: clip(o.action, 1200) ?? "" };
  const d = clip(o.dialogue, 1200); if (d) out.dialogue = d;
  const nt = clip(o.notice, 400); if (nt) out.notice = nt;
  const cn = clip(o.cameraNotes, 600); if (cn) out.cameraNotes = cn;
  if (src && ["text", "script", "image"].includes(String(src.kind))) {
    out.source = { kind: src.kind as ShotSource["kind"], scene: num(src.scene, 1, 999), heading: clip(src.heading, 200), excerpt: clip(src.excerpt, 2000) };
  }
  out.size = oneOf(o.size, SIZES);
  out.angle = oneOf(o.angle, ANGLES);
  out.focus = o.focus === "deep" || o.focus === "shallow" ? o.focus : undefined;
  out.distanceM = num(o.distanceM, 0.1, 500);
  out.movement = clip(o.movement, 300) || undefined;
  out.durationS = num(o.durationS, 0.2, 600);
  if (Array.isArray(o.characters)) out.characters = o.characters.filter((c) => typeof c === "string").map((c) => c.slice(0, 80)).slice(0, 12);
  out.location = clip(o.location, 120) || undefined;
  if (cam) {
    out.camera = {
      formatId: typeof cam.formatId === "string" ? cam.formatId.slice(0, 20) : undefined,
      widthMm: num(cam.widthMm, 1, 100), heightMm: num(cam.heightMm, 1, 100), focalMm: num(cam.focalMm, 4, 2000),
      anamorphic: cam.anamorphic === true || undefined, squeeze: num(cam.squeeze, 1, 2.5), aspect: num(cam.aspect, 1, 3),
      apertureKind: cam.apertureKind === "T" ? "T" : cam.apertureKind === "f" ? "f" : undefined, aperture: num(cam.aperture, 0.7, 64),
      focusM: num(cam.focusM, 0.1, 10000), cameraHeightM: num(cam.cameraHeightM, -10, 300), tiltDeg: num(cam.tiltDeg, -90, 90), panDeg: num(cam.panDeg, -180, 180),
    };
  }
  out.lensId = clip(o.lensId, 60) || undefined;
  out.lensCharacter = clip(o.lensCharacter, 300) || undefined;
  out.why = clip(o.why, 600) || undefined;
  return JSON.parse(JSON.stringify(out));
}

export const labelOf = (list: readonly (readonly [string, string])[], k?: string) => list.find(([x]) => x === k)?.[1] ?? "";

/** Sequence runtime: total of proposed durations, and how many shots have none. */
export function sequenceTiming(shots: { content: ShotContent }[]) {
  let total = 0, missing = 0;
  for (const s of shots) if (s.content.durationS) total += s.content.durationS; else missing++;
  return { totalS: total, missing, label: `${total ? `about ${formatSeconds(total)}` : "no durations yet"}${missing ? ` (+ ${missing} without a duration)` : ""}` };
}

export function formatSeconds(s: number) {
  if (s < 60) return `${Math.round(s * 10) / 10} s`;
  const m = Math.floor(s / 60), r = Math.round(s - m * 60);
  return `${m} min${r ? ` ${r} s` : ""}`;
}

/** A small fingerprint of a piece of script text, to notice when it changes. */
export function textKey(s: string): string {
  const t = s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

/** Order key between two neighbours (for inserting or moving). */
export function between(a: number | null, b: number | null): number {
  if (a == null && b == null) return 1000;
  if (a == null) return b! - 1000;
  if (b == null) return a + 1000;
  return (a + b) / 2;
}
