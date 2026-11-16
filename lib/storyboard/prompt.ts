// Instructions for the two optional image actions. Only built when she asks; pure (tested).
import { ANGLES, SIZES, labelOf, type ShotContent } from "./shot";

export const PROMPT_VERSION = "storyboard-v2";
export type Style = "pencil" | "ink" | "grayscale" | "color";

const STYLE_TEXT: Record<Style, string> = {
  pencil: "rough graphite pencil storyboard drawing on white paper, confident loose lines, simple hatching, no color",
  ink: "black ink storyboard drawing, clean contours, solid blacks for shadow, no color",
  grayscale: "grayscale tonal storyboard illustration (marker and wash), clear light and shadow shapes, no color",
  color: "simple color storyboard illustration, flat readable color, not photographic",
};
export const isStyle = (s: unknown): s is Style => s === "pencil" || s === "ink" || s === "grayscale" || s === "color";

/** Output size for the image model: multiples of 16, aspect kept, within 1:3–3:1. */
export function outputSize(aspect: number): { width: number; height: number } {
  const a = Math.min(3, Math.max(1 / 3, aspect || 16 / 9));
  if (a >= 1) return { width: 1536, height: Math.max(512, Math.round(1536 / a / 16) * 16) };
  return { width: Math.max(512, Math.round((1536 * a) / 16) * 16), height: 1536 };
}

/** "Illustrate This Frame": the attached image is her composition; keep it. */
export function illustratePrompt(shot: ShotContent, style: Style, extraRefs: { name: string; kind: string }[]): string {
  const L = [
    `Redraw the first attached image as a finished storyboard frame: ${STYLE_TEXT[style]}.`,
    "The first image is the director's own rough composition. Keep its framing, the position, size and pose of every figure and object, and the camera angle exactly. Do not add or remove people or objects. Do not draw any text, captions, arrows or panel borders.",
  ];
  const bits = [shot.size ? `${labelOf(SIZES, shot.size)} shot` : "", shot.angle ? labelOf(ANGLES, shot.angle).toLowerCase() : ""].filter(Boolean);
  if (bits.length) L.push(`Shot: ${bits.join(", ")}.`);
  if (shot.action) L.push(`What happens: ${shot.action.slice(0, 600)}`);
  if (shot.notice) L.push(`What we should notice: ${shot.notice.slice(0, 300)}`);
  if (shot.dialogue) L.push(`Someone is speaking (don't draw the words): ${shot.dialogue.replace(/\s+/g, " ").slice(0, 300)}`);
  if (extraRefs.length) L.push(`Other attached images, in order, show how these look (match their appearance, not their framing): ${extraRefs.map((r, i) => `[${i + 2}] ${r.name} (${r.kind})`).join("; ")}.`);
  return L.join("\n");
}

/** "Create Missing Asset": one reusable picture, saying exactly which view it shows. */
export function assetPrompt(a: { kind: string; name: string; description: string; views: string }, style: Style): string {
  const what = { background: "an empty location background with no people", prop: "a single prop on a plain white background", character: "a single character reference on a plain white background",
    pose: "a single character in one pose on a plain white background", wardrobe: "one outfit shown on a simple figure on a plain white background" }[a.kind] ?? "a single subject on a plain white background";
  return [
    `Make ${what} for reuse in a film storyboard: ${STYLE_TEXT[style]}.`,
    `Name: ${a.name.slice(0, 120)}.`, `Description: ${a.description.slice(0, 1000)}`,
    a.views ? `Show exactly this view / pose: ${a.views.slice(0, 200)}. Only one view.` : "One clear view only.",
    "No text or labels.",
  ].join("\n");
}
