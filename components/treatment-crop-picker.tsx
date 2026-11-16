"use client";
// Choose a thumbnail as a crop of the treatment: pick a slide, drag the window over the
// part you want, resize it with the corner, save. Shown live from Google; nothing is copied.
// The crop is pinned to the slide's permanent Google ID plus its position and size on the
// slide, so it stays put when slides are added, removed or reordered.
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { saveTreatmentSlides, setThumbnailCrop } from "@/app/projects/[projectId]/thumb-actions";
import { SlidesApiOffError, googleConfig, treatmentSlides } from "@/lib/google/client";
import { slidesFor, type SlideInfo } from "@/lib/slide-match";
import { SLIDE_ASPECT, slideEmbedUrl, windowOf, type ThumbCrop } from "@/lib/thumb";
import { ThumbView } from "./thumb-view";

export function TreatmentCropPicker({ projectId, entityId, entityName, entityKind, fileId, initial, slides, onDone }: {
  projectId: string; entityId: string; entityName: string; entityKind: "character" | "location"; fileId: string;
  initial: ThumbCrop | null;
  /** The treatment's slide list as last read (IDs and text), if any. */
  slides: SlideInfo[] | null;
  onDone?: () => void;
}) {
  const router = useRouter();
  const same = initial?.file_id === fileId;
  const [deck, setDeck] = useState<SlideInfo[] | null>(slides?.length ? slides : null);
  const ids = deck?.map((d) => d.id) ?? null;
  const [matches, setMatches] = useState<number[]>(() => (slides?.length ? slidesFor(slides, entityName, entityKind) : []));
  // Start on the crop she chose, else on the slide labeled for this character or location.
  const startAt = same ? null : matches[0] ?? null;
  const [slide, setSlide] = useState(same ? (slides?.findIndex((d) => d.id === initial.slide_id) ?? -1) + 1 || initial.slide : startAt ?? 1);
  const [slideId, setSlideId] = useState<string | null>(same ? initial.slide_id ?? null : startAt ? slides?.[startAt - 1]?.id ?? null : null);
  const [reading, setReading] = useState(false);
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

  /** Read the treatment's slides from Google (IDs and text) and keep the list. */
  async function readDeck(): Promise<SlideInfo[]> {
    const cfg = googleConfig();
    if (!cfg) throw new Error("Google isn't set up for STUDIO yet.");
    const list = await treatmentSlides(cfg, fileId);
    setDeck(list);
    setMatches(slidesFor(list, entityName, entityKind));
    void saveTreatmentSlides({ projectId, fileId, slides: list }).catch(() => {});
    return list;
  }

  async function findMine() {
    setMsg(null); setReading(true);
    try {
      const list = await readDeck();
      const m = slidesFor(list, entityName, entityKind);
      if (m.length) { setSlide(m[0]); setSlideId(list[m[0] - 1].id); }
      else setMsg(`Saved the slide list, but no slide is labeled for ${entityName} (e.g. "${entityKind === "character" ? "Casting" : "Location"}/${entityName}"). Use the arrows to choose one.`);
    } catch (e) {
      setMsg(e instanceof SlidesApiOffError
        ? "STUDIO can't read slide labels yet: the Google Slides API needs to be switched on for STUDIO. Use the arrows for now."
        : e instanceof Error ? e.message : "Google didn't open the treatment. Try again.");
    } finally { setReading(false); }
  }

  /** The slide's permanent ID (asks Google once; she may be asked to pick the treatment). */
  async function pin(): Promise<{ n: number; id: string | null; note?: string }> {
    if (!googleConfig() && !ids) return { n: slide, id: slideId };
    try {
      const list = ids ?? (await readDeck()).map((d) => d.id);
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
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {matches.length > 0 ? (
          <>
            <span className="text-muted">{entityName}&apos;s {matches.length === 1 ? "slide" : "slides"}:</span>
            {matches.slice(0, 8).map((n) => (
              <button key={n} type="button" onClick={() => go(n)} aria-pressed={n === slide}
                className={`btn min-h-8 px-2 text-xs ${n === slide ? "border-brand" : ""}`}
                title={deck?.[n - 1]?.text.split("\n")[0] ?? ""}>
                {n}{deck?.[n - 1] ? ` · ${deck[n - 1].text.split("\n")[0].slice(0, 28)}` : ""}
              </button>
            ))}
          </>
        ) : deck ? (
          <span className="text-muted">No slide is labeled for {entityName} yet (e.g. &quot;{entityKind === "character" ? "Casting" : "Location"}/{entityName}&quot;).</span>
        ) : null}
        <button type="button" className="text-accent underline disabled:opacity-50" onClick={findMine} disabled={reading || pending}>
          {reading ? "Reading the treatment…" : deck ? "Re-read slides" : `Find ${entityName}'s slide in the treatment`}
        </button>
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
