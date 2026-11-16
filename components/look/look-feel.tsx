"use client";
// LOOK & FEEL (Treatment desk): the film's visual-direction references and named directions.
// Adding, tagging, organizing, approving and palettes are plain data + local pixel math:
// no model calls. Her words are saved exactly as written.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  findLookAsset, lookOwner, moveLookRef, removeLookRef, saveLookRef,
} from "@/app/projects/[projectId]/look-actions";
import { TreatmentCropPicker } from "@/components/treatment-crop-picker";
import { ThumbView } from "@/components/thumb-view";
import type { FilmEntity, FilmPicture } from "@/lib/look/data";
import { sampleAt, suggestPalette } from "@/lib/look/palette";
import { addLookImage, loadPixels, type Step } from "@/lib/look/upload";
import { LOOK_TAGS, accessOf, type Applies, type LookDirection, type LookRef, type LookTag, type PaletteColor } from "@/lib/look/types";
import type { SlideInfo } from "@/lib/slide-match";
import type { ThumbCrop } from "@/lib/thumb";
import { Directions } from "./directions";
import { AppliesPicker, PaletteEditor, RefVisual, StatusBadge, TagChips, hostOf, scopeLabel } from "./parts";

export interface LookProps {
  projectId: string; canEdit: boolean; refs: LookRef[]; directions: LookDirection[];
  entities: FilmEntity[]; pictures: FilmPicture[]; scenes: { number: number; heading: string }[];
  deck: { fileId: string; slides: SlideInfo[] | null } | null;
  designPartnerHref: string | null;
}
type Msg = { kind: "error" | "notice"; text: string } | null;

export function LookAndFeel(props: LookProps) {
  const { projectId, canEdit, refs, directions, entities } = props;
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [msg, setMsg] = useState<Msg>(null);
  const [order, setOrder] = useState<LookRef[]>(refs);
  useEffect(() => setOrder(refs), [refs]);
  const live = directions.filter((d) => d.status !== "archived");
  const shown = filter === "all" ? order : order.filter((r) => directions.find((d) => d.id === filter)?.referenceIds.includes(r.id));
  const open = order.find((r) => r.id === openId) ?? null;

  async function move(r: LookRef, d: -1 | 1) {
    const i = order.findIndex((x) => x.id === r.id), j = i + d;
    if (j < 0 || j >= order.length) return;
    const before = d < 0 ? order[j - 1]?.position : order[j].position;
    const after = d < 0 ? order[j].position : order[j + 1]?.position;
    const pos = before == null ? after! - 1000 : after == null ? before + 1000 : (before + after) / 2;
    const next = [...order]; next.splice(i, 1); next.splice(j, 0, { ...r, position: pos });
    setOrder(next);
    const res = await moveLookRef({ projectId, refId: r.id, position: pos });
    if (!res.ok) { setMsg({ kind: "error", text: res.error }); setOrder(refs); }
    // keep focus on the moved card's same button
    setTimeout(() => document.getElementById(`ref-move-${r.id}-${d}`)?.focus(), 0);
  }

  return (
    <section className="panel flex flex-col gap-4 p-5" aria-labelledby="look-h">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="look-h" className="display text-2xl leading-none">LOOK &amp; FEEL</h2>
          <p className="help mt-1">Collect the images that shape your film.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {props.designPartnerHref && <Link href={props.designPartnerHref} className="btn">Talk it over with your Design partner</Link>}
          {canEdit && <button type="button" className="btn-primary" onClick={() => { setAdding((v) => !v); setMsg(null); }} aria-expanded={adding}>Add a Reference</button>}
        </div>
      </div>
      <p className="text-xs text-muted">Three kinds of reference stay separate: <b>Cast</b> is who appears, <b>Locations</b> is where it happens, and <b>Look &amp; Feel</b> is how the film should look.</p>
      {msg && <p role={msg.kind === "error" ? "alert" : "status"} className={`border-l-2 pl-2 text-sm ${msg.kind === "error" ? "border-danger text-danger" : "border-brand"}`}>{msg.text}</p>}

      {adding && canEdit && (
        <AddReference {...props} onClose={() => setAdding(false)} onMessage={setMsg}
          onAdded={(ids) => { setAdding(false); refresh(); if (ids[0]) setOpenId(ids[0]); }} />
      )}

      {live.length > 0 && order.length > 0 && (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Show references">
          <button type="button" aria-pressed={filter === "all"} className={`btn min-h-8 px-2 text-xs ${filter === "all" ? "border-brand bg-brand/10" : ""}`} onClick={() => setFilter("all")}>All ({order.length})</button>
          {live.map((d) => (
            <button key={d.id} type="button" aria-pressed={filter === d.id} className={`btn min-h-8 px-2 text-xs ${filter === d.id ? "border-brand bg-brand/10" : ""}`} onClick={() => setFilter(d.id)}>
              {d.name} ({d.referenceIds.length})
            </button>
          ))}
        </div>
      )}

      {order.length === 0 ? (
        <div className="flex flex-col items-start gap-2 border border-dashed border-line p-6">
          <p>Start with one image. A photograph, drawing, or color reference is enough.</p>
          {canEdit && !adding && <button type="button" className="btn-primary" onClick={() => setAdding(true)}>Add a Reference</button>}
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Look & Feel references">
          {shown.map((r) => {
            const i = order.findIndex((x) => x.id === r.id);
            const note = r.reason.split("\n")[0];
            return (
              <li key={r.id} className="flex flex-col border border-line bg-panel-2">
                <button type="button" onClick={() => setOpenId(r.id)} className="group flex flex-col text-left focus-visible:outline-2 focus-visible:outline-brand"
                  aria-label={`${r.title}: open details`}>
                  <div className="aspect-[4/3] w-full overflow-hidden"><RefVisual r={r} /></div>
                  <div className="flex flex-col gap-1 p-2">
                    <div className="flex items-start justify-between gap-1">
                      <span className="line-clamp-1 font-medium group-hover:text-accent">{r.title}</span>
                      <StatusBadge status={r.status} />
                    </div>
                    <TagChips tags={r.tags} />
                    {note && <p className="line-clamp-1 text-xs text-muted">“{note}”</p>}
                  </div>
                </button>
                {canEdit && filter === "all" && (
                  <div className="mt-auto flex border-t border-line text-xs">
                    <button id={`ref-move-${r.id}--1`} type="button" className="flex-1 py-1.5 disabled:opacity-30" disabled={i === 0} onClick={() => move(r, -1)} aria-label={`Move ${r.title} earlier`}>←</button>
                    <button id={`ref-move-${r.id}-1`} type="button" className="flex-1 border-l border-line py-1.5 disabled:opacity-30" disabled={i === order.length - 1} onClick={() => move(r, 1)} aria-label={`Move ${r.title} later`}>→</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Directions {...props} refs={order} onMessage={setMsg} onOpenRef={setOpenId} />

      {open && (
        <RefDialog key={open.id} r={open} {...props} directions={directions} onClose={() => setOpenId(null)} onMessage={setMsg}
          onSaved={() => refresh()} onRemoved={(n) => { setOpenId(null); setMsg({ kind: "notice", text: `Removed from Look & Feel${n ? ` and from ${n} direction${n > 1 ? "s" : ""}` : ""}. The picture itself wasn't deleted.` }); refresh(); }} />
      )}
    </section>
  );
}

// ---- Adding ---------------------------------------------------------------------------------
function AddReference({ projectId, pictures, entities, deck, onClose, onAdded, onMessage }: LookProps & {
  onClose: () => void; onAdded: (ids: string[]) => void; onMessage: (m: Msg) => void;
}) {
  const [way, setWay] = useState<"upload" | "film" | "treatment" | "link">("upload");
  const [progress, setProgress] = useState<{ name: string; step: Step | "failed"; error?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState(""), [title, setTitle] = useState("");
  const [q, setQ] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const failed = useRef<File[]>([]);

  async function upload(files: File[]) {
    if (!files.length) return;
    setBusy(true); onMessage(null);
    setProgress(files.map((f) => ({ name: f.name, step: "checking" })));
    const own = await lookOwner({ projectId });
    if (!own.ok || !own.id) { setBusy(false); onMessage({ kind: "error", text: own.ok ? "Couldn't start the upload." : own.error }); return; }
    const ids: string[] = []; failed.current = [];
    for (const [i, f] of files.entries()) {
      try {
        const res = await addLookImage({ file: f, ownerEntityId: own.id, find: (sha) => findLookAsset({ projectId, sha256: sha }),
          onStep: (step) => setProgress((p) => p.map((x, j) => (j === i ? { ...x, step } : x))) });
        const saved = await saveLookRef({ projectId, refId: null, data: { asset_id: res.assetId, thumb_asset_id: res.thumbAssetId, title: f.name.replace(/\.\w+$/, "").slice(0, 120) } });
        if (!saved.ok) throw new Error(saved.error);
        ids.push(saved.id!);
        setProgress((p) => p.map((x, j) => (j === i ? { ...x, step: "done", error: res.reused ? "Already in your film: reused, not stored again." : undefined } : x)));
      } catch (e) {
        failed.current.push(f);
        setProgress((p) => p.map((x, j) => (j === i ? { ...x, step: "failed", error: e instanceof Error ? e.message : "Upload failed." } : x)));
      }
    }
    setBusy(false);
    if (ids.length && !failed.current.length) onAdded(ids);
    else if (ids.length) onMessage({ kind: "notice", text: `${ids.length} added. Some didn't upload: retry them below.` });
  }

  async function addExisting(data: Record<string, unknown>) {
    setBusy(true);
    const r = await saveLookRef({ projectId, refId: null, data });
    setBusy(false);
    if (!r.ok) onMessage({ kind: "error", text: r.error }); else onAdded([r.id!]);
  }

  const list = pictures.filter((p) => !q || `${p.label} ${p.entityName ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const cropEnts = entities.filter((e) => e.thumb?.kind === "crop");
  const tabs = [["upload", "Upload"], ["film", "From your film"], ...(deck ? [["treatment", "From your treatment"]] : []), ["link", "A link"]] as const;
  return (
    <div className="flex flex-col gap-3 border border-brand p-3">
      <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Add a reference from">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={way === k} onClick={() => setWay(k as typeof way)}
            className={`btn min-h-9 px-3 text-xs ${way === k ? "btn-primary" : ""}`}>{label}</button>
        ))}
        <button type="button" className="ml-auto text-xs underline" onClick={onClose}>Close</button>
      </div>

      {way === "upload" && (
        <div className="flex flex-col gap-2">
          <label className="flex cursor-pointer flex-col items-center gap-1 border border-dashed border-line p-6 text-center hover:border-brand focus-within:border-brand"
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void upload([...e.dataTransfer.files]); }}>
            <span className="font-medium">Choose images or drawings</span>
            <span className="text-xs text-muted">PNG or JPEG, up to 50 MB each. Drop them here or tap to choose.</span>
            <input ref={file} type="file" accept="image/png,image/jpeg" multiple className="sr-only" disabled={busy}
              onChange={(e) => { void upload([...(e.target.files ?? [])]); e.target.value = ""; }} />
          </label>
          {progress.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs" aria-live="polite">
              {progress.map((p, i) => (
                <li key={i} className={p.step === "failed" ? "text-danger" : ""}>
                  {p.name}: {p.step === "checking" ? "checking…" : p.step === "uploading" ? "uploading the original…" : p.step === "preview" ? "making a preview…" : p.step === "done" ? "added" : "didn't upload"}
                  {p.error && <span className={p.step === "failed" ? "" : "text-muted"}> — {p.error}</span>}
                </li>
              ))}
            </ul>
          )}
          {!busy && failed.current.length > 0 && <button type="button" className="btn self-start text-xs" onClick={() => upload(failed.current)}>Retry {failed.current.length} failed</button>}
        </div>
      )}

      {way === "film" && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted">Pictures already in your film. Using one here doesn&apos;t copy it: it stays the same picture wherever it&apos;s used.</p>
          <input className="field max-w-xs" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search pictures" />
          {list.length === 0 && cropEnts.length === 0 ? <p className="help">No pictures in your film yet.</p> : (
            <ul className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-5">
              {cropEnts.filter((e) => !q || e.name.toLowerCase().includes(q.toLowerCase())).map((e) => (
                <li key={e.id}>
                  <button type="button" disabled={busy} className="flex w-full flex-col border border-line text-left text-[11px] hover:border-brand focus-visible:outline-2 focus-visible:outline-brand"
                    onClick={() => addExisting({ crop: (e.thumb as { crop: ThumbCrop }).crop, source_entity_id: e.id, title: `${e.name} (look)` })}>
                    <ThumbView source={e.thumb} alt={e.name} className="aspect-[4/3] w-full" />
                    <span className="truncate p-1">{e.name} · treatment</span>
                  </button>
                </li>
              ))}
              {list.map((p) => (
                <li key={p.assetId}>
                  <button type="button" disabled={busy} className="flex w-full flex-col border border-line text-left text-[11px] hover:border-brand focus-visible:outline-2 focus-visible:outline-brand"
                    onClick={() => addExisting({ asset_id: p.assetId, source_entity_id: p.entityKind === "character" || p.entityKind === "location" ? p.entityId : null,
                      title: (p.entityName && p.entityKind !== "research_board" ? `${p.entityName}: ` : "") + p.label.replace(/\.\w+$/, "").slice(0, 80) })}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/assets/${p.assetId}`} alt={p.label} loading="lazy" className="aspect-[4/3] w-full bg-panel-2 object-cover" />
                    <span className="truncate p-1">{p.entityName ?? p.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {way === "treatment" && deck && (
        <TreatmentCropPicker projectId={projectId} entityId="" entityName="Look & Feel" entityKind="look" fileId={deck.fileId} initial={null} slides={deck.slides}
          onDone={onClose}
          onPick={async (crop) => {
            const r = await saveLookRef({ projectId, refId: null, data: { crop, title: `Treatment slide ${crop.slide}` } });
            if (r.ok) onAdded([r.id!]);
            return r.ok ? { ok: true } : { ok: false, error: r.error };
          }} />
      )}

      {way === "link" && (
        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void addExisting({ source_url: url.trim(), title: title.trim() || hostOf(url.trim()) || "Link" }); }}>
          <div className="grid gap-2 sm:grid-cols-[1fr_14rem_auto]">
            <input className="field" type="url" required placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Link" />
            <input className="field" placeholder="Title (optional)" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
            <button type="submit" className="btn-primary" disabled={busy}>Add link</button>
          </div>
          <p className="text-xs text-muted">A link stays a link: STUDIO doesn&apos;t open it, import its pictures or look inside it (a Pinterest board stays a board link). You can add the image yourself later.</p>
        </form>
      )}
    </div>
  );
}

// ---- One reference --------------------------------------------------------------------------
function RefDialog({ r, projectId, canEdit, entities, scenes, directions, onClose, onSaved, onRemoved, onMessage }: LookProps & {
  r: LookRef; onClose: () => void; onSaved: () => void; onRemoved: (n: number) => void; onMessage: (m: Msg) => void;
}) {
  const [v, setV] = useState({ title: r.title, tags: r.tags, reason: r.reason, useFor: r.useFor, leaveOut: r.leaveOut, applies: r.applies as Applies,
    status: r.status, attribution: r.attribution, permission: r.permission, palette: r.palette as PaletteColor[] });
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [sampling, setSampling] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pixels = useRef<{ data: Uint8ClampedArray; w: number; h: number } | null>(null);
  const dirty = JSON.stringify(v) !== JSON.stringify({ title: r.title, tags: r.tags, reason: r.reason, useFor: r.useFor, leaveOut: r.leaveOut, applies: r.applies,
    status: r.status, attribution: r.attribution, permission: r.permission, palette: r.palette });
  const inDirs = directions.filter((d) => d.referenceIds.includes(r.id));
  const access = accessOf(r);
  const firstField = useRef<HTMLTextAreaElement>(null);
  const showWhy = !r.reason && !r.tags.length;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    (showWhy && canEdit ? firstField.current : box.current)?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); prev?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (p: Partial<typeof v>) => { setV((x) => ({ ...x, ...p })); setSaved("idle"); };
  async function save(extra?: Partial<typeof v>) {
    const n = { ...v, ...extra };
    setSaved("saving"); setErr(null);
    const res = await saveLookRef({ projectId, refId: r.id, data: {
      title: n.title, tags: n.tags, reason: n.reason, use_for: n.useFor, leave_out: n.leaveOut, applies: n.applies, status: n.status,
      attribution: n.attribution, permission: n.permission, palette: n.palette } });
    if (!res.ok) { setSaved("error"); setErr(res.error); return; }
    setSaved("saved"); onSaved();
  }
  async function getPixels() {
    if (!r.assetId) throw new Error("Colors can only be read from an image in your film.");
    if (!pixels.current) pixels.current = await loadPixels(r.assetId);
    return pixels.current;
  }
  async function suggest() {
    try {
      const p = await getPixels();
      const hexes = suggestPalette(p.data, 6);
      const keep = v.palette.filter((c) => c.source !== "suggested");
      set({ palette: [...keep, ...hexes.filter((h) => !keep.some((c) => c.hex === h)).map((hex) => ({ hex, source: "suggested" as const }))].slice(0, 24) });
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't read the colors."); }
  }
  async function sample(e: React.MouseEvent<HTMLDivElement>) {
    if (!sampling) return;
    const img = (e.currentTarget.querySelector("img") as HTMLImageElement | null);
    if (!img) return;
    try {
      const p = await getPixels();
      const rect = img.getBoundingClientRect();
      // object-contain: find the drawn picture inside the element box
      const s = Math.min(rect.width / p.w, rect.height / p.h);
      const dw = p.w * s, dh = p.h * s, ox = rect.left + (rect.width - dw) / 2, oy = rect.top + (rect.height - dh) / 2;
      const x = (e.clientX - ox) / s, y = (e.clientY - oy) / s;
      if (x < 0 || y < 0 || x >= p.w || y >= p.h) return;
      const hex = sampleAt(p.data, p.w, p.h, x, y);
      if (v.palette.length < 24) set({ palette: [...v.palette, { hex, source: "sampled" }] });
    } catch (er) { setErr(er instanceof Error ? er.message : "Couldn't read that color."); }
  }
  async function attachImage(f: File) {
    setAttaching(true); setErr(null);
    try {
      const own = await lookOwner({ projectId });
      if (!own.ok || !own.id) throw new Error(own.ok ? "Couldn't start the upload." : own.error);
      const res = await addLookImage({ file: f, ownerEntityId: own.id, find: (sha) => findLookAsset({ projectId, sha256: sha }) });
      const s = await saveLookRef({ projectId, refId: r.id, data: { asset_id: res.assetId, thumb_asset_id: res.thumbAssetId } });
      if (!s.ok) throw new Error(s.error);
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : "Upload failed."); }
    finally { setAttaching(false); }
  }
  async function remove() {
    const res = await removeLookRef({ projectId, refId: r.id });
    if (!res.ok) { setErr(res.error); return; }
    onRemoved(res.n ?? 0);
  }
  const ro = !canEdit;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-2 sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="ref-dialog-h" className="panel flex w-full max-w-5xl flex-col gap-4 bg-panel p-4 outline-none sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <p className="eyebrow">Look &amp; Feel reference</p>
            {ro ? <h3 id="ref-dialog-h" className="display text-xl">{r.title}</h3>
              : <input id="ref-dialog-h" className="field display text-lg" value={v.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} aria-label="Title" />}
          </div>
          <button type="button" className="btn min-h-9 px-3 text-xs" onClick={onClose} aria-label="Close">Close</button>
        </div>
        <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
          <div className="flex flex-col gap-2">
            <div onClick={sample} className={sampling ? "cursor-crosshair outline-2 outline-brand" : ""}>
              <RefVisual r={r} large />
            </div>
            {access === "link" && <p className="text-xs">Link only: <a href={r.sourceUrl!} target="_blank" rel="noopener noreferrer nofollow" className="underline">{hostOf(r.sourceUrl)} ↗</a>. STUDIO hasn&apos;t opened or imported anything from it.</p>}
            {access === "treatment" && <p className="text-xs text-muted">A live window onto your treatment (nothing copied). Colors can&apos;t be read from it; add swatches by hand.</p>}
            {r.sourceUrl && access !== "link" && <p className="text-xs">Source: <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="underline">{hostOf(r.sourceUrl)} ↗</a></p>}
            {canEdit && (access === "link" || access === "missing") && (
              <label className="btn self-start text-xs">{attaching ? "Uploading…" : "Add the image"}
                <input type="file" accept="image/png,image/jpeg" className="sr-only" disabled={attaching} onChange={(e) => { const f = e.target.files?.[0]; if (f) void attachImage(f); e.target.value = ""; }} />
              </label>
            )}
            {inDirs.length > 0 && <p className="text-xs text-muted">In {inDirs.map((d) => d.name).join(", ")}.</p>}
          </div>

          <div className="flex flex-col gap-3">
            <fieldset className="flex flex-col gap-2" disabled={ro}>
              <legend className="mb-1 text-base font-semibold">What do you like about this?</legend>
              <div className="flex flex-wrap gap-1" role="group" aria-label="Suggestions (pick any)">
                {LOOK_TAGS.map(([k, label]) => {
                  const on = v.tags.includes(k as LookTag);
                  return <button key={k} type="button" aria-pressed={on} onClick={() => set({ tags: on ? v.tags.filter((t) => t !== k) : [...v.tags, k as LookTag] })}
                    className={`btn min-h-8 px-2 text-xs ${on ? "border-brand bg-brand/10" : ""}`}>{label}</button>;
                })}
              </div>
              <textarea ref={firstField} className="field min-h-20" maxLength={1000} value={v.reason} onChange={(e) => set({ reason: e.target.value })}
                placeholder="e.g. I like the soft shadows and muted greens." aria-label="In your own words" />
            </fieldset>

            <details open={!!(r.useFor || r.leaveOut || !r.applies.film)} className="border-t border-line pt-2">
              <summary className="cursor-pointer text-sm font-medium">More (optional): use for, leave out, applies to</summary>
              <div className="mt-2 flex flex-col gap-3">
                <label className="flex flex-col gap-1"><span className="label">Use this for</span>
                  <input className="field" maxLength={600} value={v.useFor} disabled={ro} onChange={(e) => set({ useFor: e.target.value })} placeholder="e.g. the color of the shadows" /></label>
                <label className="flex flex-col gap-1"><span className="label">Leave out</span>
                  <input className="field" maxLength={600} value={v.leaveOut} disabled={ro} onChange={(e) => set({ leaveOut: e.target.value })} placeholder="e.g. the furniture and the person's appearance" /></label>
                <AppliesPicker value={v.applies} onChange={(a) => set({ applies: a })} entities={entities} scenes={scenes} disabled={ro} />
                {ro && <p className="text-xs text-muted">{scopeLabel(v.applies, entities)}</p>}
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="flex flex-col gap-1"><span className="label">Who made it</span>
                    <input className="field" maxLength={300} value={v.attribution} disabled={ro} onChange={(e) => set({ attribution: e.target.value })} placeholder="if you know" /></label>
                  <label className="flex flex-col gap-1"><span className="label">Permission</span>
                    <input className="field" maxLength={300} value={v.permission} disabled={ro} onChange={(e) => set({ permission: e.target.value })} placeholder="e.g. my own drawing" /></label>
                </div>
              </div>
            </details>

            <div className="flex flex-col gap-2 border-t border-line pt-2">
              <p className="text-sm font-medium">Colors from this picture</p>
              <PaletteEditor colors={v.palette} onChange={(p) => set({ palette: p })} disabled={ro}
                extra={access === "image" ? (<>
                  <button type="button" className="btn min-h-8 px-2 text-xs" onClick={suggest}>Suggest colors</button>
                  <button type="button" aria-pressed={sampling} className={`btn min-h-8 px-2 text-xs ${sampling ? "border-brand bg-brand/10" : ""}`} onClick={() => setSampling((s) => !s)}>
                    {sampling ? "Click the picture… (done)" : "Pick a color from the picture"}</button>
                </>) : null} />
            </div>

            {err && <p role="alert" className="text-sm text-danger">{err}</p>}
            {canEdit && (
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <button type="button" className="btn-primary" onClick={() => save()} disabled={!dirty || saved === "saving"}>{saved === "saving" ? "Saving…" : "Save"}</button>
                {v.status === "approved"
                  ? <button type="button" className="btn" onClick={() => { set({ status: "proposed" }); void save({ status: "proposed" }); }}>Mark as proposed</button>
                  : <button type="button" className="btn" onClick={() => { set({ status: "approved" }); void save({ status: "approved" }); }}>Approve</button>}
                <span role="status" className="text-xs text-muted">{saved === "saved" ? "Saved." : dirty ? "Unsaved changes" : ""}</span>
                <span className="ml-auto">
                  {confirmRemove ? (
                    <span className="flex flex-wrap items-center gap-2 text-xs">
                      Remove from Look &amp; Feel{inDirs.length ? ` (and ${inDirs.length} direction${inDirs.length > 1 ? "s" : ""})` : ""}? The picture stays wherever else it&apos;s used.
                      <button type="button" className="btn min-h-8 px-2 text-xs text-danger" onClick={remove}>Remove</button>
                      <button type="button" className="btn min-h-8 px-2 text-xs" onClick={() => setConfirmRemove(false)}>Keep</button>
                    </span>
                  ) : <button type="button" className="text-xs text-danger underline" onClick={() => setConfirmRemove(true)}>Remove from collection</button>}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function useRefsById(refs: LookRef[]) { return useMemo(() => new Map(refs.map((r) => [r.id, r])), [refs]); }
