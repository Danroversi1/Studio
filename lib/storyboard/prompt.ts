// Builds the instructions sent to the image model for one shot. Composition and story come
// first; camera numbers are passed as creative guidance (image models interpret them
// loosely); references say what to borrow and what to ignore; only images actually attached
// are described as images. Pure (unit-tested).
import { distanceForFraming, fieldOfView, formatOf, round, type CameraSetup } from "./camera";
import { ANGLES, FOCUS, SIZES, STYLES, labelOf, type ShotContent, type Style } from "./shot";

export const PROMPT_VERSION = "storyboard-v1";

export const ROLE_LABELS: Record<string, string> = {
  character: "Character appearance", wardrobe: "Wardrobe", location: "Location", prop: "Prop", composition: "Composition",
  lighting: "Lighting or atmosphere", drawing_style: "Drawing style", color_texture: "Color or texture",
};

export interface PromptRef { role: string; title: string; borrow: string; ignore: string; attached: boolean; note?: string }
export interface LensInfo { manufacturer: string; model: string; optical: string; character_notes?: string }
export interface FinishInfo { name: string; params: { grain?: { amount?: number }; halation?: { amount?: number }; bloom?: { amount?: number } } }
export interface StockInfo { stock: string; balance?: string | null; editorial?: string }

export interface PromptInput {
  shot: ShotContent;
  mode: "storyboard" | "look";
  kind: "frame" | "variation" | "edit" | "look";
  style: Style;
  aspect: number;
  cast: { name: string; summary: string }[];
  locations: { name: string; summary: string }[];
  world?: string | null;
  refs: PromptRef[];
  lens?: LensInfo | null;
  stock?: StockInfo | null;
  finish?: FinishInfo | null;
  editInstruction?: string;
  baseIsStoryboard?: boolean;   // look preview built on the storyboard frame
}

const STYLE_TEXT: Record<Style, string> = {
  pencil: "Rough graphite pencil storyboard sketch on white paper: confident loose lines, simple hatching for shadow, no color.",
  ink: "Black ink storyboard drawing: clean contour lines, solid blacks for shadow, no color.",
  grayscale: "Grayscale tonal storyboard illustration (marker / wash): clear light and shadow shapes, no color.",
  color: "Simple color storyboard illustration: flat readable color, clear light and shadow, not photographic.",
};

/** Output size for the image model: width and height divisible by 16, aspect kept. */
export function outputSize(aspect: number): { width: number; height: number } {
  const a = Math.min(3, Math.max(1 / 3, aspect || 16 / 9));
  if (a >= 1) return { width: 1536, height: Math.max(512, Math.round(1536 / a / 16) * 16) };
  return { width: Math.max(512, Math.round(1536 * a / 16) * 16), height: 1536 };
}

function cameraLine(c: CameraSetup | undefined, size?: string, distanceM?: number): string {
  const parts: string[] = [];
  const fmt = c ? formatOf(c) : null;
  const fov = c?.focalMm ? fieldOfView(c) : null;
  if (c?.focalMm && fmt) {
    parts.push(`${c.focalMm} mm ${c.anamorphic ? `anamorphic (${c.squeeze ?? 2}× squeeze)` : "spherical"} lens on ${fmt.name}${fov ? `, about ${Math.round(fov.h)}° horizontal view` : ""}`);
  }
  const d = distanceM ?? (c?.focalMm && size ? distanceForFraming(c, size) ?? undefined : undefined);
  if (d) parts.push(`camera about ${round(d, 1)} m from the main subject`);
  if (c?.cameraHeightM != null) parts.push(`camera height about ${round(c.cameraHeightM, 1)} m`);
  if (c?.tiltDeg) parts.push(`tilted ${c.tiltDeg > 0 ? "up" : "down"} about ${Math.abs(c.tiltDeg)}°`);
  if (c?.aperture) parts.push(`${c.apertureKind === "T" ? "T" : "f/"}${c.aperture}${c.focusM ? `, focused at ${round(c.focusM, 1)} m` : ""}`);
  return parts.length ? `Camera (creative guidance, not exact optics): ${parts.join("; ")}.` : "";
}

export function buildPrompt(p: PromptInput): string {
  const s = p.shot;
  const L: string[] = [];
  if (p.mode === "storyboard") {
    L.push(`A single storyboard frame for a short film. ${STYLE_TEXT[p.style]}`);
    L.push("What matters most: clear composition and staging, readable silhouettes, where everyone is in the space, and the action of this moment.");
    L.push("Do not draw any text, captions, labels, arrows, panel borders or speech bubbles.");
  } else {
    L.push("A photographic still from a live-action film: an approximation of how this shot could look on camera, not a precise optical simulation.");
    if (p.baseIsStoryboard) L.push("The first attached image is the director's storyboard frame for this shot. Keep its composition, framing, staging and camera angle; turn the drawing into a photographic image.");
    const finishTexture = (p.finish?.params.grain?.amount ?? 0) > 0 || (p.finish?.params.halation?.amount ?? 0) > 0 || (p.finish?.params.bloom?.amount ?? 0) > 0;
    if (finishTexture) L.push("Render a clean image with no film grain, no halation and no bloom; texture is added in a separate finishing step.");
    if (p.lens) L.push(`Lens character (descriptive guidance only): ${p.lens.optical === "anamorphic" ? "anamorphic look" : "spherical lens"}${p.lens.character_notes ? `; ${p.lens.character_notes.replace(/^Editorial:\s*/i, "")}` : ""}.`);
    if (p.stock) L.push(`Color and light inspired by ${p.stock.balance === "tungsten" ? "a tungsten-balanced" : p.stock.balance === "daylight" ? "a daylight-balanced" : "a"} motion-picture negative look (${p.stock.stock}); natural, not stylized.`);
  }
  if (p.kind === "variation") L.push("Make a fresh variation of this same moment and framing (the attached frame is the previous version): different drawing, same story.");
  if (p.kind === "edit" && p.editInstruction) L.push(`Change only this in the attached frame, keep everything else: ${p.editInstruction}`);

  const shotBits = [s.size ? `${labelOf(SIZES, s.size)} shot` : "", s.angle ? labelOf(ANGLES, s.angle).toLowerCase() : "", s.focus ? labelOf(FOCUS, s.focus).split(" (")[0].toLowerCase() : ""].filter(Boolean);
  if (shotBits.length) L.push(`Shot: ${shotBits.join(", ")}.`);
  const cam = cameraLine(s.camera, s.size, s.distanceM);
  if (cam) L.push(cam);
  if (s.lensCharacter && p.mode === "look") L.push(`Lens descriptors from the director (creative guidance): ${s.lensCharacter}.`);
  if (s.movement) L.push(`Movement note: ${s.movement}. A still frame can't show movement: draw the moment at the start of the move.`);

  L.push(`What happens: ${s.action || "(not described)"}`);
  if (s.dialogue) L.push(`Someone is speaking (do not draw any words): ${s.dialogue.replace(/\s+/g, " ").slice(0, 400)}`);
  const inShot = new Set((s.characters ?? []).map((c) => c.toLowerCase()));
  const cast = p.cast.filter((c) => inShot.has(c.name.toLowerCase()) || (s.action ?? "").toLowerCase().includes(c.name.toLowerCase()));
  if (cast.length) L.push(`Characters: ${cast.map((c) => `${c.name}${c.summary ? ` (${c.summary.replace(/\s+/g, " ").slice(0, 200)})` : ""}`).join("; ")}.`);
  const loc = p.locations.find((l) => s.location && l.name.toLowerCase() === s.location.toLowerCase());
  if (s.location) L.push(`Place: ${s.location}${loc?.summary ? ` (${loc.summary.replace(/\s+/g, " ").slice(0, 200)})` : ""}.`);
  if (p.world) L.push(`World and time: ${p.world.slice(0, 300)}`);

  const attached = p.refs.filter((r) => r.attached);
  const described = p.refs.filter((r) => !r.attached);
  if (attached.length) {
    const offset = p.baseIsStoryboard || p.kind === "variation" || p.kind === "edit" ? 1 : 0;
    L.push("Reference images attached, in order:" + attached.map((r, i) =>
      ` [${i + 1 + offset}] ${ROLE_LABELS[r.role] ?? r.role}${r.title ? ` — ${r.title}` : ""}${r.borrow ? `; borrow: ${r.borrow}` : ""}${r.ignore ? `; ignore: ${r.ignore}` : ""}`).join(""));
  }
  if (described.length) {
    L.push("Described references (no image attached):" + described.map((r) =>
      ` ${ROLE_LABELS[r.role] ?? r.role}: ${r.title}${r.borrow ? `; borrow: ${r.borrow}` : ""}${r.ignore ? `; ignore: ${r.ignore}` : ""}`).join(";"));
  }
  L.push("Do not add people, objects or events that aren't described here.");
  return L.join("\n").slice(0, 11000);
}
