"use client";
// References: what a board is composed from. Cast and locations stay linked to their records
// (through a shared library item), Look & Feel references to theirs, uploads keep their
// original resolution. The starter shapes and the full library are a secondary tool below.
import { useRef, useState } from "react";
import type { LookRef } from "@/lib/look/types";
import { accessOf } from "@/lib/look/types";
import { RefVisual } from "@/components/look/parts";
import type { FilmItem, LibItem } from "./types";

export function DeskReferences({ film, library, lookRefs, editable, canEdit, busy, onPlaceFilm, onPlaceLibrary, onPlaceLook, onGuide, guiding, onUpload, secondary }: {
  film: FilmItem[]; library: LibItem[]; lookRefs: LookRef[]; editable: boolean; canEdit: boolean; busy: string | null;
  onPlaceFilm: (f: FilmItem) => void; onPlaceLibrary: (it: LibItem) => void; onPlaceLook: (r: LookRef) => void;
  onGuide: (r: LookRef | null) => void; guiding: string | null; onUpload: (files: File[]) => void;
  /** The starter shapes and full asset library (optional, collapsed). */
  secondary: React.ReactNode;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const match = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());
  const cast = film.filter((f) => f.kind === "character" && match(f.name)), places = film.filter((f) => f.kind === "location" && match(f.name));
  const filmIds = new Set(film.map((f) => f.id));
  const others = library.filter((i) => i.usage === "composition" && i.assetId && !(i.entityId && filmIds.has(i.entityId)) && match(i.name));
  const looks = lookRefs.filter((r) => match(r.title));

  const pic = (assetId: string | null | undefined, alt: string) => assetId
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={`/api/assets/${assetId}`} alt={alt} loading="lazy" className="size-full object-cover" />
    : <span className="p-1 text-center text-[10px] text-muted">No picture</span>;
  const tile = (key: string, name: string, art: React.ReactNode, action: React.ReactNode, note?: string) => (
    <li key={key} className="flex flex-col border border-line bg-panel-2">
      <div className="flex aspect-square items-center justify-center overflow-hidden">{art}</div>
      <div className="flex flex-col gap-0.5 p-1 text-[11px]"><b className="truncate">{name}</b>{note && <span className="text-[10px] text-muted">{note}</span>}{action}</div>
    </li>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1">
        {canEdit && (
          <>
            <button type="button" className="btn-primary min-h-9 flex-1 px-2 text-xs" disabled={!editable || !!busy} onClick={() => file.current?.click()}>{busy === "upload" ? "Uploading…" : "Upload pictures"}</button>
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; if (f.length) onUpload(f); }} />
          </>
        )}
        <input className="field w-24 py-1 text-xs" placeholder="Find…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a reference" />
      </div>
      <p className="text-xs text-muted">Placed references keep their original pictures and stay linked to the character, place or Look &amp; Feel card they came from.</p>

      <Section title="Cast" count={cast.length}>
        {cast.map((f) => tile(f.id, f.name, f.assetId ? pic(f.assetId, f.name) : <span className="p-1 text-center text-[10px] text-muted">{f.thumb ? "Picture from the treatment" : "No picture yet"}</span>,
          <button type="button" className="btn mt-0.5 min-h-7 px-1.5 text-[11px]" disabled={!editable || !!busy || (!f.assetId && !f.thumb)} onClick={() => onPlaceFilm(f)}>{busy === f.id ? "Adding…" : "Place"}</button>))}
      </Section>
      <Section title="Locations" count={places.length}>
        {places.map((f) => tile(f.id, f.name, f.assetId ? pic(f.assetId, f.name) : <span className="p-1 text-center text-[10px] text-muted">{f.thumb ? "Picture from the treatment" : "No picture yet"}</span>,
          <button type="button" className="btn mt-0.5 min-h-7 px-1.5 text-[11px]" disabled={!editable || !!busy || (!f.assetId && !f.thumb)} onClick={() => onPlaceFilm(f)}>{busy === f.id ? "Adding…" : "Place"}</button>))}
      </Section>
      <Section title="Look & Feel" count={looks.length}>
        {looks.map((r) => {
          const a = accessOf(r);
          return tile(r.id, r.title, <RefVisual r={r} className="size-full object-cover" />,
            <span className="mt-0.5 flex flex-wrap gap-1">
              {r.assetId ? <button type="button" className="btn min-h-7 px-1.5 text-[11px]" disabled={!editable} onClick={() => onPlaceLook(r)}>Place</button> : null}
              {a !== "missing" && <button type="button" aria-pressed={guiding === r.id} className={`btn min-h-7 px-1.5 text-[11px] ${guiding === r.id ? "btn-primary" : ""}`} onClick={() => onGuide(guiding === r.id ? null : r)}>Guide</button>}
            </span>,
            a === "link" ? "A link: download it, then Upload to trace it" : a === "treatment" ? "From the treatment slides" : undefined);
        })}
      </Section>
      <Section title="Library" count={others.length}>
        {others.map((it) => tile(it.id, it.name, pic(it.assetId, it.name),
          <button type="button" className="btn mt-0.5 min-h-7 px-1.5 text-[11px]" disabled={!editable} onClick={() => onPlaceLibrary(it)}>Place</button>))}
      </Section>

      <details className="border-t border-line pt-2">
        <summary className="cursor-pointer text-sm font-semibold">Starter shapes &amp; full library</summary>
        <div className="mt-2">{secondary}</div>
      </details>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <p className="label">{title} <span className="text-muted">· {count}</span></p>
      {count ? <ul className="grid grid-cols-3 gap-1">{children}</ul> : <p className="text-xs text-muted">None yet.</p>}
    </section>
  );
}
