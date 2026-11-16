// The editable composition of one storyboard frame: layers with transforms, drawing strokes,
// grids, a framing (2D "camera") and a look. Everything here is deterministic code: no model
// calls. Large images live in asset storage; layers only reference them. Pure (unit-tested).

export const FRAME_W = 1600; // frame units across; height = FRAME_W / aspect

export type LayerType = "image" | "shape" | "text" | "drawing";
export interface Crop { l: number; t: number; r: number; b: number } // fractions trimmed from each side
export interface Stroke { color: string; width: number; erase?: boolean; pts: number[] } // x,y pairs in frame units

export interface Layer {
  id: string;
  type: LayerType;
  name: string;
  x: number; y: number;          // centre, frame units
  w: number; h: number;          // size before rotation, frame units
  rot: number;                   // degrees
  flipX?: boolean; flipY?: boolean;
  opacity?: number;
  locked?: boolean;
  hidden?: boolean;
  group?: string;                // layers sharing a group move together
  // image
  libraryId?: string;            // shared library item (reused across frames)
  assetId?: string;              // the image itself (from the library item, or a one-off upload)
  crop?: Crop;
  // shape
  shape?: string;
  fill?: string; stroke?: string; strokeWidth?: number;
  // text
  text?: string; fontSize?: number; color?: string; box?: boolean; align?: "left" | "center" | "right";
  // drawing
  strokes?: Stroke[];
}

export interface Look {
  exposure: number;   // stops, -2..2
  contrast: number;   // -1..1
  saturation: number; // 0..2 (1 = unchanged)
  warmth: number;     // -1..1
  grayscale: boolean;
  grain: { amount: number; size: number; seed: number }; // size in µm on the chosen capture width
  vignette: number;   // 0..1
  presetId?: string;
}

export interface Framing { zoom: number; panX: number; panY: number } // 2D framing: crop/scale, not optics

export interface Composition {
  v: 1;
  aspect: number;
  bg: string;
  layers: Layer[];
  grid: "none" | "thirds" | "center" | "safe";
  framing: Framing;
  look: Look;
}

export const DEFAULT_LOOK: Look = { exposure: 0, contrast: 0, saturation: 1, warmth: 0, grayscale: false, grain: { amount: 0, size: 8, seed: 1 }, vignette: 0 };

export function emptyComposition(aspect = 16 / 9): Composition {
  return { v: 1, aspect, bg: "#ffffff", layers: [], grid: "thirds", framing: { zoom: 1, panX: 0, panY: 0 }, look: { ...DEFAULT_LOOK, grain: { ...DEFAULT_LOOK.grain } } };
}

export const frameH = (c: Composition) => FRAME_W / c.aspect;

let idCounter = 0;
export function newId(prefix = "l"): string {
  idCounter = (idCounter + 1) % 1e6;
  const rnd = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}${rnd}${idCounter.toString(36)}`;
}

const num = (x: unknown, d: number, lo = -1e6, hi = 1e6) => (typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d);
const str = (x: unknown, n: number) => (typeof x === "string" ? x.slice(0, n) : undefined);
const color = (x: unknown) => (typeof x === "string" && /^#[0-9a-f]{3,8}$/i.test(x) ? x : undefined);

/** Accept stored or pasted data safely; fill defaults; drop anything unknown. */
export function cleanComposition(x: unknown, fallbackAspect = 16 / 9): Composition {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const aspect = num(o.aspect, fallbackAspect, 0.3, 4);
  const lk = (o.look && typeof o.look === "object" ? o.look : {}) as Record<string, unknown>;
  const gr = (lk.grain && typeof lk.grain === "object" ? lk.grain : {}) as Record<string, unknown>;
  const fr = (o.framing && typeof o.framing === "object" ? o.framing : {}) as Record<string, unknown>;
  const layers = (Array.isArray(o.layers) ? o.layers : []).slice(0, 300).map((l): Layer | null => {
    const L = (l && typeof l === "object" ? l : {}) as Record<string, unknown>;
    const type = ["image", "shape", "text", "drawing"].includes(String(L.type)) ? (L.type as LayerType) : null;
    if (!type) return null;
    const out: Layer = {
      id: str(L.id, 40) || newId(), type, name: str(L.name, 80) ?? type,
      x: num(L.x, FRAME_W / 2), y: num(L.y, FRAME_W / aspect / 2), w: num(L.w, 200, 1, 1e5), h: num(L.h, 200, 1, 1e5), rot: num(L.rot, 0, -3600, 3600),
    };
    if (L.flipX) out.flipX = true;
    if (L.flipY) out.flipY = true;
    if (L.opacity !== undefined) out.opacity = num(L.opacity, 1, 0, 1);
    if (L.locked) out.locked = true;
    if (L.hidden) out.hidden = true;
    if (L.group) out.group = str(L.group, 40);
    if (type === "image") {
      out.libraryId = str(L.libraryId, 40); out.assetId = str(L.assetId, 40);
      const c = (L.crop && typeof L.crop === "object" ? L.crop : null) as Record<string, unknown> | null;
      if (c) out.crop = { l: num(c.l, 0, 0, 0.95), t: num(c.t, 0, 0, 0.95), r: num(c.r, 0, 0, 0.95), b: num(c.b, 0, 0, 0.95) };
    }
    if (type === "shape") { out.shape = str(L.shape, 40) ?? "rect"; out.fill = color(L.fill) ?? "#3a3a3a"; out.stroke = color(L.stroke); out.strokeWidth = num(L.strokeWidth, 0, 0, 100); }
    if (type === "text") { out.text = str(L.text, 1000) ?? ""; out.fontSize = num(L.fontSize, 48, 6, 600); out.color = color(L.color) ?? "#111111"; out.box = !!L.box; out.align = L.align === "left" || L.align === "right" ? L.align : "center"; }
    if (type === "drawing") {
      out.strokes = (Array.isArray(L.strokes) ? L.strokes : []).slice(0, 2000).map((s) => {
        const S = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
        const pts = (Array.isArray(S.pts) ? S.pts : []).slice(0, 4000).map((p) => num(p, 0)).map((p) => Math.round(p * 10) / 10);
        return { color: color(S.color) ?? "#111111", width: num(S.width, 4, 0.5, 200), erase: !!S.erase || undefined, pts: pts.length % 2 ? pts.slice(0, -1) : pts };
      }).filter((s) => s.pts.length >= 2);
    }
    return out;
  }).filter((l): l is Layer => !!l);
  return {
    v: 1, aspect, bg: color(o.bg) ?? "#ffffff", layers,
    grid: ["none", "thirds", "center", "safe"].includes(String(o.grid)) ? (o.grid as Composition["grid"]) : "thirds",
    framing: { zoom: num(fr.zoom, 1, 0.2, 8), panX: num(fr.panX, 0, -FRAME_W * 4, FRAME_W * 4), panY: num(fr.panY, 0, -FRAME_W * 4, FRAME_W * 4) },
    look: {
      exposure: num(lk.exposure, 0, -2, 2), contrast: num(lk.contrast, 0, -1, 1), saturation: num(lk.saturation, 1, 0, 2), warmth: num(lk.warmth, 0, -1, 1),
      grayscale: !!lk.grayscale, vignette: num(lk.vignette, 0, 0, 1), presetId: str(lk.presetId, 60),
      grain: { amount: num(gr.amount, 0, 0, 0.3), size: num(gr.size, 8, 1, 40), seed: Math.round(num(gr.seed, 1, 0, 2 ** 31)) },
    },
  };
}

// ---- Geometry -------------------------------------------------------------------------

const rad = (d: number) => (d * Math.PI) / 180;

/** Frame point → the layer's local coordinates (origin at centre, before flip). */
export function toLocal(l: Layer, px: number, py: number): [number, number] {
  const dx = px - l.x, dy = py - l.y, c = Math.cos(-rad(l.rot)), s = Math.sin(-rad(l.rot));
  return [dx * c - dy * s, dx * s + dy * c];
}
export function toFrame(l: Layer, lx: number, ly: number): [number, number] {
  const c = Math.cos(rad(l.rot)), s = Math.sin(rad(l.rot));
  return [l.x + lx * c - ly * s, l.y + lx * s + ly * c];
}
export function hits(l: Layer, px: number, py: number, pad = 0): boolean {
  const [lx, ly] = toLocal(l, px, py);
  return Math.abs(lx) <= l.w / 2 + pad && Math.abs(ly) <= l.h / 2 + pad;
}
/** Topmost visible layer under a point (locked layers can't be picked on the canvas). */
export function pick(c: Composition, px: number, py: number): Layer | null {
  for (let i = c.layers.length - 1; i >= 0; i--) {
    const l = c.layers[i];
    if (!l.hidden && !l.locked && hits(l, px, py)) return l;
  }
  return null;
}
export function corners(l: Layer): [number, number][] {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => toFrame(l, (sx * l.w) / 2, (sy * l.h) / 2));
}
export function bounds(ls: Layer[]): { x0: number; y0: number; x1: number; y1: number } {
  const pts = ls.flatMap(corners);
  return { x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])) };
}

/** 2D framing as a transform from frame units to the visible picture (crop/scale only). */
export function framingMatrix(c: Composition): { s: number; tx: number; ty: number } {
  const z = c.framing.zoom, H = frameH(c);
  return { s: z, tx: FRAME_W / 2 - (FRAME_W / 2 + c.framing.panX) * z, ty: H / 2 - (H / 2 + c.framing.panY) * z };
}
export function viewToFrame(c: Composition, vx: number, vy: number): [number, number] {
  const m = framingMatrix(c);
  return [(vx - m.tx) / m.s, (vy - m.ty) / m.s];
}

// ---- Edits (each returns a new composition; the input is never changed) ---------------

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
export const update = (c: Composition, ids: string[], f: (l: Layer) => Partial<Layer>): Composition =>
  ({ ...c, layers: c.layers.map((l) => (ids.includes(l.id) ? { ...l, ...f(l) } : l)) });

/** Everything that moves with a layer (its group). */
export function withGroup(c: Composition, ids: string[]): string[] {
  const groups = new Set(c.layers.filter((l) => ids.includes(l.id) && l.group).map((l) => l.group));
  return c.layers.filter((l) => ids.includes(l.id) || (l.group && groups.has(l.group))).map((l) => l.id);
}

export function addLayer(c: Composition, l: Omit<Layer, "id"> & { id?: string }): { comp: Composition; id: string } {
  const id = l.id ?? newId();
  return { comp: { ...c, layers: [...c.layers, { ...l, id } as Layer] }, id };
}
export function removeLayers(c: Composition, ids: string[]): Composition {
  return { ...c, layers: c.layers.filter((l) => !ids.includes(l.id) || l.locked) };
}
export function duplicateLayers(c: Composition, ids: string[], offset = 40): { comp: Composition; ids: string[] } {
  const groupMap = new Map<string, string>();
  const copies = c.layers.filter((l) => ids.includes(l.id)).map((l) => {
    const g = l.group ? groupMap.get(l.group) ?? (groupMap.set(l.group, newId("g")), groupMap.get(l.group)!) : undefined;
    return { ...clone(l), id: newId(), name: `${l.name} copy`, x: l.x + offset, y: l.y + offset, locked: undefined, group: g };
  });
  return { comp: { ...c, layers: [...c.layers, ...copies] }, ids: copies.map((l) => l.id) };
}
export function reorder(c: Composition, ids: string[], to: "up" | "down" | "front" | "back"): Composition {
  const sel = c.layers.filter((l) => ids.includes(l.id)), rest = c.layers.filter((l) => !ids.includes(l.id));
  if (!sel.length) return c;
  if (to === "front") return { ...c, layers: [...rest, ...sel] };
  if (to === "back") return { ...c, layers: [...sel, ...rest] };
  const layers = [...c.layers];
  const order = to === "up" ? [...layers.keys()].reverse() : [...layers.keys()];
  for (const i of order) {
    if (!ids.includes(layers[i].id)) continue;
    const j = to === "up" ? i + 1 : i - 1;
    if (j < 0 || j >= layers.length || ids.includes(layers[j].id)) continue;
    [layers[i], layers[j]] = [layers[j], layers[i]];
  }
  return { ...c, layers };
}
export function group(c: Composition, ids: string[]): Composition {
  if (ids.length < 2) return c;
  const g = newId("g");
  return update(c, ids, () => ({ group: g }));
}
export const ungroup = (c: Composition, ids: string[]) => update(c, withGroup(c, ids), () => ({ group: undefined }));

/** Scale a layer from a corner handle; keepRatio for images by default. */
export function resizeFromHandle(l: Layer, handle: [number, number], px: number, py: number, keepRatio: boolean, minSize = 8): Partial<Layer> {
  const [sx, sy] = handle;
  const [ax, ay] = toFrame(l, (-sx * l.w) / 2, (-sy * l.h) / 2); // opposite corner stays put
  const [lx, ly] = toLocal({ ...l, x: ax, y: ay }, px, py);
  let w = Math.max(minSize, Math.abs(lx)), h = Math.max(minSize, Math.abs(ly));
  if (keepRatio) { const k = Math.max(w / l.w, h / l.h); w = l.w * k; h = l.h * k; }
  const [cx, cy] = toFrame({ ...l, x: ax, y: ay }, (sx * w) / 2, (sy * h) / 2);
  return { w, h, x: cx, y: cy };
}
export function rotateTo(l: Layer, px: number, py: number, snap: boolean): Partial<Layer> {
  let a = (Math.atan2(py - l.y, px - l.x) * 180) / Math.PI + 90;
  if (snap) a = Math.round(a / 15) * 15;
  return { rot: Math.round(((a % 360) + 360) % 360 * 10) / 10 };
}

/** Alignment: snap a moving box to the frame's centre/edges/thirds and other layers' centres and edges. */
export function snapMove(c: Composition, moving: string[], dx: number, dy: number, threshold: number): { dx: number; dy: number; guides: { x?: number; y?: number }[] } {
  const ms = c.layers.filter((l) => moving.includes(l.id));
  if (!ms.length) return { dx, dy, guides: [] };
  const b = bounds(ms.map((l) => ({ ...l, x: l.x + dx, y: l.y + dy })));
  const H = frameH(c);
  const xs = [0, FRAME_W / 3, FRAME_W / 2, (2 * FRAME_W) / 3, FRAME_W], ys = [0, H / 3, H / 2, (2 * H) / 3, H];
  for (const o of c.layers) if (!moving.includes(o.id) && !o.hidden) { const ob = bounds([o]); xs.push(ob.x0, (ob.x0 + ob.x1) / 2, ob.x1); ys.push(ob.y0, (ob.y0 + ob.y1) / 2, ob.y1); }
  const best = (cands: number[], vals: number[]) => {
    let d = Infinity, at: number | undefined;
    for (const v of vals) for (const cnd of cands) if (Math.abs(cnd - v) < Math.abs(d) && Math.abs(cnd - v) <= threshold) { d = cnd - v; at = cnd; }
    return { d: Number.isFinite(d) ? d : 0, at };
  };
  const sx = best(xs, [b.x0, (b.x0 + b.x1) / 2, b.x1]), sy = best(ys, [b.y0, (b.y0 + b.y1) / 2, b.y1]);
  const guides: { x?: number; y?: number }[] = [];
  if (sx.at !== undefined) guides.push({ x: sx.at });
  if (sy.at !== undefined) guides.push({ y: sy.at });
  return { dx: dx + sx.d, dy: dy + sy.d, guides };
}

/** Change the frame's aspect ratio, keeping layers centred vertically. */
export function setAspect(c: Composition, aspect: number): Composition {
  const dy = (FRAME_W / aspect - frameH(c)) / 2;
  return { ...c, aspect, layers: c.layers.map((l) => ({ ...l, y: l.y + dy })) };
}

/** A copy for a new frame: independent layers (new IDs), same shared library references. */
export function copyForNewFrame(c: Composition): Composition {
  const groups = new Map<string, string>();
  return { ...clone(c), layers: c.layers.map((l) => ({ ...clone(l), id: newId(), group: l.group ? (groups.get(l.group) ?? (groups.set(l.group, newId("g")), groups.get(l.group))) : undefined })) };
}

/** Which library items a composition uses (for scope warnings and exports). */
export const libraryUse = (c: Composition) => [...new Set(c.layers.map((l) => l.libraryId).filter((x): x is string => !!x))];
export const assetUse = (c: Composition) => [...new Set(c.layers.map((l) => l.assetId).filter((x): x is string => !!x))];

// ---- Undo / redo ----------------------------------------------------------------------

export class History {
  private past: Composition[] = [];
  private future: Composition[] = [];
  constructor(private limit = 100) {}
  /** Record the state before a completed edit. */
  push(before: Composition) { this.past.push(before); if (this.past.length > this.limit) this.past.shift(); this.future = []; }
  undo(current: Composition): Composition | null { const p = this.past.pop(); if (!p) return null; this.future.push(current); return p; }
  redo(current: Composition): Composition | null { const f = this.future.pop(); if (!f) return null; this.past.push(current); return f; }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
}

// ---- Tips (deterministic, no model) ----------------------------------------------------

export function tipFor(c: Composition): string {
  const visible = c.layers.filter((l) => !l.hidden);
  if (!visible.length) return "Start with a background or a figure from Assets. You can move, scale and rotate anything.";
  const people = visible.filter((l) => l.type === "shape" && /^(person|child|head)/.test(l.shape ?? "") || l.type === "image");
  const H = frameH(c);
  const centred = people.find((l) => Math.abs(l.x - FRAME_W / 2) < FRAME_W * 0.06);
  if (centred) return "Try placing the character closer to the edge, on a third line. What changes?";
  const tiny = people.find((l) => l.h < H * 0.15);
  if (tiny) return "This figure is small in the frame. Is that what you want us to feel? Try a closer framing to compare.";
  if (c.framing.zoom === 1 && visible.length > 3) return "Try Camera → nearer. Which details fall out of the frame, and do you miss them?";
  if (!visible.some((l) => l.type === "text" || l.type === "drawing")) return "Draw an arrow to show where someone moves, or add a caption for a line of dialogue.";
  return "Duplicate this frame to start the next shot: then change only what's different.";
}
