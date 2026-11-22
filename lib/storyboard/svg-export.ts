// SVG export, built only from validated pieces (path data, #hex colours, numbers, escaped
// text), so the file can never carry script or markup from anywhere else. Pure; unit-tested.
//   "vector": traced paths, hand drawing, shapes, arrows and text — real, editable vectors.
//   "mixed":  the same plus reference pictures embedded as data: URIs (with crops and masks).
// The colour Look (grain, exposure…) is a raster effect and is not part of an SVG.
import { FRAME_W, frameH, framingMatrix, type Composition, type Layer } from "./compose";
import { shapeById } from "./shapes";
import { getTrace } from "./trace-store";

const PATH_D = /^[MLQCZHVSTAmlqczhvsta0-9 .,eE+-]+$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const n = (v: number) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);
const col = (c: string | undefined, d: string) => (c && HEX.test(c) ? c : c && /^#[0-9a-fA-F]{8}$/.test(c) ? c.slice(0, 7) : d);
const esc = (t: string) => t.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
const dOk = (d: string) => PATH_D.test(d);
const DATA_URI = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;

export interface SvgResult { svg: string; leftOut: string[] }

function polyD(pts: number[]): string {
  let d = `M${n(pts[0])} ${n(pts[1])}`;
  if (pts.length === 2) d += `L${n(pts[0] + 0.01)} ${n(pts[1])}`;
  for (let i = 2; i < pts.length; i += 2) d += `L${n(pts[i])} ${n(pts[i + 1])}`;
  return d;
}

function maskPoly(pts: number[], w: number, h: number) {
  const out: string[] = [];
  for (let i = 0; i < pts.length; i += 2) out.push(`${n((pts[i] - 0.5) * w)},${n((pts[i + 1] - 0.5) * h)}`);
  return out.join(" ");
}

function layerSvg(l: Layer, mode: "vector" | "mixed", images: Map<string, string>, leftOut: string[], uid: string): string {
  const w = l.w, h = l.h;
  const tf = `translate(${n(l.x)} ${n(l.y)}) rotate(${n(l.rot)}) scale(${l.flipX ? -1 : 1} ${l.flipY ? -1 : 1})`;
  const op = l.opacity !== undefined && l.opacity < 1 ? ` opacity="${n(l.opacity)}"` : "";
  let body = "", defs = "";
  if (l.type === "vector") {
    const t = getTrace(l.traceId);
    if (!t) { leftOut.push(`“${l.name}” (its trace isn't loaded)`); return ""; }
    const removed = new Set(l.removed ?? []);
    const parts: string[] = [];
    t.paths.forEach((p, i) => {
      if (removed.has(i) || !dOk(p.d)) return;
      if (p.f && p.f !== "none") {
        const f = l.mid && p.f === t.settings.mid ? l.mid : l.ink && p.f === t.settings.ink ? l.ink : p.f;
        parts.push(`<path d="${p.d}" fill="${col(f, "#000000")}" fill-rule="evenodd"/>`);
      } else if (p.s && p.s !== "none") {
        parts.push(`<path d="${p.d}" fill="none" stroke="${col(l.ink ?? p.s, "#000000")}" stroke-width="${n(l.weight ?? p.w ?? 2)}" stroke-linecap="round" stroke-linejoin="round"/>`);
      }
    });
    body = `<g transform="translate(${n(-w / 2)} ${n(-h / 2)}) scale(${n(w / t.width)} ${n(h / t.height)})">${parts.join("")}</g>`;
  } else if (l.type === "drawing") {
    const strokes = l.strokes ?? [];
    const draw = strokes.filter((s) => !s.erase).map((s) => `<path d="${polyD(s.pts)}" fill="none" stroke="${col(s.color, "#111111")}" stroke-width="${n(s.width)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    const erase = strokes.filter((s) => s.erase);
    if (erase.length) {
      // Older boards used a paint eraser: kept as a mask so the file still looks the same.
      defs += `<mask id="${uid}e" maskUnits="userSpaceOnUse" x="${n(-w / 2)}" y="${n(-h / 2)}" width="${n(w)}" height="${n(h)}"><rect x="${n(-w / 2)}" y="${n(-h / 2)}" width="${n(w)}" height="${n(h)}" fill="#fff"/>${erase.map((s) => `<path d="${polyD(s.pts)}" fill="none" stroke="#000" stroke-width="${n(s.width)}" stroke-linecap="round"/>`).join("")}</mask>`;
      body = `<g mask="url(#${uid}e)">${draw.join("")}</g>`;
    } else body = draw.join("");
  } else if (l.type === "shape") {
    const s = shapeById(l.shape);
    if (!dOk(s.path)) return "";
    const fill = l.fill && /^#[0-9a-f]{6}00$/i.test(l.fill) ? "none" : col(l.fill ?? s.fill, "#3a3a3a");
    const stroke = l.stroke && (l.strokeWidth ?? 0) > 0 ? ` stroke="${col(l.stroke, "#111111")}" stroke-width="${n((l.strokeWidth ?? 2) * (100 / Math.max(w, h)))}"` : "";
    body = `<g transform="translate(${n(-w / 2)} ${n(-h / 2)}) scale(${n(w / 100)} ${n(h / 100)})"><path d="${s.path}" fill="${fill}" fill-rule="evenodd"${stroke}/></g>`;
  } else if (l.type === "text") {
    const fs = l.fontSize ?? 48, lh = fs * 1.25, pad = l.box ? fs * 0.4 : 0;
    const perLine = Math.max(1, Math.floor((w - pad * 2) / (fs * 0.6)));
    const lines = (l.text ?? "").split("\n").flatMap((para) => {
      const out: string[] = []; let line = "";
      for (const word of para.split(/\s+/)) { const t = line ? `${line} ${word}` : word; if (t.length > perLine && line) { out.push(line); line = word; } else line = t; }
      out.push(line); return out;
    });
    const anchor = l.align === "left" ? "start" : l.align === "right" ? "end" : "middle";
    const x = l.align === "left" ? -w / 2 + pad : l.align === "right" ? w / 2 - pad : 0;
    const y0 = -(lines.length * lh) / 2;
    const box = l.box ? `<rect x="${n(-w / 2)}" y="${n(-h / 2)}" width="${n(w)}" height="${n(h)}" fill="#ffffff" fill-opacity="0.92" stroke="#111111" stroke-width="${n(Math.max(1, fs / 16))}"/>` : "";
    body = box + `<text font-family="ui-monospace, monospace" font-weight="600" font-size="${n(fs)}" fill="${col(l.color, "#111111")}" text-anchor="${anchor}">` +
      lines.map((t, i) => `<tspan x="${n(x)}" y="${n(y0 + i * lh + fs)}">${esc(t)}</tspan>`).join("") + "</text>";
  } else if (l.type === "image") {
    if (mode === "vector") { leftOut.push(`picture “${l.name}”`); return ""; }
    const uri = l.assetId ? images.get(l.assetId) : undefined;
    if (!uri || !DATA_URI.test(uri)) { leftOut.push(`picture “${l.name}” (couldn't be embedded)`); return ""; }
    const c = l.crop ?? { l: 0, t: 0, r: 0, b: 0 };
    const fw = 1 - c.l - c.r, fh = 1 - c.t - c.b;
    // Crop: draw the whole picture scaled so the kept part fills the box, clipped to the box.
    const iw = w / fw, ih = h / fh;
    const img = `<image href="${uri}" x="${n(-w / 2 - c.l * iw)}" y="${n(-h / 2 - c.t * ih)}" width="${n(iw)}" height="${n(ih)}" preserveAspectRatio="none"/>`;
    defs += `<clipPath id="${uid}c"><rect x="${n(-w / 2)}" y="${n(-h / 2)}" width="${n(w)}" height="${n(h)}"/></clipPath>`;
    let inner = `<g clip-path="url(#${uid}c)">${img}</g>`;
    const keeps = (l.masks ?? []).filter((m) => m.mode === "keep"), removes = (l.masks ?? []).filter((m) => m.mode === "remove");
    if (keeps.length) { defs += `<clipPath id="${uid}k">${keeps.map((m) => `<polygon points="${maskPoly(m.pts, w, h)}"/>`).join("")}</clipPath>`; inner = `<g clip-path="url(#${uid}k)">${inner}</g>`; }
    if (removes.length) {
      defs += `<mask id="${uid}r" maskUnits="userSpaceOnUse" x="${n(-w / 2)}" y="${n(-h / 2)}" width="${n(w)}" height="${n(h)}"><rect x="${n(-w / 2)}" y="${n(-h / 2)}" width="${n(w)}" height="${n(h)}" fill="#fff"/>${removes.map((m) => `<polygon points="${maskPoly(m.pts, w, h)}" fill="#000"/>`).join("")}</mask>`;
      inner = `<g mask="url(#${uid}r)">${inner}</g>`;
    }
    body = inner;
  }
  return `${defs ? `<defs>${defs}</defs>` : ""}<g transform="${tf}"${op}>${body}</g>`;
}

/** Build an SVG of one frame. images: assetId → data:image/png|jpeg;base64 (mixed mode only). */
export function buildSvg(c: Composition, mode: "vector" | "mixed", images: Map<string, string> = new Map()): SvgResult {
  const H = frameH(c), m = framingMatrix(c), leftOut: string[] = [];
  const layers = c.layers.filter((l) => !l.hidden).map((l, i) => layerSvg(l, mode, images, leftOut, `L${i}`)).join("");
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FRAME_W} ${n(H)}" width="${FRAME_W}" height="${n(H)}">` +
    `<clipPath id="frame"><rect width="${FRAME_W}" height="${n(H)}"/></clipPath>` +
    `<rect width="${FRAME_W}" height="${n(H)}" fill="${col(c.bg, "#ffffff")}"/>` +
    `<g clip-path="url(#frame)"><g transform="matrix(${n(m.s)} 0 0 ${n(m.s)} ${n(m.tx)} ${n(m.ty)})">${layers}</g></g></svg>`;
  return { svg, leftOut };
}
