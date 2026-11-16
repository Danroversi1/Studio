"use client";
// Side panels for Compose. All local editing: no model calls.
import { useEffect, useRef, useState } from "react";
import {
  archiveLens, archiveLibraryItem, libraryUsage, replaceLibrarySource, restoreVersion, saveLens, saveLibraryItem,
} from "@/app/projects/[projectId]/storyboard-actions";
import { FORMATS, depthOfField, distanceForFraming, fieldOfView, formatOf, round } from "@/lib/storyboard/camera";
import {
  FRAME_W, frameH, group, reorder, removeLayers, ungroup, update, withGroup, DEFAULT_LOOK,
  type Composition, type Layer, type Look,
} from "@/lib/storyboard/compose";
import { lensFromLink } from "@/lib/storyboard/lens-link";
import { LOOK_PRESETS } from "@/lib/storyboard/look";
import { SHAPES, type BuiltinShape } from "@/lib/storyboard/shapes";
import { ANGLES, SIZES, labelOf, type ShotContent } from "@/lib/storyboard/shot";
import { imageSize, uploadImage } from "@/lib/storyboard/upload";
import { KIND_LABELS, LENS_ADDICTION_URL, PURPOSES, type FilmItem, type FrameRow, type LensPick, type LibItem, type StockRef } from "./types";

type Edit = (f: (c: Composition) => Composition) => void;
type Msg = (m: { kind: "error" | "notice"; text: string } | null) => void;

function ShapeIcon({ s }: { s: BuiltinShape }) {
  const w = s.ratio >= 1 ? 40 : 40 * s.ratio, h = s.ratio >= 1 ? 40 / s.ratio : 40;
  return <svg viewBox="0 0 100 100" preserveAspectRatio="none" width={w} height={h} aria-hidden><path d={s.path} fill={s.fill && !/00$/.test(s.fill) ? s.fill : "#3a3a3a"} fillRule="evenodd" stroke={s.id === "frame-box" ? "#3a3a3a" : undefined} /></svg>;
}

// ---- Assets ------------------------------------------------------------------------------
export function AssetsPanel({ projectId, entityId, library, film, editable, canEdit, onPlaceShape, onPlaceItem, onChanged, onMessage, onDrawingToLibrary }: {
  projectId: string; entityId: string; library: LibItem[]; film: FilmItem[]; editable: boolean; canEdit: boolean; comp: Composition;
  onPlaceShape: (s: BuiltinShape) => void; onPlaceItem: (it: LibItem) => void; onChanged: () => void; onMessage: Msg; onDrawingToLibrary?: () => void;
}) {
  const [filter, setFilter] = useState<LibItem["kind"] | "all">("all");
  const [adding, setAdding] = useState<null | "upload" | "link" | "film">(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const items = library.filter((i) => filter === "all" || i.kind === filter);
  const groups = ["Figures", "Set", "Props", "Shapes", "Marks"] as const;

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">Starter shapes</h3>
        <p className="help">Simple silhouettes and set pieces to block a frame right away. Place, then move, scale, rotate or flip.</p>
        {groups.map((g) => (
          <div key={g} className="flex flex-col gap-1">
            <p className="label">{g}</p>
            <ul className="grid grid-cols-4 gap-1">
              {SHAPES.filter((s) => s.group === g).map((s) => (
                <li key={s.id}>
                  <button type="button" disabled={!editable} onClick={() => onPlaceShape(s)} title={`Place ${s.name}`}
                    className="flex h-16 w-full flex-col items-center justify-center gap-0.5 border border-line bg-panel-2 hover:border-text disabled:opacity-40">
                    <ShapeIcon s={s} /><span className="w-full truncate px-0.5 text-center text-[9px] text-muted">{s.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-2 border-t border-line pt-3">
        <div className="flex items-baseline justify-between"><h3 className="font-semibold">Your asset library</h3><span className="text-xs text-muted">{library.length} items · shared by every storyboard</span></div>
        <div className="flex flex-wrap gap-1">
          {(["all", ...Object.keys(KIND_LABELS)] as const).map((k) => (
            <button key={k} type="button" onClick={() => setFilter(k as never)} aria-pressed={filter === k}
              className={`badge border ${filter === k ? "border-text bg-text text-panel-2" : "border-line text-muted"}`}>{k === "all" ? "All" : KIND_LABELS[k as LibItem["kind"]]}</button>
          ))}
        </div>
        {items.length ? (
          <ul className="grid grid-cols-2 gap-2">
            {items.map((it) => (
              <li key={it.id} className="flex flex-col border border-line bg-panel-2">
                <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-[repeating-conic-gradient(#ddd_0%_25%,#fff_0%_50%)] bg-[length:16px_16px]">
                  {it.assetId
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={`/api/assets/${it.assetId}`} alt="" className="max-h-full max-w-full object-contain" loading="lazy" />
                    : <span className="p-2 text-center text-xs text-muted">{it.sourceUrl ? "Link only (not imported)" : "No image"}</span>}
                </div>
                <div className="flex flex-col gap-0.5 p-1.5 text-xs">
                  <b className="truncate">{it.name}</b>
                  <span className="text-muted">{KIND_LABELS[it.kind].replace(/s$/, "")}{it.views ? ` · ${it.views}` : ""}</span>
                  {it.usage === "reference_only" && <span className="text-[10px] uppercase tracking-[0.08em] text-muted">Reference only</span>}
                  {it.origin === "generated" && <span className="text-[10px] uppercase tracking-[0.08em] text-muted">Made with AI</span>}
                  <span className="mt-1 flex flex-wrap gap-1">
                    {it.usage === "composition" && it.assetId && <button type="button" className="btn min-h-8 px-2 text-[11px]" disabled={!editable} onClick={() => onPlaceItem(it)}>Place</button>}
                    {canEdit && <button type="button" className="btn min-h-8 px-2 text-[11px]" onClick={() => setEditing(editing === it.id ? null : it.id)}>Edit</button>}
                  </span>
                </div>
                {editing === it.id && <LibraryEditor projectId={projectId} entityId={entityId} item={it} onDone={() => { setEditing(null); onChanged(); }} onMessage={onMessage} />}
              </li>
            ))}
          </ul>
        ) : <p className="help">Nothing here yet.</p>}
        {onDrawingToLibrary && <button type="button" className="btn self-start text-xs" onClick={onDrawingToLibrary}>Save the selected drawing to the library</button>}
      </section>

      {canEdit && (
        <section className="flex flex-col gap-2 border-t border-line pt-3">
          <h3 className="font-semibold">Add to the library</h3>
          <div className="flex flex-wrap gap-1">
            <button type="button" className={`btn min-h-9 px-2 text-xs ${adding === "upload" ? "btn-primary" : ""}`} onClick={() => setAdding(adding === "upload" ? null : "upload")}>Upload images</button>
            <button type="button" className={`btn min-h-9 px-2 text-xs ${adding === "film" ? "btn-primary" : ""}`} onClick={() => setAdding(adding === "film" ? null : "film")}>From your film</button>
            <button type="button" className={`btn min-h-9 px-2 text-xs ${adding === "link" ? "btn-primary" : ""}`} onClick={() => setAdding(adding === "link" ? null : "link")}>A link</button>
          </div>
          {adding === "upload" && <UploadForm projectId={projectId} entityId={entityId} busy={busy} setBusy={setBusy} onDone={() => { setAdding(null); onChanged(); }} onMessage={onMessage} />}
          {adding === "link" && <LinkForm projectId={projectId} onDone={() => { setAdding(null); onChanged(); }} onMessage={onMessage} />}
          {adding === "film" && <FilmForm projectId={projectId} film={film} onDone={() => { setAdding(null); onChanged(); }} onMessage={onMessage} />}
        </section>
      )}
    </div>
  );
}

function Fields({ v, set, image }: { v: Record<string, string>; set: (k: string, x: string) => void; image: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="flex flex-col gap-1 text-xs"><span className="label">What is it?</span>
        <select className="field py-1.5 text-sm" value={v.kind} onChange={(e) => set("kind", e.target.value)}>
          {Object.entries(KIND_LABELS).map(([k, l]) => <option key={k} value={k}>{l.replace(/s$/, "")}</option>)}
        </select></label>
      <label className="flex flex-col gap-1 text-xs"><span className="label">Name</span><input className="field py-1.5 text-sm" value={v.name} onChange={(e) => set("name", e.target.value)} maxLength={120} /></label>
      {image && <label className="col-span-2 flex flex-col gap-1 text-xs"><span className="label">Which view or pose does it show?</span>
        <input className="field py-1.5 text-sm" value={v.views} onChange={(e) => set("views", e.target.value)} placeholder="e.g. front, standing; side view only" maxLength={300} /></label>}
      <label className="flex flex-col gap-1 text-xs"><span className="label">Purpose</span>
        <select className="field py-1.5 text-sm" value={v.purpose} onChange={(e) => set("purpose", e.target.value)}>
          <option value="">—</option>{PURPOSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select></label>
      {image && <label className="flex flex-col gap-1 text-xs"><span className="label">Can it go in frames?</span>
        <select className="field py-1.5 text-sm" value={v.usage} onChange={(e) => set("usage", e.target.value)}>
          <option value="composition">Yes, use in frames</option><option value="reference_only">Reference only</option>
        </select></label>}
      <label className="col-span-2 flex flex-col gap-1 text-xs"><span className="label">What do you like about this?</span>
        <input className="field py-1.5 text-sm" value={v.note} onChange={(e) => set("note", e.target.value)} maxLength={600} /></label>
      <label className="flex flex-col gap-1 text-xs"><span className="label">Credit (if known)</span><input className="field py-1.5 text-sm" value={v.attribution} onChange={(e) => set("attribution", e.target.value)} maxLength={300} /></label>
      <label className="flex flex-col gap-1 text-xs"><span className="label">Permission</span><input className="field py-1.5 text-sm" value={v.permission} onChange={(e) => set("permission", e.target.value)} placeholder="e.g. my own drawing" maxLength={300} /></label>
    </div>
  );
}

function UploadForm({ projectId, entityId, busy, setBusy, onDone, onMessage }: { projectId: string; entityId: string; busy: boolean; setBusy: (b: boolean) => void; onDone: () => void; onMessage: Msg }) {
  const [v, setV] = useState<Record<string, string>>({ kind: "character", name: "", views: "", purpose: "", usage: "composition", note: "", attribution: "", permission: "My own work" });
  const file = useRef<HTMLInputElement>(null);
  const set = (k: string, x: string) => setV((o) => ({ ...o, [k]: x }));
  async function go() {
    const files = Array.from(file.current?.files ?? []).slice(0, 12);
    if (!files.length) { onMessage({ kind: "error", text: "Choose one or more PNG or JPEG images." }); return; }
    setBusy(true);
    try {
      for (const f of files) {
        await imageSize(f);
        const assetId = await uploadImage(entityId, f, f.name);
        const r = await saveLibraryItem({ projectId, itemId: null, data: { ...v, name: files.length > 1 || !v.name ? f.name.replace(/\.[a-z]+$/i, "") : v.name, asset_id: assetId, origin: "upload" } });
        if (!r.ok) throw new Error(r.error);
      }
      onMessage({ kind: "notice", text: `Added ${files.length} to your library. PNGs keep their transparency.` });
      onDone();
    } catch (e) { onMessage({ kind: "error", text: e instanceof Error ? e.message : "Upload failed." }); }
    finally { setBusy(false); }
  }
  return (
    <div className="flex flex-col gap-2 border border-line p-2">
      <input ref={file} type="file" accept="image/png,image/jpeg" multiple aria-label="Images to upload" />
      <Fields v={v} set={set} image />
      <p className="text-xs text-muted">Saved to Studio&apos;s cloud storage. To cut out a person, upload a PNG with a transparent background, or crop it in Layers.</p>
      <button type="button" className="btn-primary self-start" onClick={go} disabled={busy}>{busy ? "Uploading…" : "Add to library"}</button>
    </div>
  );
}

function LinkForm({ projectId, onDone, onMessage }: { projectId: string; onDone: () => void; onMessage: Msg }) {
  const [url, setUrl] = useState("");
  const [v, setV] = useState<Record<string, string>>({ kind: "reference", name: "", views: "", purpose: "atmosphere", usage: "reference_only", note: "", attribution: "", permission: "" });
  const set = (k: string, x: string) => setV((o) => ({ ...o, [k]: x }));
  async function go() {
    if (!/^https:\/\//.test(url)) { onMessage({ kind: "error", text: "Paste a link that starts with https://" }); return; }
    const r = await saveLibraryItem({ projectId, itemId: null, data: { ...v, kind: "reference", name: v.name || url.replace(/^https:\/\/(www\.)?/, "").slice(0, 80), source_url: url } });
    if (!r.ok) onMessage({ kind: "error", text: r.error }); else { onMessage({ kind: "notice", text: "Link saved as a reference." }); onDone(); }
  }
  return (
    <div className="flex flex-col gap-2 border border-line p-2">
      <input className="field" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… (e.g. a Pinterest pin)" aria-label="Link" />
      <Fields v={v} set={set} image={false} />
      <p className="text-xs text-muted">A link is saved as a link: Studio doesn&apos;t download it or look inside it, and boards aren&apos;t imported. To use a picture in a frame, save it and upload it (if you&apos;re allowed to).</p>
      <button type="button" className="btn-primary self-start" onClick={go}>Save link</button>
    </div>
  );
}

function FilmForm({ projectId, film, onDone, onMessage }: { projectId: string; film: FilmItem[]; onDone: () => void; onMessage: Msg }) {
  async function add(f: FilmItem) {
    const r = await saveLibraryItem({ projectId, itemId: null, data: {
      kind: f.kind === "character" ? "character" : "background", name: f.name, entity_id: f.id, asset_id: f.assetId ?? "", usage: f.assetId ? "composition" : "reference_only",
      purpose: f.kind === "character" ? "character" : "location", views: f.assetId ? "As in the artwork" : "", permission: "From this film",
    } });
    if (!r.ok) onMessage({ kind: "error", text: r.error }); else { onMessage({ kind: "notice", text: `${f.name} is in your library${f.assetId ? "" : " (no artwork yet, so it's a reference)"}.` }); onDone(); }
  }
  return (
    <ul className="flex flex-col gap-1 border border-line p-2 text-sm">
      {film.map((f) => (
        <li key={f.id} className="flex items-center justify-between gap-2">
          <span>{f.name} <span className="text-xs text-muted">({f.kind}{f.assetId ? ", has artwork" : ""})</span></span>
          <button type="button" className="btn min-h-8 px-2 text-xs" onClick={() => add(f)}>Add</button>
        </li>
      ))}
      {!film.length && <li className="help">No characters or locations yet.</li>}
    </ul>
  );
}

function LibraryEditor({ projectId, entityId, item, onDone, onMessage }: { projectId: string; entityId: string; item: LibItem; onDone: () => void; onMessage: Msg }) {
  const [v, setV] = useState<Record<string, string>>({ kind: item.kind, name: item.name, views: item.views, purpose: item.purpose ?? "", usage: item.usage, note: item.note, attribution: item.attribution, permission: item.permission });
  const [usage, setUsage] = useState<{ shot_id: string; sequence_title: string; frame_number: number; locked: boolean }[] | null>(null);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, x: string) => setV((o) => ({ ...o, [k]: x }));
  useEffect(() => { libraryUsage({ itemId: item.id }).then((r) => setUsage(r.ok ? r.frames : [])); }, [item.id]);
  async function saveDetails() {
    const r = await saveLibraryItem({ projectId, itemId: item.id, data: v });
    if (!r.ok) onMessage({ kind: "error", text: r.error }); else { onMessage({ kind: "notice", text: "Saved." }); onDone(); }
  }
  async function replace() {
    if (!newFile || !usage) return;
    setBusy(true);
    try {
      const assetId = await uploadImage(entityId, newFile, newFile.name);
      const r = await replaceLibrarySource({ itemId: item.id, assetId, expectedFrames: usage.length });
      if (!r.ok) throw new Error(r.error);
      onMessage({ kind: "notice", text: `Replaced in ${usage.length} ${usage.length === 1 ? "frame" : "frames"}. The previous image is kept.` });
      onDone();
    } catch (e) { onMessage({ kind: "error", text: e instanceof Error ? e.message : "Couldn't replace it." }); }
    finally { setBusy(false); }
  }
  return (
    <div className="flex flex-col gap-2 border-t border-line p-2">
      <Fields v={v} set={set} image={!!item.assetId} />
      <button type="button" className="btn self-start text-xs" onClick={saveDetails}>Save details</button>
      {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="truncate text-xs underline">{item.sourceUrl}</a>}
      {item.assetId && (
        <div className="flex flex-col gap-1 border-t border-line pt-2 text-xs">
          <p className="font-medium">Replace the image everywhere</p>
          <p className="text-muted">{usage === null ? "Checking where it's used…" : usage.length ? `Used in ${usage.length} ${usage.length === 1 ? "frame" : "frames"}: ${usage.map((u) => `${u.sequence_title} #${u.frame_number}${u.locked ? " (locked)" : ""}`).join(", ")}. Replacing changes all of them (positions and sizes stay). To change only one frame, edit or swap that layer instead.` : "Not used in any frame yet."}</p>
          <input type="file" accept="image/png,image/jpeg" onChange={(e) => setNewFile(e.target.files?.[0] ?? null)} aria-label="New image" />
          <button type="button" className="btn self-start text-xs" disabled={!newFile || usage === null || busy} onClick={replace}>
            {busy ? "Replacing…" : `Replace in ${usage?.length ?? 0} ${usage?.length === 1 ? "frame" : "frames"}`}
          </button>
        </div>
      )}
      <button type="button" className="self-start text-xs text-muted hover:text-text" onClick={async () => { const r = await archiveLibraryItem({ itemId: item.id }); if (r.ok) onDone(); else onMessage({ kind: "error", text: r.error }); }}>
        Remove from library{usage?.length ? ` (frames keep showing it until you change them)` : ""}
      </button>
    </div>
  );
}

// ---- Layers ------------------------------------------------------------------------------
export function LayersPanel({ comp, selected, editable, library, onSelect, edit }: {
  comp: Composition; selected: string[]; editable: boolean; library: LibItem[]; onSelect: (ids: string[]) => void; edit: Edit;
}) {
  const list = [...comp.layers].reverse();
  const sel = comp.layers.filter((l) => selected.includes(l.id));
  const one = sel.length === 1 ? sel[0] : null;
  const set = (patch: Partial<Layer>) => one && edit((c) => update(c, [one.id], () => patch));
  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col border border-line" aria-label="Layers, top first">
        {list.map((l) => (
          <li key={l.id} className={`flex items-center gap-1 border-b border-line px-1.5 py-1 text-xs last:border-b-0 ${selected.includes(l.id) ? "bg-panel-2" : ""}`}>
            <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={(e) => onSelect(e.shiftKey ? [...selected, l.id] : [l.id])} aria-pressed={selected.includes(l.id)}>
              <span className="text-muted">{l.type === "image" ? "▣" : l.type === "text" ? "T" : l.type === "drawing" ? "✎" : "◆"}</span> {l.name}{l.group ? <span className="text-muted"> · grouped</span> : null}
            </button>
            <button type="button" className="px-1" disabled={!editable} onClick={() => edit((c) => update(c, [l.id], () => ({ hidden: !l.hidden || undefined })))} aria-label={l.hidden ? `Show ${l.name}` : `Hide ${l.name}`}>{l.hidden ? "◌" : "◉"}</button>
            <button type="button" className="px-1" disabled={!editable} onClick={() => edit((c) => update(c, [l.id], () => ({ locked: !l.locked || undefined })))} aria-label={l.locked ? `Unlock ${l.name}` : `Lock ${l.name}`}>{l.locked ? "🔒" : "🔓"}</button>
          </li>
        ))}
        {!list.length && <li className="help p-2">No layers. Add shapes or assets, draw, or add text.</li>}
      </ol>
      {sel.length > 0 && editable && (
        <div className="flex flex-wrap gap-1">
          <button type="button" className="btn min-h-8 px-2 text-xs" onClick={() => edit((c) => reorder(c, selected, "front"))}>To front</button>
          <button type="button" className="btn min-h-8 px-2 text-xs" onClick={() => edit((c) => reorder(c, selected, "up"))}>Forward</button>
          <button type="button" className="btn min-h-8 px-2 text-xs" onClick={() => edit((c) => reorder(c, selected, "down"))}>Back</button>
          <button type="button" className="btn min-h-8 px-2 text-xs" onClick={() => edit((c) => reorder(c, selected, "back"))}>To back</button>
          <button type="button" className="btn min-h-8 px-2 text-xs" onClick={() => edit((c) => update(c, withGroup(c, selected), (l) => ({ flipX: !l.flipX || undefined })))}>Flip ↔</button>
          <button type="button" className="btn min-h-8 px-2 text-xs" onClick={() => edit((c) => update(c, withGroup(c, selected), (l) => ({ flipY: !l.flipY || undefined })))}>Flip ↕</button>
          {sel.length > 1 && <button type="button" className="btn min-h-8 px-2 text-xs" onClick={() => edit((c) => group(c, selected))}>Group</button>}
          {sel.some((l) => l.group) && <button type="button" className="btn min-h-8 px-2 text-xs" onClick={() => edit((c) => ungroup(c, selected))}>Ungroup</button>}
          <button type="button" className="btn min-h-8 px-2 text-xs" onClick={() => { edit((c) => removeLayers(c, selected)); onSelect([]); }}>Delete</button>
        </div>
      )}
      {one && sel.some((l) => l.type === "image") && (
        <p className="text-xs text-muted">Flipping or cropping a photo doesn&apos;t make a new viewpoint: a side view or reverse angle needs another picture or drawing.</p>
      )}
      {one && (
        <fieldset className="flex flex-col gap-2 border-t border-line pt-2" disabled={!editable || one.locked}>
          <legend className="label">{one.name}</legend>
          <label className="flex flex-col gap-1 text-xs"><span className="label">Name</span><input className="field py-1.5 text-sm" value={one.name} onChange={(e) => set({ name: e.target.value.slice(0, 80) })} /></label>
          <div className="grid grid-cols-3 gap-1.5 text-xs">
            {(["x", "y", "w", "h", "rot"] as const).map((k) => (
              <label key={k} className="flex flex-col gap-0.5"><span className="label">{k === "rot" ? "Rotate°" : k.toUpperCase()}</span>
                <input type="number" className="field px-2 py-1 text-sm" value={Math.round(one[k] * 10) / 10} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && (k === "x" || k === "y" || k === "rot" || n > 1)) set({ [k]: n }); }} /></label>
            ))}
            <label className="flex flex-col gap-0.5"><span className="label">Opacity</span>
              <input type="range" min={0.05} max={1} step={0.05} value={one.opacity ?? 1} onChange={(e) => set({ opacity: Number(e.target.value) })} /></label>
          </div>
          {one.type === "image" && (
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              <p className="col-span-2 label">Crop (keeps the original intact)</p>
              {(["l", "r", "t", "b"] as const).map((k) => (
                <label key={k} className="flex flex-col gap-0.5"><span>{{ l: "Left", r: "Right", t: "Top", b: "Bottom" }[k]}</span>
                  <input type="range" min={0} max={0.9} step={0.01} value={one.crop?.[k] ?? 0} onChange={(e) => {
                    const c = { l: 0, t: 0, r: 0, b: 0, ...one.crop, [k]: Number(e.target.value) };
                    if (c.l + c.r < 0.95 && c.t + c.b < 0.95) set({ crop: c });
                  }} /></label>
              ))}
              {one.libraryId && <p className="col-span-2 text-muted">From the library: “{library.find((i) => i.id === one.libraryId)?.name ?? "removed item"}”. Moving, scaling or cropping here changes this frame only.</p>}
            </div>
          )}
          {one.type === "shape" && (
            <label className="flex items-center gap-2 text-xs">Color <input type="color" value={(one.fill ?? "#3a3a3a").slice(0, 7)} onChange={(e) => set({ fill: e.target.value })} /></label>
          )}
          {one.type === "text" && (
            <div className="flex flex-col gap-1.5 text-xs">
              <label className="flex flex-col gap-0.5"><span className="label">Text</span>
                <textarea id={`text-${one.id}`} className="field text-sm" rows={3} value={one.text ?? ""} onChange={(e) => set({ text: e.target.value.slice(0, 1000) })} /></label>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1">Size <input type="number" className="field w-20 px-2 py-1" value={one.fontSize ?? 48} onChange={(e) => set({ fontSize: Math.max(6, Math.min(600, Number(e.target.value) || 48)) })} /></label>
                <input type="color" value={one.color ?? "#111111"} onChange={(e) => set({ color: e.target.value })} aria-label="Text color" />
                <label className="flex items-center gap-1"><input type="checkbox" checked={!!one.box} onChange={(e) => set({ box: e.target.checked })} /> Caption box</label>
                <select className="field w-auto py-1" value={one.align ?? "center"} onChange={(e) => set({ align: e.target.value as Layer["align"] })} aria-label="Alignment"><option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option></select>
              </div>
            </div>
          )}
          {one.type === "drawing" && <p className="text-xs text-muted">{one.strokes?.length ?? 0} strokes. Use Draw or Erase with this layer selected to change it.</p>}
        </fieldset>
      )}
    </div>
  );
}

// ---- Frame ---------------------------------------------------------------------------------
export function FramePanel({ frame, number, canEdit, onSave, onNotes, onState, onClearReview, onRemove, onRestored }: {
  frame: FrameRow; number: number; canEdit: boolean; onSave: (c: ShotContent) => void; onNotes: (n: string) => void;
  onState: (s: "approved" | "proposed" | null, locked: boolean | null) => void; onClearReview: () => void; onRemove: () => void; onRestored: () => void;
}) {
  const [c, setC] = useState<ShotContent>(frame.content);
  const [notes, setNotes] = useState(frame.notes);
  const [versions, setVersions] = useState<{ revision: number; created_at: string }[] | null>(null);
  const ro = !canEdit || frame.locked;
  const dirty = JSON.stringify(c) !== JSON.stringify(frame.content);
  async function loadVersions() {
    const r = await fetch(`/api/storyboards/frame-versions?shot=${frame.id}`, { cache: "no-store" }).then((x) => x.json()).catch(() => ({ versions: [] }));
    setVersions(r.versions ?? []);
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <b>Frame {number}</b>
        <span className="text-muted">{frame.origin === "agent" ? "suggested" : "yours"} · {frame.state === "approved" ? `approved (version ${frame.approvedRevision})` : "proposal"}{frame.locked ? " · locked" : ""}</span>
      </div>
      {canEdit && (
        <div className="flex flex-wrap gap-1">
          <button type="button" className="btn min-h-9 px-2.5 text-xs" aria-pressed={frame.state === "approved"} onClick={() => onState(frame.state === "approved" ? "proposed" : "approved", null)}>{frame.state === "approved" ? "Approved ✓" : "Approve"}</button>
          <button type="button" className="btn min-h-9 px-2.5 text-xs" aria-pressed={frame.locked} onClick={() => onState(null, !frame.locked)}>{frame.locked ? "Unlock" : "Lock"}</button>
        </div>
      )}
      {frame.review && (
        <div className="border border-danger p-2 text-xs" role="status">
          <p><b>Needs a look:</b> {frame.review.reason} Your frame is kept as it is.</p>
          {frame.review.was && <p className="text-muted">Was: “{frame.review.was}”</p>}
          {frame.review.now && <p className="text-muted">Now: “{frame.review.now}”</p>}
          {canEdit && <button type="button" className="btn mt-1 min-h-8 px-2 text-xs" onClick={onClearReview}>It&apos;s fine</button>}
        </div>
      )}
      <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); onSave(c); }}>
        <label className="flex flex-col gap-1 text-xs"><span className="label">What should we notice?</span>
          <input className="field py-1.5 text-sm" value={c.notice ?? ""} onChange={(e) => setC({ ...c, notice: e.target.value || undefined })} readOnly={ro} placeholder="e.g. the cup shaking before anyone reacts" maxLength={400} /></label>
        <label className="flex flex-col gap-1 text-xs"><span className="label">Action</span>
          <textarea className="field text-sm" rows={3} value={c.action} onChange={(e) => setC({ ...c, action: e.target.value })} readOnly={ro} maxLength={1200} /></label>
        <label className="flex flex-col gap-1 text-xs"><span className="label">Dialogue (optional)</span>
          <textarea className="field text-sm" rows={2} value={c.dialogue ?? ""} onChange={(e) => setC({ ...c, dialogue: e.target.value || undefined })} readOnly={ro} maxLength={1200} /></label>
        <label className="flex flex-col gap-1 text-xs"><span className="label">Proposed duration (seconds)</span>
          <input type="number" min={0.2} step={0.5} className="field py-1.5 text-sm" value={c.durationS ?? ""} onChange={(e) => setC({ ...c, durationS: e.target.value ? Number(e.target.value) : undefined })} readOnly={ro} /></label>
        {c.source?.excerpt && <p className="text-xs text-muted">From {c.source.kind === "script" ? `the script (${c.source.heading})` : "your description"}: “{c.source.excerpt.slice(0, 200)}{c.source.excerpt.length > 200 ? "…" : ""}”</p>}
        {!ro && <button type="submit" className="btn self-start" disabled={!dirty}>Save details</button>}
      </form>
      <label className="flex flex-col gap-1 text-xs"><span className="label">Notes</span>
        <textarea className="field text-sm" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} readOnly={!canEdit} maxLength={4000} /></label>
      {canEdit && notes !== frame.notes && <button type="button" className="btn self-start text-xs" onClick={() => onNotes(notes)}>Save notes</button>}
      <section className="flex flex-col gap-1 border-t border-line pt-2 text-xs">
        <p className="font-medium">Saved versions</p>
        {versions === null ? <button type="button" className="btn self-start min-h-8 px-2 text-xs" onClick={loadVersions}>Show versions</button>
          : versions.length ? (
            <ul className="flex flex-col gap-1">
              {versions.map((v) => (
                <li key={v.revision} className="flex items-center justify-between gap-2">
                  <span>Version {v.revision} · {new Date(v.created_at).toLocaleString()}</span>
                  {canEdit && !frame.locked && v.revision !== frame.revision && (
                    <button type="button" className="btn min-h-8 px-2 text-xs" onClick={async () => { const r = await restoreVersion({ shotId: frame.id, revision: v.revision }); if (r.ok) onRestored(); }}>Bring back</button>
                  )}
                </li>
              ))}
            </ul>
          ) : <p className="text-muted">None yet. Press Save to keep a version.</p>}
      </section>
      {canEdit && !frame.locked && <button type="button" className="self-start text-xs text-muted hover:text-text" onClick={onRemove}>Remove this frame</button>}
    </div>
  );
}

// ---- Camera (2D framing + notes for the real shoot) ---------------------------------------
export function CameraPanel({ comp, frame, editable, canEdit, edit, onSaveContent, projectId, lenses, frames, onLensesChanged, onMessage }: {
  comp: Composition; frame: FrameRow; editable: boolean; canEdit: boolean; edit: Edit; onSaveContent: (c: ShotContent) => void;
  projectId: string; lenses: LensPick[]; frames: FrameRow[]; onLensesChanged: () => void; onMessage: Msg;
}) {
  const f = comp.framing;
  const setF = (patch: Partial<Composition["framing"]>) => edit((c) => ({ ...c, framing: { ...c.framing, ...patch } }));
  const [c, setC] = useState<ShotContent>(frame.content);
  useEffect(() => setC(frame.content), [frame.content]);
  const cam = { formatId: "s35", aspect: comp.aspect, ...(c.camera ?? {}) };
  const fov = cam.focalMm ? fieldOfView(cam) : null;
  const dof = depthOfField(cam);
  const fmt = formatOf(cam);
  const dirty = JSON.stringify(c) !== JSON.stringify(frame.content);
  const setCam = (patch: Partial<NonNullable<ShotContent["camera"]>>) => setC((x) => ({ ...x, camera: { ...(x.camera ?? {}), ...patch } }));
  const n = (v: string) => (v === "" ? undefined : Number(v));
  const lens = lenses.find((l) => l.id === c.lensId) ?? null;
  const useLens = (l: LensPick | null, focal?: number) => setC((x) => {
    if (!l) { const { lensId: _, ...rest } = x; return rest; }
    const cam0 = x.camera ?? {};
    return { ...x, lensId: l.id, camera: { ...cam0, focalMm: focal ?? cam0.focalMm ?? l.focalLengths[0],
      anamorphic: l.optical === "anamorphic" || undefined, squeeze: l.optical === "anamorphic" ? (l.squeeze ?? 2) : undefined,
      formatId: l.optical === "anamorphic" && (!cam0.formatId || cam0.formatId === "s35") ? "ana35" : cam0.formatId ?? "s35" } };
  });
  const sizeKey = c.size ?? "medium";
  const standM = cam.focalMm ? distanceForFraming(cam, sizeKey) : null;
  return (
    <div className="flex flex-col gap-3">
      <LensShelf projectId={projectId} lenses={lenses} frames={frames} current={c.lensId ?? null} currentFocal={cam.focalMm}
        canEdit={canEdit} frameLocked={frame.locked} onUse={useLens} onChanged={onLensesChanged} onMessage={onMessage} />
      {canEdit && !frame.locked && dirty && (
        <div className="flex items-center gap-2 border border-brand bg-brand/5 p-2 text-xs">
          <span className="flex-1">{lens ? `${lens.name}${cam.focalMm ? ` · ${cam.focalMm} mm` : ""} picked for this frame.` : "Camera notes changed."}</span>
          <button type="button" className="btn btn-primary min-h-8 px-3 text-xs" onClick={() => onSaveContent(c)}>Save</button>
        </div>
      )}
      <section className="flex flex-col gap-2 border-t border-line pt-2">
        <h3 className="font-semibold">Framing</h3>
        <div className="flex flex-wrap gap-1">
          {([["Wide", 1], ["Medium", 1.6], ["Close", 2.6]] as const).map(([l, z]) => (
            <button key={l} type="button" disabled={!editable} className={`btn min-h-9 px-3 text-xs ${Math.abs(f.zoom - z) < 0.01 ? "btn-primary" : ""}`} onClick={() => setF({ zoom: z })}>{l}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          <button type="button" disabled={!editable} className="btn min-h-9 px-3 text-xs" onClick={() => setF({ zoom: Math.min(8, f.zoom * 1.15) })}>Nearer</button>
          <button type="button" disabled={!editable} className="btn min-h-9 px-3 text-xs" onClick={() => setF({ zoom: Math.max(0.2, f.zoom / 1.15) })}>Farther</button>
          <button type="button" disabled={!editable} className="btn min-h-9 px-3 text-xs" onClick={() => setF({ panX: f.panX - 40 / f.zoom })} aria-label="Frame left">←</button>
          <button type="button" disabled={!editable} className="btn min-h-9 px-3 text-xs" onClick={() => setF({ panX: f.panX + 40 / f.zoom })} aria-label="Frame right">→</button>
          <button type="button" disabled={!editable} className="btn min-h-9 px-3 text-xs" onClick={() => setF({ panY: f.panY - 40 / f.zoom })} aria-label="Frame up">↑</button>
          <button type="button" disabled={!editable} className="btn min-h-9 px-3 text-xs" onClick={() => setF({ panY: f.panY + 40 / f.zoom })} aria-label="Frame down">↓</button>
          <button type="button" disabled={!editable} className="btn min-h-9 px-3 text-xs" onClick={() => setF({ zoom: 1, panX: 0, panY: 0 })}>Reset</button>
        </div>
        <p className="text-xs text-muted">In a 2D frame, nearer/farther and wider/narrower are crops and scaling of your picture (framing guidance). They can&apos;t change perspective or show new sides of things; a real camera moving closer would.</p>
      </section>
      <section className="flex flex-col gap-2 border-t border-line pt-2">
        <h3 className="font-semibold">Shot notes</h3>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs"><span className="label">Shot size</span>
            <select className="field py-1.5 text-sm" value={c.size ?? ""} onChange={(e) => setC({ ...c, size: (e.target.value || undefined) as ShotContent["size"] })} disabled={!canEdit || frame.locked}>
              <option value="">—</option>{SIZES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select></label>
          <label className="flex flex-col gap-1 text-xs"><span className="label">Angle</span>
            <select className="field py-1.5 text-sm" value={c.angle ?? ""} onChange={(e) => setC({ ...c, angle: (e.target.value || undefined) as ShotContent["angle"] })} disabled={!canEdit || frame.locked}>
              <option value="">—</option>{ANGLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select></label>
          <label className="col-span-2 flex flex-col gap-1 text-xs"><span className="label">Movement or camera notes</span>
            <input className="field py-1.5 text-sm" value={c.cameraNotes ?? ""} onChange={(e) => setC({ ...c, cameraNotes: e.target.value || undefined })} readOnly={!canEdit || frame.locked} placeholder="e.g. slow push in as she reads the email" maxLength={600} /></label>
        </div>
        <p className="text-xs text-muted">{c.angle && c.angle !== "eye" ? `${labelOf(ANGLES, c.angle)} is a note here: draw or arrange the frame to show it.` : "Eye level, high or low angle: draw or arrange the frame to show it; these are notes."}</p>
        <details className="border border-line p-2">
          <summary className="cursor-pointer text-sm font-medium">Lens notes for the real shoot{lens ? ` · ${lens.name}` : ""}{cam.focalMm ? ` ${cam.focalMm} mm` : ""}</summary>
          <fieldset className="mt-2 grid grid-cols-2 gap-2 text-xs" disabled={!canEdit || frame.locked}>
            <label className="col-span-2 flex flex-col gap-1"><span className="label">Capture format</span>
              <select className="field py-1.5 text-sm" value={cam.formatId} onChange={(e) => setCam({ formatId: e.target.value })}>
                {FORMATS.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.widthMm} × {x.heightMm} mm)</option>)}
              </select></label>
            <label className="flex flex-col gap-1"><span className="label">Focal length (mm)</span><input type="number" className="field py-1.5 text-sm" value={cam.focalMm ?? ""} onChange={(e) => setCam({ focalMm: n(e.target.value) })} /></label>
            <label className="flex flex-col gap-1"><span className="label">Focus distance (m)</span><input type="number" step="0.1" className="field py-1.5 text-sm" value={cam.focusM ?? ""} onChange={(e) => setCam({ focusM: n(e.target.value) })} /></label>
            <label className="flex flex-col gap-1"><span className="label">Aperture</span>
              <span className="flex gap-1"><select className="field w-14 px-1 py-1.5" value={cam.apertureKind ?? "f"} onChange={(e) => setCam({ apertureKind: e.target.value as "f" | "T" })} aria-label="f-number or T-stop"><option value="f">f/</option><option value="T">T</option></select>
                <input type="number" step="0.1" className="field py-1.5 text-sm" value={cam.aperture ?? ""} onChange={(e) => setCam({ aperture: n(e.target.value) })} aria-label="Aperture value" /></span></label>
            <label className="flex flex-col gap-1"><span className="label">Camera height (m)</span><input type="number" step="0.1" className="field py-1.5 text-sm" value={cam.cameraHeightM ?? ""} onChange={(e) => setCam({ cameraHeightM: n(e.target.value) })} /></label>
          </fieldset>
          <p className="mt-2 text-xs text-muted">{fov && fmt ? `On ${fmt.name} at ${comp.aspect.toFixed(2)}:1, a ${cam.focalMm} mm lens sees about ${Math.round(fov.h)}° × ${Math.round(fov.v)}° (calculated from the capture width after cropping to this aspect).` : "Add a focal length to calculate the field of view."}
            {standM ? ` For a ${labelOf(SIZES, sizeKey).toLowerCase()} shot of a standing person, the camera is about ${round(standM, 1)} m away.` : ""}
            {dof ? ` Depth of field ≈ ${round(dof.nearM, 2)}–${dof.farM ? `${round(dof.farM, 2)} m` : "∞"}${dof.approximate ? " (approximate for T-stops)" : ""}.` : ""} These are notes; the 2D frame is not an optical simulation, and a lens name doesn&apos;t reproduce its flare or bokeh.</p>
        </details>
        {canEdit && !frame.locked && dirty && <button type="button" className="btn self-start" onClick={() => onSaveContent(c)}>Save shot notes</button>}
      </section>
      <p className="text-[11px] text-muted">Frame width: {FRAME_W} units · height {Math.round(frameH(comp))}.</p>
    </div>
  );
}

// ---- Lens shelf ----------------------------------------------------------------------------
// Lenses she picked while browsing Lens Addiction (or elsewhere): her link and her notes.
// Nothing is copied from the source site; "Open" always goes back to it.
const focalText = (l: LensPick) => (l.focalLengths.length ? (l.zoom && l.focalLengths.length >= 2 ? `${l.focalLengths[0]}–${l.focalLengths[l.focalLengths.length - 1]} mm` : `${l.focalLengths.join(", ")} mm`) : "");

function LensShelf({ projectId, lenses, frames, current, currentFocal, canEdit, frameLocked, onUse, onChanged, onMessage }: {
  projectId: string; lenses: LensPick[]; frames: FrameRow[]; current: string | null; currentFocal?: number; canEdit: boolean; frameLocked: boolean;
  onUse: (l: LensPick | null, focal?: number) => void; onChanged: () => void; onMessage: Msg;
}) {
  const [form, setForm] = useState<null | { id: string | null }>(null);
  const [open, setOpen] = useState<string | null>(current);
  const usedIn = (id: string) => frames.map((f, i) => (f.content.lensId === id ? i + 1 : 0)).filter(Boolean);
  const editing = form?.id ? lenses.find((l) => l.id === form.id) ?? null : null;
  const pickable = canEdit && !frameLocked;
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold">Lens shelf</h3>
        <a href={LENS_ADDICTION_URL} target="_blank" rel="noopener noreferrer" className="text-xs underline">Browse Lens Addiction ↗</a>
      </div>
      <p className="text-xs text-muted">Find a look you love on Lens Addiction, then add that lens here with the link. Pick it for a frame and the camera notes fill in.</p>
      {lenses.length === 0 && !form && <p className="border border-dashed border-line p-2 text-xs text-muted">No lenses yet.</p>}
      <ul className="flex flex-col gap-1.5">
        {lenses.map((l) => {
          const used = usedIn(l.id);
          const isCurrent = l.id === current;
          return (
            <li key={l.id} className={`border p-2 text-xs ${isCurrent ? "border-brand" : "border-line"}`}>
              <button type="button" className="flex w-full items-baseline justify-between gap-2 text-left" onClick={() => setOpen(open === l.id ? null : l.id)} aria-expanded={open === l.id}>
                <span className="font-medium text-sm">{l.name}</span>
                <span className="shrink-0 text-muted">{l.optical === "anamorphic" ? `Anamorphic ${l.squeeze ?? 2}×` : "Spherical"}{isCurrent ? " · this frame" : ""}</span>
              </button>
              {l.focalLengths.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {(l.zoom ? [l.focalLengths[0], l.focalLengths[l.focalLengths.length - 1]] : l.focalLengths).map((mm) => (
                    <button key={mm} type="button" disabled={!pickable} className={`btn min-h-7 px-2 text-[11px] ${isCurrent && currentFocal === mm ? "btn-primary" : ""}`}
                      onClick={() => onUse(l, mm)} title={`Use ${l.name} at ${mm} mm for this frame`}>{mm} mm</button>
                  ))}
                  {l.zoom && <span className="self-center text-muted">zoom: type any focal length in the lens notes</span>}
                </div>
              )}
              {open === l.id && (
                <div className="mt-2 flex flex-col gap-1">
                  {l.seenIn && <p><span className="text-muted">Seen in:</span> {l.seenIn}{l.camera ? ` · ${l.camera}` : ""}</p>}
                  {!l.seenIn && l.camera && <p><span className="text-muted">Camera:</span> {l.camera}</p>}
                  {l.maxAperture && <p><span className="text-muted">Widest aperture:</span> {l.maxAperture}</p>}
                  {l.note && <p><span className="text-muted">What I like:</span> {l.note}</p>}
                  <p className="text-muted">{used.length ? `Used in frame${used.length > 1 ? "s" : ""} ${used.join(", ")} of this storyboard.` : "Not used in this storyboard yet."}</p>
                  <div className="flex flex-wrap gap-1">
                    {l.sourceUrl && <a href={l.sourceUrl} target="_blank" rel="noopener noreferrer" className="btn min-h-7 px-2 text-[11px]">Open on {l.sourceName || "source"} ↗</a>}
                    {pickable && !l.focalLengths.length && <button type="button" className="btn min-h-7 px-2 text-[11px]" onClick={() => onUse(l)}>Use for this frame</button>}
                    {pickable && isCurrent && <button type="button" className="btn min-h-7 px-2 text-[11px]" onClick={() => onUse(null)}>Clear from this frame</button>}
                    {canEdit && <button type="button" className="btn min-h-7 px-2 text-[11px]" onClick={() => setForm({ id: l.id })}>Edit</button>}
                    {canEdit && <button type="button" className="btn min-h-7 px-2 text-[11px]" onClick={async () => {
                      const r = await archiveLens({ lensId: l.id });
                      if (!r.ok) onMessage({ kind: "error", text: r.error }); else { onMessage({ kind: "notice", text: `${l.name} removed from the shelf${used.length ? " (frames keep their focal length notes)" : ""}.` }); onChanged(); }
                    }}>Remove</button>}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {canEdit && !form && <button type="button" className="btn self-start" onClick={() => setForm({ id: null })}>+ Add a lens</button>}
      {form && <LensForm key={form.id ?? "new"} projectId={projectId} lens={editing} onCancel={() => setForm(null)}
        onSaved={(name) => { setForm(null); onMessage({ kind: "notice", text: `${name} is on the shelf.` }); onChanged(); }} onMessage={onMessage} />}
    </section>
  );
}

function LensForm({ projectId, lens, onCancel, onSaved, onMessage }: { projectId: string; lens: LensPick | null; onCancel: () => void; onSaved: (name: string) => void; onMessage: Msg }) {
  const [v, setV] = useState({
    sourceUrl: lens?.sourceUrl ?? "", name: lens?.name ?? "", focals: lens ? lens.focalLengths.join(", ") : "", zoom: lens?.zoom ?? false,
    optical: lens?.optical ?? "spherical", squeeze: String(lens?.squeeze ?? 2), maxAperture: lens?.maxAperture ?? "", camera: lens?.camera ?? "",
    seenIn: lens?.seenIn ?? "", note: lens?.note ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [filled, setFilled] = useState<string | null>(null);
  const set = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }));
  // Paste a link → fill what the link itself says (name, focal length, aperture, type).
  // Only the link text is read; fields she already typed are left alone.
  const fromLink = (url: string) => {
    const l = lensFromLink(url);
    if (!l) { setFilled(url.trim() && /lensaddiction/i.test(url) ? "This link doesn't name a lens. Type the details below (open the page to see them)." : null); return; }
    setV((x) => {
      const next = { ...x, sourceUrl: url };
      const got: string[] = [];
      if (!x.name.trim()) { next.name = l.name; got.push("name"); }
      if (!x.focals.trim() && l.focalLengths.length) { next.focals = l.focalLengths.join(", "); next.zoom = l.zoom; got.push(l.zoom ? "zoom range" : "focal length"); }
      if (!x.maxAperture.trim() && l.maxAperture) { next.maxAperture = l.maxAperture; got.push("aperture"); }
      if (l.optical === "anamorphic" && x.optical === "spherical") { next.optical = "anamorphic"; next.squeeze = String(l.squeeze ?? 2); got.push("anamorphic squeeze"); }
      setFilled(got.length ? `Filled from the link: ${got.join(", ")}. Check them, then add the film and camera.` : null);
      return next;
    });
  };
  const focals = v.focals.split(/[,\s–-]+/).map((x) => x.replace(/mm$/i, "")).filter(Boolean).map(Number);
  const badFocal = focals.some((x) => !Number.isFinite(x) || x < 4 || x > 2000);
  const submit = async () => {
    if (!v.name.trim()) { onMessage({ kind: "error", text: "Give the lens a name, like “Cooke S4/i” or “Canon K35”." }); return; }
    if (badFocal) { onMessage({ kind: "error", text: "Focal lengths are numbers in mm, like 25, 40, 75." }); return; }
    setBusy(true);
    const r = await saveLens({ projectId, lensId: lens?.id ?? null, data: {
      name: v.name.trim(), focal_lengths: focals, zoom: v.zoom, optical: v.optical, squeeze: v.optical === "anamorphic" ? Number(v.squeeze) : null,
      max_aperture: v.maxAperture.trim(), camera: v.camera.trim(), seen_in: v.seenIn.trim(), note: v.note.trim(), source_url: v.sourceUrl.trim(),
    } });
    setBusy(false);
    if (!r.ok) onMessage({ kind: "error", text: r.error }); else onSaved(v.name.trim());
  };
  const field = "field py-1.5 text-sm";
  return (
    <form className="flex flex-col gap-2 border border-line p-2 text-xs" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <p className="font-medium text-sm">{lens ? "Edit lens" : "Add a lens"}</p>
      <label className="flex flex-col gap-1"><span className="label">Link (Lens Addiction page)</span>
        <input className={field} type="url" inputMode="url" placeholder="https://www.lensaddiction.net/…" value={v.sourceUrl}
          onChange={(e) => { const url = e.target.value; set({ sourceUrl: url }); if (/[?&](lensModel|search)=/i.test(url)) fromLink(url); }}
          onPaste={(e) => { const url = e.clipboardData.getData("text"); if (url) { e.preventDefault(); set({ sourceUrl: url.trim() }); fromLink(url.trim()); } }}
          onBlur={(e) => fromLink(e.target.value)} /></label>
      {filled && <p className="border-l-2 border-brand pl-2 text-[11px]">{filled}</p>}
      <label className="flex flex-col gap-1"><span className="label">Lens</span>
        <input className={field} placeholder="e.g. Canon K35" value={v.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} required /></label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1"><span className="label">Focal lengths (mm)</span>
          <input className={field} placeholder={v.zoom ? "24, 290" : "18, 35, 50"} value={v.focals} onChange={(e) => set({ focals: e.target.value })} aria-invalid={badFocal} /></label>
        <label className="flex items-end gap-1 pb-2"><input type="checkbox" checked={v.zoom} onChange={(e) => set({ zoom: e.target.checked })} /> Zoom (shortest, longest)</label>
        <label className="flex flex-col gap-1"><span className="label">Type</span>
          <select className={field} value={v.optical} onChange={(e) => set({ optical: e.target.value as LensPick["optical"] })}>
            <option value="spherical">Spherical</option><option value="anamorphic">Anamorphic</option></select></label>
        <label className="flex flex-col gap-1"><span className="label">Widest aperture</span>
          <input className={field} placeholder="e.g. T1.5" value={v.maxAperture} maxLength={20} onChange={(e) => set({ maxAperture: e.target.value })} /></label>
        {v.optical === "anamorphic" && (
          <label className="flex flex-col gap-1"><span className="label">Squeeze</span>
            <select className={field} value={v.squeeze} onChange={(e) => set({ squeeze: e.target.value })}>
              {[...new Set(["1.3", "1.5", "1.65", "1.8", "2", v.squeeze])].map((q) => <option key={q} value={q}>{q}×</option>)}</select></label>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1"><span className="label">Seen in (film)</span>
          <input className={field} placeholder="e.g. Another Round" value={v.seenIn} maxLength={200} onChange={(e) => set({ seenIn: e.target.value })} /></label>
        <label className="flex flex-col gap-1"><span className="label">Camera</span>
          <input className={field} placeholder="e.g. ARRI Alexa Mini" value={v.camera} maxLength={120} onChange={(e) => set({ camera: e.target.value })} /></label>
      </div>
      <label className="flex flex-col gap-1"><span className="label">What do you like about it?</span>
        <textarea className={`${field} min-h-14`} maxLength={600} value={v.note} onChange={(e) => set({ note: e.target.value })} placeholder="e.g. soft faces, warm glow on the lights" /></label>
      <p className="text-[11px] text-muted">STUDIO reads only the link itself (it doesn&apos;t open the page) and keeps your notes and the link.</p>
      <div className="flex gap-1">
        <button type="submit" className="btn btn-primary min-h-8 px-3 text-xs" disabled={busy}>{busy ? "Saving…" : lens ? "Save lens" : "Add to shelf"}</button>
        <button type="button" className="btn min-h-8 px-3 text-xs" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// ---- Look ----------------------------------------------------------------------------------
export function LookPanel({ comp, editable, edit, stocks, frames, onApplyAll }: { comp: Composition; editable: boolean; edit: Edit; stocks: StockRef[]; frames: number; onApplyAll: () => void }) {
  const L = comp.look;
  const set = (patch: Partial<Look>) => edit((c) => ({ ...c, look: { ...c.look, ...patch, presetId: patch.presetId } }));
  const slider = (label: string, k: "exposure" | "contrast" | "saturation" | "warmth" | "vignette", min: number, max: number, step: number) => (
    <label className="flex flex-col gap-0.5 text-xs"><span className="flex justify-between"><span>{label}</span><span className="text-muted">{L[k].toFixed(2)}</span></span>
      <input type="range" min={min} max={max} step={step} value={L[k]} disabled={!editable} onChange={(e) => set({ [k]: Number(e.target.value) })} /></label>
  );
  const preset = LOOK_PRESETS.find((p) => p.id === L.presetId);
  const [showStocks, setShowStocks] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <p className="help">Color and texture are applied here in your browser to a copy: your images stay unchanged. The same settings are used for export.</p>
      <label className="flex flex-col gap-1 text-xs"><span className="label">Start from</span>
        <select className="field py-1.5 text-sm" value={L.presetId ?? ""} disabled={!editable} onChange={(e) => {
          const p = LOOK_PRESETS.find((x) => x.id === e.target.value); if (!p) return;
          edit((c) => ({ ...c, look: { ...DEFAULT_LOOK, ...p.look, grain: { ...DEFAULT_LOOK.grain, ...(p.look.grain ?? {}) }, presetId: p.id } }));
        }}>
          <option value="">Custom</option>{LOOK_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></label>
      {preset && <p className="text-xs text-muted">{preset.source}</p>}
      {slider("Exposure (stops)", "exposure", -2, 2, 0.05)}
      {slider("Contrast", "contrast", -1, 1, 0.05)}
      {slider("Saturation", "saturation", 0, 2, 0.05)}
      {slider("Cool ↔ warm", "warmth", -1, 1, 0.05)}
      {slider("Vignette", "vignette", 0, 1, 0.05)}
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={L.grayscale} disabled={!editable} onChange={(e) => set({ grayscale: e.target.checked })} /> Grayscale</label>
      <fieldset className="flex flex-col gap-1 border border-line p-2 text-xs" disabled={!editable}>
        <legend className="label px-1">Grain (a separate texture)</legend>
        <label className="flex flex-col gap-0.5"><span className="flex justify-between"><span>Amount</span><span className="text-muted">{L.grain.amount.toFixed(3)}</span></span>
          <input type="range" min={0} max={0.15} step={0.005} value={L.grain.amount} onChange={(e) => set({ grain: { ...L.grain, amount: Number(e.target.value) } })} /></label>
        <label className="flex flex-col gap-0.5"><span className="flex justify-between"><span>Size (µm on a Super 35 width)</span><span className="text-muted">{L.grain.size}</span></span>
          <input type="range" min={2} max={30} step={1} value={L.grain.size} onChange={(e) => set({ grain: { ...L.grain, size: Number(e.target.value) } })} /></label>
        <span className="flex items-center gap-2">Seed {L.grain.seed}
          <button type="button" className="btn min-h-8 px-2 text-xs" onClick={() => set({ grain: { ...L.grain, seed: Math.floor(Math.random() * 1e9) } })}>New pattern</button></span>
        <p className="text-muted">Same seed = same grain in the preview and in every export; it scales with the export size.</p>
      </fieldset>
      <div className="flex flex-wrap gap-1">
        <button type="button" className="btn min-h-9 px-2.5 text-xs" disabled={!editable} onClick={() => edit((c) => ({ ...c, look: { ...DEFAULT_LOOK, grain: { ...DEFAULT_LOOK.grain } } }))}>Reset look</button>
        {frames > 1 && <button type="button" className="btn min-h-9 px-2.5 text-xs" disabled={!editable} onClick={onApplyAll}>Use this look on every unlocked frame</button>}
      </div>
      <section className="border-t border-line pt-2 text-xs">
        <button type="button" className="text-accent underline" onClick={() => setShowStocks((v) => !v)}>{showStocks ? "Hide" : "Learn about"} film stocks</button>
        {showStocks && (
          <ul className="mt-2 flex flex-col gap-2">
            {stocks.map((s) => (
              <li key={s.id} className="border border-line p-2">
                <p><b>{s.manufacturer} {s.stock}</b> ({s.product_codes.join("/")}) · motion-picture negative · {s.gauges.join(", ")}</p>
                <p>EI {s.ei_tungsten} tungsten · EI {s.ei_daylight} daylight · balanced for {s.balance}</p>
                <p className="text-muted">{s.documented}</p>
                <p className="text-muted">{s.editorial}</p>
                <p>{s.source_urls.map((u, i) => <a key={u} href={u} target="_blank" rel="noreferrer" className="underline">{i ? " · " : ""}Source {i + 1}</a>)}</p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-muted">“Stock-inspired” presets are Studio&apos;s own approximations, not calibrated emulations or licensed profiles.</p>
      </section>
    </div>
  );
}

// ---- Reference tray ------------------------------------------------------------------------
export function ReferenceTray({ open, onToggle, library, editable, onPlace }: { open: boolean; onToggle: () => void; library: LibItem[]; editable: boolean; onPlace: (it: LibItem) => void }) {
  const refs = library.filter((i) => i.kind === "reference" || i.usage === "reference_only");
  return (
    <section className="panel" aria-label="References">
      <button type="button" className="flex w-full items-center justify-between px-3 py-2 text-sm" onClick={onToggle} aria-expanded={open}>
        <span className="font-semibold">References ({refs.length})</span><span className="text-muted">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        refs.length ? (
          <ul className="flex gap-2 overflow-x-auto border-t border-line p-2">
            {refs.map((r) => (
              <li key={r.id} className="w-40 shrink-0 text-xs">
                <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-panel-2">
                  {r.assetId
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={`/api/assets/${r.assetId}`} alt={r.name} className="max-h-full max-w-full object-contain" loading="lazy" />
                    : <a href={r.sourceUrl ?? "#"} target="_blank" rel="noreferrer" className="p-2 text-center underline">Open link</a>}
                </div>
                <p className="truncate font-medium">{r.name}</p>
                {r.purpose && <p className="text-muted">{PURPOSES.find(([k]) => k === r.purpose)?.[1]}</p>}
                {r.note && <p className="line-clamp-2">“{r.note}”</p>}
                {r.attribution && <p className="truncate text-muted">© {r.attribution}</p>}
                {r.usage === "composition" && r.assetId
                  ? <button type="button" className="btn mt-1 min-h-8 px-2 text-[11px]" disabled={!editable} onClick={() => onPlace(r)}>Use in frame</button>
                  : <p className="text-[10px] uppercase tracking-[0.08em] text-muted">Reference only</p>}
              </li>
            ))}
          </ul>
        ) : <p className="help border-t border-line p-3">Add references in Assets → Add to the library (images or links), with what you like about each one.</p>
      )}
    </section>
  );
}
