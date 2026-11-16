// BROWSER. One renderer for the editing preview, the sequence thumbnails and every export,
// so what you see is what you export. Draws locally on a canvas; no model calls. Images are
// loaded from asset storage with CORS so the canvas can still be exported; anything that
// can't be loaded or would block export is reported by name, never silently dropped.
import { FRAME_W, frameH, framingMatrix, type Composition, type Layer } from "./compose";
import { applyLook, isNeutral } from "./look";
import { shapeById } from "./shapes";

export type ImageState = { img: HTMLImageElement; ok: true } | { ok: false; error: string };
const cache = new Map<string, Promise<ImageState>>();

/** Load an asset image once per page (cached), with CORS so exports keep working. */
export function loadAsset(assetId: string): Promise<ImageState> {
  let p = cache.get(assetId);
  if (!p) {
    p = new Promise<ImageState>((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.decoding = "async";
      img.onload = () => resolve({ img, ok: true });
      img.onerror = () => resolve({ ok: false, error: "couldn't be loaded" });
      img.src = `/api/assets/${assetId}`;
    });
    cache.set(assetId, p);
    p.then((s) => { if (!s.ok) setTimeout(() => cache.delete(assetId), 30_000); });
  }
  return p;
}

export async function loadAll(ids: string[]): Promise<Map<string, ImageState>> {
  const out = new Map<string, ImageState>();
  await Promise.all(ids.map(async (id) => out.set(id, await loadAsset(id))));
  return out;
}

export interface RenderResult { missing: { layer: string; assetId: string; error: string }[]; tainted: boolean }

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const t = line ? `${line} ${word}` : word;
      if (ctx.measureText(t).width > width && line) { lines.push(line); line = word; } else line = t;
    }
    lines.push(line);
  }
  return lines;
}

function drawLayer(ctx: CanvasRenderingContext2D, l: Layer, images: Map<string, ImageState>, res: RenderResult, unit: number, preview: boolean) {
  ctx.save();
  ctx.translate(l.x, l.y);
  ctx.rotate((l.rot * Math.PI) / 180);
  ctx.scale(l.flipX ? -1 : 1, l.flipY ? -1 : 1);
  ctx.globalAlpha = l.opacity ?? 1;
  const w = l.w, h = l.h;
  if (l.type === "image") {
    const st = l.assetId ? images.get(l.assetId) : undefined;
    if (st?.ok) {
      const iw = st.img.naturalWidth, ih = st.img.naturalHeight, c = l.crop ?? { l: 0, t: 0, r: 0, b: 0 };
      const sx = c.l * iw, sy = c.t * ih, sw = Math.max(1, iw * (1 - c.l - c.r)), sh = Math.max(1, ih * (1 - c.t - c.b));
      ctx.drawImage(st.img, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
    } else {
      if (l.assetId) res.missing.push({ layer: l.name, assetId: l.assetId, error: st && !st.ok ? st.error : "is still loading" });
      if (preview) {
        ctx.fillStyle = "#e4e4e4"; ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.strokeStyle = "#999"; ctx.lineWidth = 2 / unit; ctx.strokeRect(-w / 2, -h / 2, w, h);
        ctx.beginPath(); ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(w / 2, h / 2); ctx.moveTo(w / 2, -h / 2); ctx.lineTo(-w / 2, h / 2); ctx.stroke();
      }
    }
  } else if (l.type === "shape") {
    const s = shapeById(l.shape);
    ctx.translate(-w / 2, -h / 2);
    ctx.scale(w / 100, h / 100);
    const p = new Path2D(s.path);
    const fill = l.fill ?? s.fill ?? "#3a3a3a";
    if (!/^#[0-9a-f]{6}00$/i.test(fill)) { ctx.fillStyle = fill; ctx.fill(p, "evenodd"); }
    if (l.stroke && (l.strokeWidth ?? 0) > 0) {
      ctx.lineWidth = (l.strokeWidth ?? 2) * (100 / Math.max(w, h)); // outline width in frame units
      ctx.strokeStyle = l.stroke; ctx.stroke(p);
    }
  } else if (l.type === "text") {
    const fs = l.fontSize ?? 48;
    ctx.font = `600 ${fs}px "JetBrains Mono Variable", ui-monospace, monospace`;
    ctx.textBaseline = "top";
    const pad = l.box ? fs * 0.4 : 0;
    const lines = wrap(ctx, l.text ?? "", Math.max(10, w - pad * 2));
    const lh = fs * 1.25, total = lines.length * lh;
    if (l.box) {
      ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.strokeStyle = "#111"; ctx.lineWidth = Math.max(1, fs / 16); ctx.strokeRect(-w / 2, -h / 2, w, h);
    }
    ctx.fillStyle = l.color ?? "#111";
    ctx.textAlign = l.align ?? "center";
    const x = l.align === "left" ? -w / 2 + pad : l.align === "right" ? w / 2 - pad : 0;
    let y = -total / 2;
    for (const line of lines) { ctx.fillText(line, x, y); y += lh; }
  } else if (l.type === "drawing" && l.strokes?.length) {
    // Strokes are drawn on their own layer so the eraser only erases this drawing.
    const scale = unit;
    const cw = Math.max(1, Math.ceil(w * scale)), ch = Math.max(1, Math.ceil(h * scale));
    const off = document.createElement("canvas"); off.width = cw; off.height = ch;
    const o = off.getContext("2d")!;
    o.scale(scale, scale); o.translate(w / 2, h / 2);
    o.lineCap = "round"; o.lineJoin = "round";
    for (const s of l.strokes) {
      o.globalCompositeOperation = s.erase ? "destination-out" : "source-over";
      o.strokeStyle = s.color; o.lineWidth = s.width;
      o.beginPath(); o.moveTo(s.pts[0], s.pts[1]);
      if (s.pts.length === 2) o.lineTo(s.pts[0] + 0.01, s.pts[1]);
      for (let i = 2; i < s.pts.length; i += 2) o.lineTo(s.pts[i], s.pts[i + 1]);
      o.stroke();
    }
    ctx.drawImage(off, -w / 2, -h / 2, w, h);
  }
  ctx.restore();
}

/** Render a composition to a canvas of the given pixel width (height follows the aspect). */
export function renderComposition(canvas: HTMLCanvasElement, c: Composition, images: Map<string, ImageState>, widthPx: number,
  opts: { look?: boolean; preview?: boolean; captureWidthMm?: number; skipIds?: string[] } = {}): RenderResult {
  const res: RenderResult = { missing: [], tainted: false };
  const W = Math.max(1, Math.round(widthPx)), H = Math.max(1, Math.round(widthPx / c.aspect));
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: opts.look !== false })!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = c.bg; ctx.fillRect(0, 0, W, H);
  const unit = W / FRAME_W;
  const m = framingMatrix(c);
  ctx.setTransform(unit * m.s, 0, 0, unit * m.s, unit * m.tx, unit * m.ty);
  for (const l of c.layers) if (!l.hidden && !opts.skipIds?.includes(l.id)) drawLayer(ctx, l, images, res, unit * m.s, opts.preview ?? false);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (opts.look !== false && !isNeutral(c.look)) {
    try {
      const d = ctx.getImageData(0, 0, W, H);
      d.data.set(applyLook(d.data, W, H, c.look, opts.captureWidthMm));
      ctx.putImageData(d, 0, 0);
    } catch { res.tainted = true; }
  }
  return res;
}

/** Export one frame as PNG; explains exactly which images block it instead of failing silently. */
export async function exportPng(c: Composition, widthPx: number, captureWidthMm?: number): Promise<{ blob?: Blob; problems: string[] }> {
  const ids = [...new Set(c.layers.filter((l) => !l.hidden && l.assetId).map((l) => l.assetId!))];
  const images = await loadAll(ids);
  const canvas = document.createElement("canvas");
  const res = renderComposition(canvas, c, images, widthPx, { captureWidthMm });
  const problems = res.missing.map((m) => `“${m.layer}” ${m.error}`);
  if (res.tainted) problems.push("An image doesn't allow export from this site (cross-origin).");
  if (problems.length) return { problems };
  const blob = await new Promise<Blob | null>((r) => { try { canvas.toBlob(r, "image/png"); } catch { r(null); } });
  return blob ? { blob, problems } : { problems: ["The browser refused to export this frame (an image blocked it)."] };
}

export function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export { FRAME_W, frameH };
