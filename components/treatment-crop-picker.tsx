"use client";
// Choose a thumbnail as a crop of the treatment: pick a slide, drag the window over the
// part you want, resize it with the corner, save. Shown live from Google; nothing is copied.
// The crop is pinned to the slide's permanent Google ID plus its position and size on the
// slide, so it stays put when slides are added, removed or reordered.
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { setThumbnailCrop } from "@/app/projects/[projectId]/thumb-actions";
import { SlidesApiOffError, googleConfig, treatmentSlideIds } from "@/lib/google/client";
import { SLIDE_ASPECT, slideEmbedUrl, windowOf, type ThumbCrop } from "@/lib/thumb";
import { ThumbView } from "./thumb-view";

export function TreatmentCropPicker({ projectId, entityId, entityName, fileId, initial, onDone }: {
  projectId: string; entityId: string; entityName: string; fileId: string; initial: ThumbCrop | null; onDone?: () => void;
}) {
  const router = useRouter();
  const same = initial?.file_id === fileId;
  const [slide, setSlide] = useState(same ? initial.slide : 1);
  const [slideId, setSlideId] = useState<string | null>(same ? initial.slide_id ?? null : null);
  const [ids, setIds] = useState<string[] | null>(null);
  const [win, setWin] = useState(initial?.file_id === fileId ? { x: initial.x, y: initial.y, w: initial.w, h: initial.h } : windowOf(0.35, 0.2, 0.3));
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: "move" | "size"; sx: number; sy: number; o: typeof win } | null>(null);

  function down(e: React.PointerEvent, mode: "move" | "size") {
    e.preventDefault(); e.stopPropagation();
    drag.current = { mode, sx: e.clientX, sy: e.clientY, o: win };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent) {
    const d = drag.current, el = stage.current;
    if (!d || !el) return;
    const r = el.getBoundingClientRect();
    const dx = (e.clientX - d.sx) / r.width, dy = (e.clientY - d.sy) / r.height;
    setWin(d.mode === "move" ? windowOf(d.o.x + dx, d.o.y + dy, d.o.w) : windowOf(d.o.x, d.o.y, d.o.w + dx));
  }
  function nudge(e: React.KeyboardEvent) {
    const step = e.shiftKey ? 0.05 : 0.01;
    const k: Record<string, [number, number, number]> = {
      ArrowLeft: [-step, 0, 0], ArrowRight: [step, 0, 0], ArrowUp: [0, -step, 0], ArrowDown: [0, step, 0], "+": [0, 0, step], "=": [0, 0, step], "-": [0, 0, -step],
    };
    const m = k[e.key];
    if (!m) return;
    e.preventDefault();
    setWin((w) => windowOf(w.x + m[0], w.y + m[1], w.w + m[2]));
  }
  function go(n: number) {
    const next = Math.max(1, Math.min(ids?.length || 500, n));
    setSlide(next);
    setSlideId(ids?.[next - 1] ?? null);
  }

  /** The slide's permanent ID (asks Google once; she may be asked to pick the treatment). */
  async function pin(): Promise<{ n: number; id: string | null; note?: string }> {
    const cfg = googleConfig();
    if (!cfg) return { n: slide, id: slideId };
    try {
      const list = ids ?? await treatmentSlideIds(cfg, fileId);
      setIds(list);
      const at = slideId ? list.indexOf(slideId) : -1;
      if (at >= 0) return { n: at + 1, id: slideId };
      return { n: slide, id: list[slide - 1] ?? null };
    } catch (e) {
      return { n: slide, id: slideId, note: e instanceof SlidesApiOffError
        ? "Saved. It's pinned to the slide number for now: if slides move, choose it again."
        : "Saved, but Google didn't open the treatment, so it's pinned to the slide number for now." };
    }
  }

  function save() {
    setMsg(null);
    start(async () => {
      try {
        const p = await pin();
        const r = await setThumbnailCrop({ projectId, entityId, crop: { file_id: fileId, slide: p.n, slide_id: p.id, ...win } });
        if (!r.ok) { setMsg(r.error); return; }
        setSlide(p.n); setSlideId(p.id);
        router.refresh();
        if (p.note) setMsg(p.note); else onDone?.();
      } catch { setMsg("That didn't save. Try again."); }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" className="btn min-h-9 px-3 text-xs" onClick={() => go(slide - 1)} disabled={slide <= 1} aria-label="Previous slide">←</button>
        <span>Slide <b>{slide}</b></span>
        <button type="button" className="btn min-h-9 px-3 text-xs" onClick={() => go(slide + 1)} disabled={!!ids && slide >= ids.length} aria-label="Next slide">→</button>
        <span className="text-xs text-muted">Drag the box over the part you want; drag its corner to resize (or use the arrow keys and + / −).</span>
      </div>
      <div ref={stage} className="relative w-full overflow-hidden border border-line bg-black select-none touch-none"
        style={{ aspectRatio: String(SLIDE_ASPECT) }} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        <iframe key={slideId ?? slide} title={`Treatment slide ${slide}`} src={slideEmbedUrl(fileId, slide, slideId)} tabIndex={-1}
          className="pointer-events-none absolute inset-0 size-full border-0" />
        <div className="absolute inset-0 bg-black/40" style={{ clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 ${win.y * 100}%, ${win.x * 100}% ${win.y * 100}%, ${win.x * 100}% ${(win.y + win.h) * 100}%, ${(win.x + win.w) * 100}% ${(win.y + win.h) * 100}%, ${(win.x + win.w) * 100}% ${win.y * 100}%, 0 ${win.y * 100}%)` }} aria-hidden />
        <div role="slider" tabIndex={0} aria-label={`Thumbnail window for ${entityName}. Arrow keys move it, plus and minus resize it.`}
          aria-valuetext={`Slide ${slide}, ${Math.round(win.x * 100)}% from the left, ${Math.round(win.y * 100)}% from the top`}
          onKeyDown={nudge} onPointerDown={(e) => down(e, "move")}
          className="absolute cursor-move border-2 border-brand shadow-[0_0_0_1px_rgba(0,0,0,0.4)] focus-visible:outline-2 focus-visible:outline-white"
          style={{ left: `${win.x * 100}%`, top: `${win.y * 100}%`, width: `${win.w * 100}%`, height: `${win.h * 100}%` }}>
          <span onPointerDown={(e) => down(e, "size")} className="absolute -right-1.5 -bottom-1.5 size-4 cursor-nwse-resize border-2 border-white bg-brand" aria-hidden />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-40">
          <p className="mb-1 text-[11px] tracking-[0.1em] text-muted uppercase">Preview</p>
          <ThumbView source={{ kind: "crop", crop: { file_id: fileId, slide, slide_id: slideId, ...win } }} alt={`${entityName} thumbnail preview`} className="aspect-[4/3] w-full border border-line" />
        </div>
        <div className="flex flex-col gap-2">
          <button type="button" className="btn-primary" onClick={save} disabled={pending}>{pending ? "Saving…" : `Use for ${entityName}`}</button>
          {onDone && <button type="button" className="btn text-xs" onClick={onDone} disabled={pending}>Cancel</button>}
        </div>
      </div>
      {msg && <p role="alert" className={`text-sm ${msg.startsWith("Saved") ? "text-muted" : "text-danger"}`}>{msg}</p>}
      <p className="text-xs text-muted">Shown live from your treatment on Google: no copy is saved. It stays on this slide (same spot and size) even when you add or move slides. Anyone who can&apos;t open the treatment in Google won&apos;t see it.</p>
    </div>
  );
}
