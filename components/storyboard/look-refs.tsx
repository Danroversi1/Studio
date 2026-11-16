"use client";
// A frame's three reference roles, kept apart: Cast (who) → Location (where) → Look & Feel
// (how it looks). Look & Feel references guide; they never stand in for a character's
// identity or a place. Showing, tracing or choosing them makes no model call, and they only
// become frame layers when she presses "Place as a layer".
import { useState } from "react";
import { setFrameLook, setSequenceLook } from "@/app/projects/[projectId]/look-actions";
import { Swatches } from "@/components/look/directions";
import { RefVisual, StatusBadge, TagChips } from "@/components/look/parts";
import { ThumbView } from "@/components/thumb-view";
import type { FilmEntity } from "@/lib/look/data";
import { resolveFrameLook, type FrameContext, type LookResolution } from "@/lib/look/resolve";
import { accessOf, type LookDirection, type LookRef } from "@/lib/look/types";
import type { ShotContent } from "@/lib/storyboard/shot";
import type { FilmItem, FrameRow, LibItem } from "./types";

type Msg = (m: { kind: "error" | "notice"; text: string } | null) => void;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Who and where this frame is about (named in its details, or placed from the library). */
export function frameContext(frame: FrameRow, entities: FilmEntity[], library: LibItem[]): FrameContext & { cast: FilmEntity[]; place: FilmEntity | null } {
  const names = new Set((frame.content.characters ?? []).map(norm));
  const placed = new Set(frame.composition.layers.map((l) => (l.libraryId ? library.find((i) => i.id === l.libraryId)?.entityId : null)).filter(Boolean) as string[]);
  const cast = entities.filter((e) => e.kind === "character" && (names.has(norm(e.name)) || placed.has(e.id)));
  const loc = frame.content.location ? norm(frame.content.location) : "";
  const place = entities.find((e) => e.kind === "location" && (loc ? norm(e.name) === loc : placed.has(e.id))) ?? null;
  return { scene: frame.content.source?.scene, entityIds: [...cast.map((c) => c.id), ...(place ? [place.id] : [])], cast, place };
}

export function lookFor(frame: FrameRow, sequenceDirection: string | null, directions: LookDirection[], refs: LookRef[], entities: FilmEntity[], library: LibItem[]): LookResolution {
  return resolveFrameLook(frame.look ?? null, sequenceDirection, directions, refs, frameContext(frame, entities, library));
}
export function resolvedRefs(res: LookResolution, refs: LookRef[]): LookRef[] {
  if (res.kind === "references") return res.refs;
  if (res.kind === "direction") return res.direction.referenceIds.map((id) => refs.find((r) => r.id === id)).filter((r): r is LookRef => !!r);
  return [];
}

function EntityThumb({ e, art }: { e: FilmEntity; art: string | null }) {
  const src = e.thumb ?? (art ? { kind: "asset" as const, assetId: art } : null);
  return src ? <ThumbView source={src} alt={e.name} className="size-full" /> : <span className="flex size-full items-center justify-center bg-panel-2 text-[10px] text-muted">no picture</span>;
}

export function RefsPanel({ projectId, sequenceId, frame, canEdit, entities, film, library, lookRefs, directions, sequenceDirection, tracing,
  onTrace, onPlace, onSaveContent, onChanged, onMessage }: {
  projectId: string; sequenceId: string; frame: FrameRow; canEdit: boolean; entities: FilmEntity[]; film: FilmItem[]; library: LibItem[];
  lookRefs: LookRef[]; directions: LookDirection[]; sequenceDirection: string | null; tracing: string | null;
  onTrace: (r: LookRef | null) => void; onPlace: (r: LookRef) => void; onSaveContent: (c: ShotContent) => void; onChanged: () => void; onMessage: Msg;
}) {
  const ctx = frameContext(frame, entities, library);
  const res = resolveFrameLook(frame.look ?? null, sequenceDirection, directions, lookRefs, ctx);
  const shown = resolvedRefs(res, lookRefs);
  const live = directions.filter((d) => d.status !== "archived");
  const def = live.find((d) => d.isDefault);
  const editable = canEdit && !frame.locked;
  const [picking, setPicking] = useState(frame.look?.mode === "references");
  const [chosenRefs, setChosenRefs] = useState<string[]>(frame.look?.reference_ids ?? []);
  const art = (id: string) => film.find((f) => f.id === id)?.assetId ?? null;
  const mode = frame.look?.mode ?? "default";

  async function setLook(look: Record<string, unknown> | null, text?: string) {
    const r = await setFrameLook({ projectId, shotId: frame.id, look });
    if (!r.ok) onMessage({ kind: "error", text: r.error }); else { if (text) onMessage({ kind: "notice", text }); onChanged(); }
  }
  async function setSeq(id: string | null) {
    const r = await setSequenceLook({ projectId, sequenceId, directionId: id });
    if (!r.ok) onMessage({ kind: "error", text: r.error }); else { onMessage({ kind: "notice", text: "This storyboard's look is saved. Nothing was redrawn." }); onChanged(); }
  }
  const toggleCast = (e: FilmEntity) => {
    const names = frame.content.characters ?? [];
    const has = names.some((n) => norm(n) === norm(e.name));
    onSaveContent({ ...frame.content, characters: has ? names.filter((n) => norm(n) !== norm(e.name)) : [...names, e.name] });
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted">Three kinds of reference, kept apart: who appears, where it happens, and how it should look.</p>

      {/* 1. Cast */}
      <section className="flex flex-col gap-2" aria-labelledby="refs-cast">
        <h3 id="refs-cast" className="font-semibold">1 · Cast <span className="text-xs font-normal text-muted">who appears</span></h3>
        {ctx.cast.length ? (
          <ul className="flex flex-wrap gap-2">
            {ctx.cast.map((e) => <li key={e.id} className="w-20 text-[11px]"><div className="aspect-[4/3] overflow-hidden border border-line"><EntityThumb e={e} art={art(e.id)} /></div><span className="block truncate">{e.name}</span></li>)}
          </ul>
        ) : <p className="text-xs text-muted">No characters named for this frame.</p>}
        {editable && entities.some((e) => e.kind === "character") && (
          <div className="flex flex-wrap gap-1" role="group" aria-label="Who's in this frame">
            {entities.filter((e) => e.kind === "character").map((e) => {
              const on = (frame.content.characters ?? []).some((n) => norm(n) === norm(e.name));
              return <button key={e.id} type="button" aria-pressed={on} onClick={() => toggleCast(e)} className={`btn min-h-7 px-2 text-[11px] ${on ? "border-brand bg-brand/10" : ""}`}>{e.name}</button>;
            })}
          </div>
        )}
      </section>

      {/* 2. Location */}
      <section className="flex flex-col gap-2 border-t border-line pt-3" aria-labelledby="refs-loc">
        <h3 id="refs-loc" className="font-semibold">2 · Location <span className="text-xs font-normal text-muted">where it happens</span></h3>
        {ctx.place ? (
          <div className="flex items-center gap-2 text-[11px]"><div className="aspect-[4/3] w-20 overflow-hidden border border-line"><EntityThumb e={ctx.place} art={art(ctx.place.id)} /></div><span>{ctx.place.name}</span></div>
        ) : <p className="text-xs text-muted">{frame.content.location ? `“${frame.content.location}” isn't a location in the film yet.` : "No location chosen for this frame."}</p>}
        {editable && entities.some((e) => e.kind === "location") && (
          <select className="field py-1.5 text-sm" value={ctx.place?.id ?? ""} aria-label="Where this frame happens"
            onChange={(ev) => onSaveContent({ ...frame.content, location: entities.find((e) => e.id === ev.target.value)?.name || undefined })}>
            <option value="">— choose a location —</option>
            {entities.filter((e) => e.kind === "location").map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        )}
      </section>

      {/* 3. Look & Feel */}
      <section className="flex flex-col gap-2 border-t border-line pt-3" aria-labelledby="refs-look">
        <h3 id="refs-look" className="font-semibold">3 · Look &amp; Feel <span className="text-xs font-normal text-muted">how it should look</span></h3>
        {lookRefs.length === 0 && live.length === 0 ? (
          <p className="text-xs text-muted">No Look &amp; Feel yet. Collect references on the Treatment desk.</p>
        ) : (<>
          <label className="flex flex-col gap-1 text-xs"><span className="label">This storyboard follows</span>
            <select className="field py-1.5 text-sm" value={sequenceDirection ?? ""} disabled={!canEdit} onChange={(e) => setSeq(e.target.value || null)}>
              <option value="">{def ? `The film's default (${def.name})` : "The film's default (none yet)"}</option>
              {live.map((d) => <option key={d.id} value={d.id}>{d.name}{d.status === "draft" ? " (draft)" : ""}</option>)}
            </select></label>

          <fieldset className="flex flex-col gap-1 text-sm" disabled={!editable}>
            <legend className="label mb-1">This frame</legend>
            <label className="flex items-center gap-1.5"><input type="radio" checked={mode === "default" && !picking} onChange={() => { setPicking(false); void setLook(null); }} /> Follow the storyboard</label>
            <label className="flex items-center gap-1.5"><input type="radio" checked={mode === "direction" && !picking} onChange={() => { setPicking(false); const d = live[0]; if (d) void setLook({ mode: "direction", direction_id: d.id }); }} disabled={!live.length} /> Its own direction</label>
            {mode === "direction" && !picking && (
              <select className="field ml-5 py-1.5 text-sm" value={frame.look?.direction_id ?? ""} onChange={(e) => setLook({ mode: "direction", direction_id: e.target.value })} aria-label="Direction for this frame">
                {live.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
            <label className="flex items-center gap-1.5"><input type="radio" checked={picking || mode === "references"} onChange={() => { setPicking(true); setChosenRefs(frame.look?.reference_ids ?? []); }} disabled={!lookRefs.length} /> Pick references</label>
            {(picking || mode === "references") && editable && (
              <div className="ml-5 flex flex-col gap-1">
                <div className="flex flex-wrap gap-1">
                  {lookRefs.map((r) => {
                    const on = chosenRefs.includes(r.id);
                    return <button key={r.id} type="button" aria-pressed={on} onClick={() => setChosenRefs(on ? chosenRefs.filter((x) => x !== r.id) : [...chosenRefs, r.id])}
                      className={`flex items-center gap-1 border p-0.5 pr-1.5 text-[11px] ${on ? "border-brand bg-brand/10" : "border-line"}`}><span className="size-7 overflow-hidden"><RefVisual r={r} /></span>{r.title.slice(0, 18)}</button>;
                  })}
                </div>
                <button type="button" className="btn self-start min-h-8 px-2 text-xs" disabled={!chosenRefs.length}
                  onClick={() => { void setLook({ mode: "references", reference_ids: chosenRefs }, "References chosen for this frame."); }}>Use these {chosenRefs.length || ""}</button>
              </div>
            )}
          </fieldset>

          <ResolutionNote res={res} editable={editable} onPick={(d) => setLook({ mode: "direction", direction_id: d.id }, `“${d.name}” chosen for this frame.`)} />
          {res.kind === "direction" && <Swatches colors={res.direction.palette} />}

          {shown.length > 0 && (
            <ul className="flex flex-col gap-2">
              {shown.map((r) => (
                <li key={r.id} className="flex gap-2 border border-line p-1.5 text-xs">
                  <div className="size-16 shrink-0 overflow-hidden"><RefVisual r={r} /></div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-center justify-between gap-1"><b className="truncate">{r.title}</b><StatusBadge status={r.status} /></span>
                    <TagChips tags={r.tags} />
                    {r.useFor && <span><span className="text-muted">Use for:</span> {r.useFor}</span>}
                    {r.leaveOut && <span><span className="text-muted">Leave out:</span> {r.leaveOut}</span>}
                    {!r.useFor && !r.leaveOut && r.reason && <span className="line-clamp-2">“{r.reason}”</span>}
                    <span className="flex flex-wrap gap-1">
                      {accessOf(r) !== "link" && accessOf(r) !== "missing" && (
                        <button type="button" aria-pressed={tracing === r.id} className={`btn min-h-7 px-2 text-[11px] ${tracing === r.id ? "border-brand bg-brand/10" : ""}`} onClick={() => onTrace(tracing === r.id ? null : r)}>
                          {tracing === r.id ? "Hide tracing guide" : "Trace over it"}</button>
                      )}
                      {editable && accessOf(r) === "image" && <button type="button" className="btn min-h-7 px-2 text-[11px]" onClick={() => onPlace(r)}>Place as a layer</button>}
                      {accessOf(r) === "link" && r.sourceUrl && <a className="btn min-h-7 px-2 text-[11px]" href={r.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">Open link ↗</a>}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-muted">Look &amp; Feel guides color, light, texture and style. It doesn&apos;t change who a character is or where the scene is. Tracing guides aren&apos;t exported; a reference becomes part of the frame only with “Place as a layer”.</p>
        </>)}
      </section>
    </div>
  );
}

function ResolutionNote({ res, editable, onPick }: { res: LookResolution; editable: boolean; onPick: (d: LookDirection) => void }) {
  if (res.kind === "conflict") return (
    <div role="alert" className="flex flex-col gap-1 border-l-2 border-brand pl-2 text-xs">
      <span>{res.why}. Which one should this frame use?</span>
      <span className="flex flex-wrap gap-1">{res.options.map((d) => <button key={d.id} type="button" className="btn min-h-7 px-2 text-[11px]" disabled={!editable} onClick={() => onPick(d)}>{d.name}</button>)}</span>
    </div>
  );
  if (res.kind === "none") return <p className="text-xs text-muted">{res.why}. Pick a direction or references above, or set a default on the Treatment desk.</p>;
  if (res.kind === "references") return <p className="text-xs">Using <b>{res.refs.length}</b> chosen reference{res.refs.length === 1 ? "" : "s"}.</p>;
  return (
    <p className="text-xs">Using <b>{res.direction.name}</b> <span className="text-muted">({res.why.toLowerCase()}, version {res.direction.version})</span>
      {res.outdated && editable && <> · this frame was set on an earlier version. <button type="button" className="underline" onClick={() => onPick(res.direction)}>Use the latest</button></>}
    </p>
  );
}
