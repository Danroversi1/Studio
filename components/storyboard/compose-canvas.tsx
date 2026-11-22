"use client";
// The Compose canvas: direct manipulation (move, scale, rotate), drawing and erasing, snapping
// guides and composition grids. Renders locally with the same renderer used for export. Live
// drags don't touch history or the network; a completed edit is reported once (commit).
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FRAME_W, addLayer, corners, frameH, framingMatrix, hits, pick, resizeFromHandle, rotateTo, snapMove, toFrame, toLocal, update, viewToFrame, withGroup,
  type Composition, type Layer, type Stroke,
} from "@/lib/storyboard/compose";
import { renderComposition, type ImageState } from "@/lib/storyboard/render";
import { getTrace, pathsOf } from "@/lib/storyboard/trace-store";
import { toBoxFraction } from "@/lib/storyboard/compose";

/** select · draw (her drawing) · note (arrows/annotations lane) · erase (deletes whole strokes
 *  it touches: vectors, not paint) · lasso (draw a mask on the selected picture) · paths
 *  (pick traced paths to delete or restyle). */
export type Tool = "select" | "draw" | "note" | "erase" | "lasso" | "paths";

let probe: CanvasRenderingContext2D | null = null;
function probeCtx() { probe ??= document.createElement("canvas").getContext("2d"); return probe!; }

/** Frame point → a traced layer's own path coordinates. */
function toTrace(l: Layer, fx: number, fy: number): [number, number] | null {
  const t = getTrace(l.traceId);
  if (!t) return null;
  const [bx, by] = toBoxFraction(l, fx, fy);
  return [bx * t.width, by * t.height];
}

/** Topmost path of a traced layer under a point (fills by area, strokes within tolerance). */
export function pathAt(l: Layer, fx: number, fy: number, tolerance: number): number | null {
  const t = getTrace(l.traceId), p = toTrace(l, fx, fy);
  if (!t || !p) return null;
  const ps = pathsOf(t), ctx = probeCtx(), removed = new Set(l.removed ?? []);
  const tol = tolerance * (t.width / l.w);
  for (let i = ps.length - 1; i >= 0; i--) {
    if (removed.has(i)) continue;
    const d = t.paths[i];
    if (d.f && d.f !== "none" && ctx.isPointInPath(ps[i], p[0], p[1], "evenodd")) return i;
    if (d.s && d.s !== "none") { ctx.lineWidth = Math.max((l.weight ?? d.w ?? 2), tol * 2); if (ctx.isPointInStroke(ps[i], p[0], p[1])) return i; }
  }
  return null;
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
/** Strokes of a drawing layer touched by a point (local coordinates). */
function strokesTouched(l: Layer, lx: number, ly: number, r: number): number[] {
  const out: number[] = [];
  (l.strokes ?? []).forEach((s, i) => {
    if (s.erase) return;
    const p = s.pts, rr = r + s.width / 2;
    if (p.length === 2 ? Math.hypot(lx - p[0], ly - p[1]) <= rr : p.some((_, k) => k % 2 === 0 && k + 3 < p.length && segDist(lx, ly, p[k], p[k + 1], p[k + 2], p[k + 3]) <= rr)) out.push(i);
  });
  return out;
}
export interface Pen { color: string; width: number }

type Drag =
  | { kind: "move"; ids: string[]; sx: number; sy: number; start: Composition }
  | { kind: "resize"; id: string; handle: [number, number]; start: Composition; keep: boolean }
  | { kind: "rotate"; id: string; start: Composition }
  | { kind: "draw"; id: string; start: Composition }
  | { kind: "erase"; start: Composition }
  | { kind: "lasso"; id: string; pts: number[]; frame: number[] };

export function ComposeCanvas({ comp, images, selected, tool, pen, showLook, editable, onChange, onSelect, onTextEdit, captureWidthMm,
  maskMode = "keep", selectedPaths = [], onSelectPaths, onHint, display }: {
  /** Display-only changes (trace preview, before/after, faded references): drawn, never edited or saved. */
  display?: (c: Composition) => Composition;
  comp: Composition; images: Map<string, ImageState>; selected: string[]; tool: Tool; pen: Pen; showLook: boolean; editable: boolean;
  maskMode?: "keep" | "remove"; selectedPaths?: number[]; onSelectPaths?: (layerId: string, paths: number[]) => void; onHint?: (text: string) => void;
  /** commit=false during a drag (preview only); commit=true once, with the state before the edit. */
  onChange: (next: Composition, commit: false | { before: Composition }) => void;
  onSelect: (ids: string[]) => void;
  onTextEdit?: (id: string) => void;
  captureWidthMm?: number;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const pic = useRef<HTMLCanvasElement>(null);
  const over = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const [width, setWidth] = useState(800);
  const [guides, setGuides] = useState<{ x?: number; y?: number }[]>([]);
  const [dragging, setDragging] = useState(false);
  const [lasso, setLasso] = useState<number[] | null>(null);
  const H = frameH(comp);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Picture: re-render on change. While dragging, skip the look (fast); apply it when idle.
  useEffect(() => {
    const c = pic.current;
    if (!c) return;
    const px = Math.min(2400, Math.round(width * (window.devicePixelRatio || 1)));
    const shown = display ? display(comp) : comp;
    renderComposition(c, shown, images, px, { look: false, preview: true, captureWidthMm });
    if (!showLook || dragging) return;
    const t = setTimeout(() => renderComposition(c, shown, images, px, { look: true, preview: true, captureWidthMm }), 120);
    return () => clearTimeout(t);
  }, [comp, images, width, showLook, dragging, captureWidthMm, display]);

  const unit = width / FRAME_W; // CSS px per frame unit
  const m = framingMatrix(comp);
  const toScreen = useCallback((fx: number, fy: number): [number, number] => [(fx * m.s + m.tx) * unit, (fy * m.s + m.ty) * unit], [m.s, m.tx, m.ty, unit]);
  const handleSize = 9 / (unit * m.s); // frame units

  // Overlay: grid, guides, selection and handles (never exported).
  useEffect(() => {
    const c = over.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(width * dpr); c.height = Math.round((width / comp.aspect) * dpr);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, width / comp.aspect);
    const W = width, Hs = width / comp.aspect;
    ctx.lineWidth = 1;
    if (comp.grid !== "none") {
      ctx.strokeStyle = "rgba(240,90,36,0.55)"; ctx.setLineDash([4, 4]);
      ctx.beginPath();
      if (comp.grid === "thirds") for (const f of [1 / 3, 2 / 3]) { ctx.moveTo(W * f, 0); ctx.lineTo(W * f, Hs); ctx.moveTo(0, Hs * f); ctx.lineTo(W, Hs * f); }
      if (comp.grid === "center") { ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, Hs); ctx.moveTo(0, Hs / 2); ctx.lineTo(W, Hs / 2); }
      if (comp.grid === "safe") { ctx.rect(W * 0.05, Hs * 0.05, W * 0.9, Hs * 0.9); ctx.rect(W * 0.1, Hs * 0.1, W * 0.8, Hs * 0.8); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.strokeStyle = "#2f6fdf";
    for (const g of guides) {
      ctx.beginPath();
      if (g.x !== undefined) { const [x] = toScreen(g.x, 0); ctx.moveTo(x, 0); ctx.lineTo(x, Hs); }
      if (g.y !== undefined) { const [, y] = toScreen(0, g.y); ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke();
    }
    if (lasso && lasso.length >= 4) {
      ctx.strokeStyle = maskMode === "keep" ? "#1f9d55" : "#d33"; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.beginPath();
      for (let i = 0; i < lasso.length; i += 2) { const [x, y] = toScreen(lasso[i], lasso[i + 1]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
    }
    const vec = comp.layers.find((l) => selected.length === 1 && l.id === selected[0] && l.type === "vector");
    const tr = vec ? getTrace(vec.traceId) : undefined;
    if (vec && tr && selectedPaths.length) {
      const ps = pathsOf(tr);
      ctx.save();
      const [ox, oy] = toScreen(...toFrame(vec, 0, 0));
      ctx.translate(ox, oy); ctx.rotate((vec.rot * Math.PI) / 180);
      const k = unit * m.s; ctx.scale((vec.flipX ? -1 : 1) * k, (vec.flipY ? -1 : 1) * k);
      ctx.translate(-vec.w / 2, -vec.h / 2); ctx.scale(vec.w / tr.width, vec.h / tr.height);
      ctx.strokeStyle = "#2f6fdf"; ctx.fillStyle = "rgba(47,111,223,0.35)"; ctx.lineWidth = 3 * (tr.width / vec.w) / k;
      for (const i of selectedPaths) if (ps[i]) { if (tr.paths[i].f) ctx.fill(ps[i], "evenodd"); ctx.stroke(ps[i]); }
      ctx.restore();
    }
    const sel = comp.layers.filter((l) => selected.includes(l.id) && !l.hidden);
    for (const l of sel) {
      const pts = corners(l).map(([x, y]) => toScreen(x, y));
      ctx.strokeStyle = l.locked ? "#999" : "#f05a24"; ctx.lineWidth = 1.5;
      ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke();
      if (sel.length === 1 && !l.locked && editable && tool === "select") {
        ctx.fillStyle = "#fff"; ctx.strokeStyle = "#f05a24";
        for (const [x, y] of pts) { ctx.fillRect(x - 5, y - 5, 10, 10); ctx.strokeRect(x - 5, y - 5, 10, 10); }
        const [rx, ry] = toScreen(...toFrame(l, 0, -l.h / 2 - 34 / (unit * m.s)));
        const [tx, ty] = toScreen(...toFrame(l, 0, -l.h / 2));
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(rx, ry); ctx.stroke();
        ctx.beginPath(); ctx.arc(rx, ry, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }
  }, [comp, selected, guides, width, toScreen, unit, m.s, tool, editable, lasso, maskMode, selectedPaths]);

  function framePoint(e: React.PointerEvent): [number, number] {
    const r = over.current!.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * FRAME_W, vy = ((e.clientY - r.top) / r.height) * H;
    return viewToFrame(comp, vx, vy);
  }

  function down(e: React.PointerEvent) {
    (e.target as HTMLElement).focus({ preventScroll: true });
    if (!editable) return;
    const [fx, fy] = framePoint(e);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (tool === "draw" || tool === "note") {
      let c = comp;
      const note = tool === "note";
      let target = comp.layers.find((l) => selected.includes(l.id) && l.type === "drawing" && !l.locked && !l.hidden && (l.role === "annotation") === note)
        ?? comp.layers.slice().reverse().find((l) => l.type === "drawing" && !l.locked && !l.hidden && (l.role === "annotation") === note);
      if (!target) {
        const res = addLayer(c, { type: "drawing", name: note ? "Arrows & notes" : "My drawing", role: note ? "annotation" : undefined, x: FRAME_W / 2, y: H / 2, w: FRAME_W, h: H, rot: 0, strokes: [] });
        c = res.comp; target = c.layers.find((l) => l.id === res.id)!;
      }
      onSelect([target.id]);
      const [lx, ly] = toLocal(target, fx, fy);
      const stroke: Stroke = { color: pen.color, width: pen.width, pts: [lx, ly] };
      drag.current = { kind: "draw", id: target.id, start: comp };
      setDragging(true);
      onChange(update(c, [target.id], (l) => ({ strokes: [...(l.strokes ?? []), stroke] })), false);
      return;
    }
    if (tool === "erase") {
      drag.current = { kind: "erase", start: comp }; setDragging(true);
      eraseAt(comp, fx, fy);
      return;
    }
    if (tool === "lasso") {
      const img = comp.layers.find((l) => selected.length === 1 && l.id === selected[0] && l.type === "image" && !l.locked) ?? pick(comp, fx, fy);
      if (!img || img.type !== "image" || img.locked) { onHint?.("Select a picture first, then draw around what you want to keep (or cut away)."); return; }
      onSelect([img.id]);
      drag.current = { kind: "lasso", id: img.id, pts: [...toBoxFraction(img, fx, fy)], frame: [fx, fy] };
      setLasso([fx, fy]); setDragging(true);
      return;
    }
    if (tool === "paths") {
      const tol = 6 / (unit * m.s);
      const layers = comp.layers.filter((l) => l.type === "vector" && !l.hidden && !l.locked).reverse();
      for (const l of layers) {
        const i = pathAt(l, fx, fy, tol);
        if (i === null) continue;
        onSelect([l.id]);
        const cur = selected.length === 1 && selected[0] === l.id ? selectedPaths : [];
        onSelectPaths?.(l.id, e.shiftKey ? (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]) : [i]);
        return;
      }
      onSelectPaths?.(selected[0] ?? "", []);
      return;
    }
    const one = comp.layers.find((l) => selected.length === 1 && l.id === selected[0] && !l.locked);
    if (one) {
      const rot = toFrame(one, 0, -one.h / 2 - 34 / (unit * m.s));
      if (Math.hypot(fx - rot[0], fy - rot[1]) < handleSize * 1.4) {
        drag.current = { kind: "rotate", id: one.id, start: comp }; setDragging(true); return;
      }
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as [number, number][]) {
        const [cx, cy] = toFrame(one, (sx * one.w) / 2, (sy * one.h) / 2);
        if (Math.abs(fx - cx) < handleSize * 1.2 && Math.abs(fy - cy) < handleSize * 1.2) {
          drag.current = { kind: "resize", id: one.id, handle: [sx, sy], start: comp, keep: one.type === "image" || one.type === "drawing" ? !e.shiftKey : e.shiftKey };
          setDragging(true); return;
        }
      }
    }
    const hit = pick(comp, fx, fy);
    if (!hit) { onSelect([]); return; }
    const ids = e.shiftKey ? (selected.includes(hit.id) ? selected.filter((x) => x !== hit.id) : [...selected, hit.id]) : selected.includes(hit.id) ? selected : [hit.id];
    onSelect(ids);
    const moving = withGroup(comp, ids).filter((id) => !comp.layers.find((l) => l.id === id)?.locked);
    drag.current = { kind: "move", ids: moving, sx: fx, sy: fy, start: comp };
    setDragging(true);
  }

  /** Delete the strokes the eraser touches (in every visible, unlocked drawing layer). */
  function eraseAt(c: Composition, fx: number, fy: number) {
    const r = pen.width * 1.5;
    let next = c, changed = false;
    for (const l of c.layers) {
      if (l.type !== "drawing" || l.hidden || l.locked) continue;
      const [lx, ly] = toLocal(l, fx, fy);
      const hit = strokesTouched(l, lx, ly, r);
      if (hit.length) { changed = true; next = update(next, [l.id], (x) => ({ strokes: (x.strokes ?? []).filter((_, i) => !hit.includes(i)) })); }
    }
    if (changed) onChange(next, false);
  }

  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const [fx, fy] = framePoint(e);
    if (d.kind === "erase") { eraseAt(comp, fx, fy); return; }
    if (d.kind === "lasso") {
      const l = comp.layers.find((x) => x.id === d.id);
      if (!l) return;
      const n = d.frame.length;
      if (Math.hypot(fx - d.frame[n - 2], fy - d.frame[n - 1]) < 4 / (unit * m.s)) return;
      d.frame.push(fx, fy); d.pts.push(...toBoxFraction(l, fx, fy));
      setLasso([...d.frame]);
      return;
    }
    if (d.kind === "draw") {
      const l = comp.layers.find((x) => x.id === d.id);
      if (!l) return;
      const [lx, ly] = toLocal(l, fx, fy);
      const strokes = [...(l.strokes ?? [])];
      const last = { ...strokes[strokes.length - 1] };
      const n = last.pts.length;
      if (Math.hypot(lx - last.pts[n - 2], ly - last.pts[n - 1]) < 1.5) return;
      last.pts = [...last.pts, Math.round(lx * 10) / 10, Math.round(ly * 10) / 10];
      strokes[strokes.length - 1] = last;
      onChange(update(comp, [d.id], () => ({ strokes })), false);
      return;
    }
    if (d.kind === "move") {
      const snapped = e.altKey ? { dx: fx - d.sx, dy: fy - d.sy, guides: [] } : snapMove(d.start, d.ids, fx - d.sx, fy - d.sy, 8 / (unit * m.s));
      setGuides(snapped.guides);
      onChange(update(d.start, d.ids, (l) => ({ x: l.x + snapped.dx, y: l.y + snapped.dy })), false);
    } else if (d.kind === "resize") {
      const l = d.start.layers.find((x) => x.id === d.id)!;
      onChange(update(d.start, [d.id], () => resizeFromHandle(l, d.handle, fx, fy, d.keep)), false);
    } else if (d.kind === "rotate") {
      const l = d.start.layers.find((x) => x.id === d.id)!;
      onChange(update(d.start, [d.id], () => rotateTo(l, fx, fy, !e.shiftKey)), false);
    }
  }

  function up() {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    setGuides([]);
    if (!d) return;
    if (d.kind === "lasso") {
      setLasso(null);
      if (d.pts.length < 6) return;
      const pts = d.pts.map((v) => Math.round(v * 10000) / 10000);
      onChange(update(comp, [d.id], (l) => ({ masks: [...(l.masks ?? []), { mode: maskMode, pts }] })), { before: comp });
      return;
    }
    if (JSON.stringify(d.start.layers) !== JSON.stringify(comp.layers)) onChange(comp, { before: d.start });
  }

  function dbl(e: React.MouseEvent) {
    const r = over.current!.getBoundingClientRect();
    const [fx, fy] = viewToFrame(comp, ((e.clientX - r.left) / r.width) * FRAME_W, ((e.clientY - r.top) / r.height) * H);
    const l = comp.layers.slice().reverse().find((x) => !x.hidden && x.type === "text" && hits(x, fx, fy));
    if (l && onTextEdit) onTextEdit(l.id);
  }

  const cursor = !editable ? "default" : tool === "select" ? "default" : "crosshair";
  return (
    <div ref={wrap} className="relative w-full select-none border border-line bg-[#cfcfcf]" style={{ aspectRatio: String(comp.aspect) }}>
      <canvas ref={pic} className="absolute inset-0 size-full" aria-hidden />
      <canvas ref={over} tabIndex={0} className="absolute inset-0 size-full touch-none outline-none focus-visible:outline-2 focus-visible:outline-brand" style={{ cursor }}
        role="application" aria-label="Frame canvas. Use the Layers panel or the arrow keys to move the selected layer."
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={dbl} />
    </div>
  );
}

export const layerById = (c: Composition, id: string): Layer | undefined => c.layers.find((l) => l.id === id);
