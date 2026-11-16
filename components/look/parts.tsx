"use client";
// Small shared pieces for Look & Feel (Treatment desk and Storyboard desk). No model calls.
import { useState } from "react";
import { ThumbView } from "@/components/thumb-view";
import { inkOn } from "@/lib/look/palette";
import { accessOf, tagLabel, type Applies, type LookRef, type PaletteColor } from "@/lib/look/types";
import type { FilmEntity } from "@/lib/look/data";

/** A reference's picture: the browsing copy (or the original), a live treatment crop, or a
 *  clearly-labeled link / missing state. */
export function RefVisual({ r, large = false, className = "" }: { r: LookRef; large?: boolean; className?: string }) {
  const [broken, setBroken] = useState(false);
  const a = accessOf(r);
  if (a === "image" && !broken) {
    const src = `/api/assets/${large || !r.thumbAssetId ? r.assetId : r.thumbAssetId}`;
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={r.title} loading="lazy" draggable={false} onError={() => setBroken(true)}
      className={`${large ? "max-h-[60vh] w-full object-contain" : "size-full object-cover"} bg-panel-2 ${className}`} />;
  }
  if (a === "treatment") return <ThumbView source={{ kind: "crop", crop: r.crop! }} alt={r.title} className={`${large ? "aspect-[4/3] w-full" : "size-full"} ${className}`} />;
  return (
    <div className={`flex size-full flex-col items-center justify-center gap-1 bg-panel-2 p-2 text-center text-xs text-muted ${large ? "aspect-[4/3]" : ""} ${className}`}>
      {a === "link" ? (<><span className="text-[10px] font-semibold tracking-[0.12em] uppercase">Link only</span><span className="line-clamp-2 break-all">{hostOf(r.sourceUrl)}</span><span>No image added yet</span></>)
        : (<><span className="text-[10px] font-semibold tracking-[0.12em] uppercase">Image missing</span><span>{broken ? "It didn't load." : "It was removed."} Your notes are kept.</span></>)}
    </div>
  );
}
export const hostOf = (u: string | null) => { try { return u ? new URL(u).hostname.replace(/^www\./, "") : ""; } catch { return u ?? ""; } };

export function TagChips({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <ul className="flex flex-wrap gap-1" aria-label="What it's for">
      {tags.map((t) => <li key={t} className="border border-line px-1.5 py-0.5 text-[10px] tracking-[0.06em] uppercase">{tagLabel(t).replace(/^The /, "")}</li>)}
    </ul>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const approved = status === "approved";
  return <span className={`border px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.1em] uppercase ${approved ? "border-brand bg-brand text-white" : "border-line text-muted"}`}>
    {approved ? "Approved" : status === "archived" ? "Archived" : status === "draft" ? "Draft" : "Proposed"}</span>;
}

export function scopeLabel(a: Applies, entities: FilmEntity[]): string {
  if (a.film) return "Whole film";
  const names = (a.entities ?? []).map((id) => entities.find((e) => e.id === id)?.name).filter(Boolean);
  const scenes = (a.scenes ?? []).map((n) => `scene ${n}`);
  return [...names, ...scenes].join(", ") || "Whole film";
}

/** Whole film, or chosen scenes, characters and locations. */
export function AppliesPicker({ value, onChange, entities, scenes, disabled }: {
  value: Applies; onChange: (a: Applies) => void; entities: FilmEntity[]; scenes: { number: number; heading: string }[]; disabled?: boolean;
}) {
  const whole = !!value.film;
  const ents = value.entities ?? [], sc = value.scenes ?? [];
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const set = (e: string[], s: number[]) => onChange(e.length || s.length ? { entities: e, scenes: s } : { film: true });
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="label mb-1">Applies to</legend>
      <div className="flex flex-wrap gap-3 text-sm">
        <label className="flex items-center gap-1.5"><input type="radio" checked={whole} onChange={() => onChange({ film: true })} /> The whole film</label>
        <label className="flex items-center gap-1.5"><input type="radio" checked={!whole} onChange={() => onChange({ entities: [], scenes: [] })} /> Only some parts</label>
      </div>
      {!whole && (
        <div className="flex flex-col gap-2 border-l-2 border-line pl-3">
          {(["character", "location"] as const).map((k) => {
            const list = entities.filter((e) => e.kind === k);
            if (!list.length) return null;
            return (
              <div key={k} className="flex flex-wrap gap-1" role="group" aria-label={k === "character" ? "Characters" : "Locations"}>
                <span className="w-full text-xs text-muted">{k === "character" ? "Characters" : "Locations"}</span>
                {list.map((e) => (
                  <button key={e.id} type="button" aria-pressed={ents.includes(e.id)} onClick={() => set(toggle(ents, e.id), sc)}
                    className={`btn min-h-8 px-2 text-xs ${ents.includes(e.id) ? "border-brand bg-brand/10" : ""}`}>{e.name}</button>
                ))}
              </div>
            );
          })}
          {scenes.length > 0 && (
            <div className="flex flex-wrap gap-1" role="group" aria-label="Scenes">
              <span className="w-full text-xs text-muted">Scenes</span>
              {scenes.map((s) => (
                <button key={s.number} type="button" aria-pressed={sc.includes(s.number)} onClick={() => set(ents, toggle(sc, s.number))} title={s.heading}
                  className={`btn min-h-8 px-2 text-xs ${sc.includes(s.number) ? "border-brand bg-brand/10" : ""}`}>{s.number}. {s.heading.slice(0, 28)}</button>
              ))}
            </div>
          )}
        </div>
      )}
    </fieldset>
  );
}

/** Edit a palette: add by hand, change, remove, reorder. Suggested colors are labeled. */
export function PaletteEditor({ colors, onChange, disabled, extra }: { colors: PaletteColor[]; onChange: (c: PaletteColor[]) => void; disabled?: boolean; extra?: React.ReactNode }) {
  const [pick, setPick] = useState("#7a8b6f");
  const move = (i: number, d: number) => { const n = [...colors]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; onChange(n); };
  return (
    <div className="flex flex-col gap-2">
      {colors.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Palette">
          {colors.map((c, i) => (
            <li key={`${c.hex}-${i}`} className="flex flex-col items-stretch border border-line text-[10px]">
              <label className="relative block h-12 w-16 cursor-pointer" style={{ background: c.hex, color: inkOn(c.hex) }} title="Change this color">
                <span className="absolute bottom-0.5 left-1 font-mono">{c.hex}</span>
                {c.source !== "manual" && <span className="absolute top-0.5 left-1 uppercase">{c.source === "suggested" ? "suggested" : "sampled"}</span>}
                <input type="color" className="sr-only" value={c.hex} disabled={disabled} aria-label={`Change color ${i + 1}`}
                  onChange={(e) => onChange(colors.map((x, j) => (j === i ? { hex: e.target.value, source: "manual" } : x)))} />
              </label>
              {!disabled && (
                <span className="flex justify-between">
                  <button type="button" className="px-1" onClick={() => move(i, -1)} aria-label={`Move color ${i + 1} earlier`} disabled={i === 0}>←</button>
                  <button type="button" className="px-1 text-danger" onClick={() => onChange(colors.filter((_, j) => j !== i))} aria-label={`Remove color ${c.hex}`}>×</button>
                  <button type="button" className="px-1" onClick={() => move(i, 1)} aria-label={`Move color ${i + 1} later`} disabled={i === colors.length - 1}>→</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-muted">No colors yet.</p>}
      {!disabled && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <input type="color" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Color to add" className="h-8 w-10 cursor-pointer border border-line" />
          <button type="button" className="btn min-h-8 px-2 text-xs" disabled={colors.length >= 24} onClick={() => onChange([...colors, { hex: pick, source: "manual" }])}>+ Add color</button>
          {extra}
        </div>
      )}
      {colors.some((c) => c.source === "suggested") && <p className="text-[11px] text-muted">Suggested colors come from the picture&apos;s pixels. They&apos;re a starting point, not the film&apos;s whole palette.</p>}
    </div>
  );
}
