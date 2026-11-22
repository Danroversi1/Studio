"use client";
// STORYBOARDS · Compose. Build first, generate when needed: everything on this screen works
// without any AI model. Frames are editable compositions (layers + drawing + framing +
// look), rendered locally in the browser; edits autosave after a pause; "Save" records a
// version. AI lives in a secondary menu and only runs when she asks.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { addFrame, clearReview, duplicateFrame, moveFrame, removeFrame, saveComposition, saveFrameDetails, saveFrameNotes, saveVersion, setFrameState } from "@/app/projects/[projectId]/storyboard-actions";
import {
  FRAME_W, History, addLayer, cleanComposition, copyForNewFrame, duplicateLayers, emptyComposition, frameH, removeLayers, reorder, setAspect, tipFor, update,
  type Composition, type Layer,
} from "@/lib/storyboard/compose";
import { ASPECTS } from "@/lib/storyboard/camera";
import { download, exportPng, loadAll, renderComposition, type ImageState } from "@/lib/storyboard/render";
import { between, formatSeconds, sequenceTiming } from "@/lib/storyboard/shot";
import { ComposeCanvas, type Pen, type Tool } from "./compose-canvas";
import { AiMenu } from "./ai-menu";
import { AssetsPanel, CameraPanel, FramePanel, LayersPanel, LookPanel, ReferenceTray } from "./panels";
import { RefsPanel, lookFor, resolvedRefs } from "./look-refs";
import { RefVisual } from "@/components/look/parts";
import type { FilmEntity, FilmPicture } from "@/lib/look/data";
import type { DeviceRow } from "@/lib/local/types";
import type { LocalJob } from "@/app/projects/[projectId]/local-actions";
import { LocalGenerate } from "./local-generate";
import { TracePanel } from "./trace-panel";
import type { LookDirection, LookRef } from "@/lib/look/types";
import type { FilmItem, FrameRow, JobRow, LensPick, LibItem, StockRef } from "./types";
import type { ChatMessage } from "@/components/partner-chat";

type Tab = "assets" | "layers" | "trace" | "frame" | "camera" | "look" | "refs";
type SaveState = "saved" | "pending" | "saving" | "conflict" | "error";

/** Layers that use a library item draw its current image. */
export function resolveAssets(c: Composition, lib: LibItem[]): Composition {
  const byId = new Map(lib.map((i) => [i.id, i]));
  return { ...c, layers: c.layers.map((l) => (l.libraryId && byId.get(l.libraryId)?.assetId ? { ...l, assetId: byId.get(l.libraryId)!.assetId! } : l)) };
}

export function StoryboardStudio(props: {
  projectId: string; sequenceId: string; entityId: string; title: string; settings: { aspect?: number };
  frames: FrameRow[]; library: LibItem[]; jobs: JobRow[]; film: FilmItem[]; stocks: StockRef[]; lenses: LensPick[];
  lookRefs: LookRef[]; directions: LookDirection[]; lookEntities: FilmEntity[]; sequenceDirection: string | null;
  pictures: FilmPicture[]; devices: DeviceRow[]; localJobs: LocalJob[];
  canEdit: boolean; initialFrame?: string; initialTab?: Tab;
  ai: { imageMissing: string | null; textAvailable: string | null; builder: { threadId: string | null; messages: ChatMessage[]; opening: string } };
  scenes: { number: number; heading: string; text: string }[];
}) {
  const { projectId, sequenceId, canEdit, library } = props;
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const [frames, setFrames] = useState<FrameRow[]>(props.frames);
  const [selId, setSelId] = useState<string | null>(props.initialFrame && props.frames.some((f) => f.id === props.initialFrame) ? props.initialFrame : props.frames[0]?.id ?? null);
  const [layerSel, setLayerSel] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>(props.initialTab ?? "assets");
  const [tool, setTool] = useState<Tool>("select");
  const [pen, setPen] = useState<Pen>({ color: "#111111", width: 6 });
  const [showLook, setShowLook] = useState(true);
  const [tray, setTray] = useState(true);
  /** A Look & Feel reference shown over the canvas as a tracing guide (never exported). */
  const [trace, setTrace] = useState<{ ref: LookRef; opacity: number } | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "notice"; text: string } | null>(null);
  const [save, setSave] = useState<Record<string, SaveState>>({});
  const [images, setImages] = useState<Map<string, ImageState>>(new Map());
  const [, force] = useState(0);
  const histories = useRef(new Map<string, History>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const versions = useRef(new Map<string, number>(props.frames.map((f) => [f.id, f.compositionVersion])));
  const dirty = useRef(new Set<string>());
  const framesRef = useRef(frames);
  framesRef.current = frames;

  // Adopt server data after a refresh, but never overwrite unsaved local edits.
  useEffect(() => {
    setFrames((cur) => props.frames.map((f) => {
      const mine = cur.find((x) => x.id === f.id);
      if (mine && dirty.current.has(f.id)) return { ...f, composition: mine.composition, compositionVersion: versions.current.get(f.id) ?? f.compositionVersion };
      versions.current.set(f.id, f.compositionVersion);
      return f;
    }));
    if (selId && !props.frames.some((f) => f.id === selId)) setSelId(props.frames[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.frames]);

  const frame = frames.find((f) => f.id === selId) ?? null;
  const index = frame ? frames.indexOf(frame) : -1;
  const comp = useMemo(() => (frame ? resolveAssets(frame.composition, library) : emptyComposition()), [frame, library]);
  const frameLook = frame ? lookFor(frame, props.sequenceDirection, props.directions, props.lookRefs, props.lookEntities, library) : null;
  const frameLookRefs = frameLook ? resolvedRefs(frameLook, props.lookRefs) : [];
  const frameLookLabel = !frameLook ? "" : frameLook.kind === "direction" ? frameLook.direction.name : frameLook.kind === "references" ? "Chosen for this frame"
    : frameLook.kind === "conflict" ? "Choose a direction (Refs tab)" : "";
  const history = useMemo(() => { if (!selId) return new History(); let h = histories.current.get(selId); if (!h) { h = new History(); histories.current.set(selId, h); } return h; }, [selId]);
  const editable = canEdit && !!frame && !frame.locked;

  // Load images for every frame (thumbnails) once; cached per page.
  const allAssetIds = useMemo(() => [...new Set(frames.flatMap((f) => resolveAssets(f.composition, library).layers.map((l) => l.assetId).filter((x): x is string => !!x)))], [frames, library]);
  useEffect(() => {
    const missing = allAssetIds.filter((id) => !images.has(id));
    if (!missing.length) return;
    let live = true;
    loadAll(missing).then((m) => { if (live) setImages((prev) => new Map([...prev, ...m])); });
    return () => { live = false; };
  }, [allAssetIds, images]);

  const refresh = useCallback(() => startRefresh(() => router.refresh()), [router]);

  // ---- Autosave (debounced, only after completed edits) ---------------------------------
  const flush = useCallback(async (id: string) => {
    const t = timers.current.get(id); if (t) { clearTimeout(t); timers.current.delete(id); }
    if (!dirty.current.has(id)) return;
    const f = framesRef.current.find((x) => x.id === id);
    if (!f) return;
    setSave((s) => ({ ...s, [id]: "saving" }));
    const sent = JSON.stringify(f.composition);
    const r = await saveComposition({ shotId: id, composition: f.composition, expectedVersion: versions.current.get(id) ?? f.compositionVersion }).catch(() => ({ ok: false as const, error: "Couldn't reach Studio. Your changes are still here; they'll save when you're back online." }));
    if (r.ok) {
      versions.current.set(id, r.n ?? 0);
      const now = framesRef.current.find((x) => x.id === id);
      if (now && JSON.stringify(now.composition) === sent) { dirty.current.delete(id); setSave((s) => ({ ...s, [id]: "saved" })); }
      else schedule(id);
    } else {
      setSave((s) => ({ ...s, [id]: "conflict" in r && r.conflict ? "conflict" : "error" }));
      setMsg({ kind: "error", text: r.error });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const schedule = useCallback((id: string) => {
    dirty.current.add(id);
    setSave((s) => ({ ...s, [id]: "pending" }));
    const t = timers.current.get(id); if (t) clearTimeout(t);
    timers.current.set(id, setTimeout(() => void flush(id), 1200));
  }, [flush]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => { if (dirty.current.size) { e.preventDefault(); e.returnValue = ""; } };
    const hide = () => { if (document.visibilityState === "hidden") for (const id of dirty.current) void flush(id); };
    window.addEventListener("beforeunload", before);
    document.addEventListener("visibilitychange", hide);
    return () => { window.removeEventListener("beforeunload", before); document.removeEventListener("visibilitychange", hide); };
  }, [flush]);

  /** Apply an edit to the selected frame. commit → history + autosave. */
  const setComp = useCallback((next: Composition, commit: false | { before: Composition }) => {
    if (!selId) return;
    setFrames((fs) => fs.map((f) => (f.id === selId ? { ...f, composition: next } : f)));
    if (commit) { history.push(commit.before); force((n) => n + 1); schedule(selId); }
  }, [selId, history, schedule]);
  const edit = useCallback((f: (c: Composition) => Composition) => {
    if (!frame || !editable) return;
    const before = frame.composition;
    const next = f(before);
    if (next !== before) setComp(next, { before });
  }, [frame, editable, setComp]);

  const undo = () => { if (!frame) return; const p = history.undo(frame.composition); if (p) { setFrames((fs) => fs.map((f) => (f.id === frame.id ? { ...f, composition: p } : f))); schedule(frame.id); force((n) => n + 1); } };
  const redo = () => { if (!frame) return; const p = history.redo(frame.composition); if (p) { setFrames((fs) => fs.map((f) => (f.id === frame.id ? { ...f, composition: p } : f))); schedule(frame.id); force((n) => n + 1); } };

  async function selectFrame(id: string) {
    if (selId && dirty.current.has(selId)) void flush(selId);
    setSelId(id); setLayerSel([]); setTool("select");
    const url = new URL(window.location.href); url.searchParams.set("frame", id); window.history.replaceState(null, "", url);
  }

  // ---- Frame operations ---------------------------------------------------------------
  async function run<T extends { ok: boolean; error?: string }>(p: Promise<T>, ok?: string): Promise<T | null> {
    setMsg(null);
    const r = await p.catch(() => null);
    if (!r) { setMsg({ kind: "error", text: "That didn't save. Check the connection and try again." }); return null; }
    if (!r.ok) { setMsg({ kind: "error", text: r.error ?? "That didn't work." }); return null; }
    if (ok) setMsg({ kind: "notice", text: ok });
    refresh();
    return r;
  }
  async function addAFrame() {
    const i = index >= 0 ? index : frames.length - 1;
    const pos = frames.length ? between(frames[i]?.position ?? null, frames[i + 1]?.position ?? null) : null;
    const r = await run(addFrame({ projectId, sequenceId, position: pos, composition: emptyComposition(comp.aspect || props.settings.aspect || 16 / 9) }));
    if (r && "id" in r && r.id) setSelId(r.id as string);
  }
  async function dupFrame() {
    if (!frame) return;
    if (dirty.current.has(frame.id)) await flush(frame.id);
    const r = await run(duplicateFrame({ shotId: frame.id, composition: copyForNewFrame(frame.composition) }), "Frame duplicated. Change what's different in the next shot.");
    if (r && "id" in r && r.id) setSelId(r.id as string);
  }
  async function moveF(f: FrameRow, dir: -1 | 1) {
    const i = frames.indexOf(f), j = i + dir;
    if (j < 0 || j >= frames.length) return;
    const pos = dir < 0 ? between(frames[j - 1]?.position ?? null, frames[j].position) : between(frames[j].position, frames[j + 1]?.position ?? null);
    setFrames((fs) => [...fs.map((x) => (x.id === f.id ? { ...x, position: pos } : x))].sort((a, b) => a.position - b.position));
    await run(moveFrame({ shotId: f.id, position: pos }));
  }
  async function saveNow() {
    if (!frame) return;
    await flush(frame.id);
    const r = await run(saveVersion({ shotId: frame.id }));
    if (r && "n" in r) setMsg({ kind: "notice", text: `Saved as version ${r.n}. You can bring back any saved version from the Frame panel.` });
  }
  async function exportThis(width: number) {
    if (!frame) return;
    const res = await exportPng(resolveAssets(frame.composition, library), width);
    if (res.blob) download(res.blob, `${props.title.replace(/[^\w -]/g, "") || "storyboard"} - frame ${index + 1}.png`);
    else setMsg({ kind: "error", text: `Frame ${index + 1} couldn't be exported: ${res.problems.join("; ")}. Nothing was changed; remove or replace that layer and try again.` });
  }
  async function exportAll(width: number) {
    const problems: string[] = [];
    for (let i = 0; i < frames.length; i++) {
      const res = await exportPng(resolveAssets(frames[i].composition, library), width);
      if (res.blob) { download(res.blob, `${props.title.replace(/[^\w -]/g, "") || "storyboard"} - frame ${i + 1}.png`); await new Promise((r) => setTimeout(r, 350)); }
      else problems.push(`frame ${i + 1}: ${res.problems.join("; ")}`);
    }
    setMsg(problems.length ? { kind: "error", text: `Some frames couldn't be exported (${problems.join(" · ")}). The others were downloaded.` } : { kind: "notice", text: `Downloaded ${frames.length} PNG frames.` });
  }

  // ---- Keyboard ------------------------------------------------------------------------
  function keys(e: React.KeyboardEvent) {
    if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
    if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); void saveNow(); return; }
    if (!editable) return;
    if (mod && e.key.toLowerCase() === "d" && layerSel.length) { e.preventDefault(); edit((c) => { const r = duplicateLayers(c, layerSel); setLayerSel(r.ids); return r.comp; }); return; }
    if ((e.key === "Delete" || e.key === "Backspace") && layerSel.length) { e.preventDefault(); edit((c) => removeLayers(c, layerSel)); setLayerSel([]); return; }
    if (e.key === "Escape") { setLayerSel([]); setTool("select"); return; }
    if (e.key === "[" || e.key === "]") { edit((c) => reorder(c, layerSel, e.key === "]" ? "up" : "down")); return; }
    const step = e.shiftKey ? 20 : 4;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (d && layerSel.length) { e.preventDefault(); edit((c) => update(c, layerSel, (l) => (l.locked ? {} : { x: l.x + d[0], y: l.y + d[1] }))); }
  }

  const timing = sequenceTiming(frames);
  const st = frame ? save[frame.id] ?? "saved" : "saved";
  const unsavedLabel = { saved: "All changes saved", pending: "Unsaved changes…", saving: "Saving…", conflict: "Changed elsewhere: reload", error: "Not saved yet" }[st];
  const selLayers = comp.layers.filter((l) => layerSel.includes(l.id));

  function addText(caption: boolean) {
    edit((c) => {
      const H = frameH(c);
      const r = addLayer(c, caption
        ? { type: "text", name: "Dialogue caption", text: "Line of dialogue", fontSize: 44, color: "#111111", box: true, align: "left", x: FRAME_W / 2, y: H * 0.85, w: FRAME_W * 0.6, h: 120, rot: 0 }
        : { type: "text", name: "Text", text: "Text", fontSize: 64, color: "#111111", align: "center", x: FRAME_W / 2, y: H / 2, w: 600, h: 120, rot: 0 });
      setLayerSel([r.id]); setTab("layers");
      return r.comp;
    });
  }

  return (
    <div className="flex flex-col gap-3" onKeyDown={keys}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Link href={`/projects/${projectId}/storyboards`} className="eyebrow hover:text-text">← Storyboards</Link>
          <h1 className="display truncate text-3xl leading-none sm:text-4xl">{props.title}</h1>
          <p className="text-sm text-muted">{frames.length} {frames.length === 1 ? "frame" : "frames"} · {timing.label} · durations are proposals</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {frame && <LocalGenerate projectId={projectId} sequenceId={sequenceId} entityId={props.entityId} frame={frame} frameIndex={index} comp={comp} canEdit={canEdit}
            library={library} entities={props.lookEntities} pictures={props.pictures} lookRefs={props.lookRefs} directions={props.directions}
            sequenceDirection={props.sequenceDirection} lenses={props.lenses} devices={props.devices} jobs={props.localJobs} onMessage={setMsg} onChanged={refresh} />}
          {canEdit && <button type="button" className={frame ? "btn" : "btn-primary"} onClick={addAFrame}>Add a Frame</button>}
          <ExportMenu disabled={!frame} onPng={exportThis} onAll={exportAll} pdfHref={`/print/storyboards/${sequenceId}`} jsonHref={`/api/storyboards/${sequenceId}/export`} />
          <AiMenu projectId={projectId} sequenceId={sequenceId} entityId={props.entityId} frame={frame} comp={comp} library={library} film={props.film} scenes={props.scenes}
            canEdit={canEdit} ai={props.ai} jobs={props.jobs} onDone={refresh} onMessage={setMsg} lookRefs={frameLookRefs}
            onAddFrames={async (items) => {
              let pos = frames.length ? frames[frames.length - 1].position : 0;
              for (const it of items) { pos += 1000; await addFrame({ projectId, sequenceId, position: pos, content: it, composition: emptyComposition(comp.aspect), origin: "agent" }); }
              setMsg({ kind: "notice", text: `Added ${items.length} suggested ${items.length === 1 ? "frame" : "frames"} as proposals. Compose them, then approve the ones you keep.` });
              refresh();
            }} />
        </div>
      </header>
      {msg && <p role={msg.kind === "error" ? "alert" : "status"} className={`panel px-4 py-2.5 text-sm ${msg.kind === "error" ? "border-danger text-danger" : ""}`}>{msg.text}</p>}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[11rem_minmax(0,1fr)] xl:grid-cols-[11rem_minmax(0,1fr)_22rem]">
        {/* Sequence thumbnails */}
        <nav aria-label="Frames" className="panel flex flex-col">
          <ol className="flex gap-2 overflow-x-auto p-2 lg:max-h-[78vh] lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden">
            {frames.map((f, i) => (
              <li key={f.id} className="w-36 shrink-0 lg:w-auto">
                <button type="button" onClick={() => selectFrame(f.id)} aria-current={f.id === selId ? "true" : undefined}
                  className={`block w-full border-2 text-left ${f.id === selId ? "border-brand" : "border-transparent hover:border-line"}`}>
                  <Thumb comp={resolveAssets(f.id === selId ? comp : f.composition, library)} images={images} />
                  <span className="flex items-center justify-between px-1 py-0.5 text-[11px]">
                    <b>{i + 1}</b>
                    <span className="flex gap-1">
                      {f.content.durationS ? <span className="text-muted">{formatSeconds(f.content.durationS)}</span> : null}
                      {f.state === "approved" && <span title="Approved">✓</span>}
                      {f.locked && <span title="Locked">🔒</span>}
                      {f.review && <span className="text-danger" title="Needs a look">!</span>}
                      {f.origin === "agent" && <span className="text-muted" title="Suggested">S</span>}
                      {(save[f.id] === "pending" || save[f.id] === "saving") && <span className="text-muted" title="Saving">•</span>}
                    </span>
                  </span>
                </button>
                {canEdit && (
                  <span className="flex justify-between px-1">
                    <button type="button" className="text-xs text-muted hover:text-text disabled:opacity-30" onClick={() => moveF(f, -1)} disabled={i === 0} aria-label={`Move frame ${i + 1} earlier`}>↑</button>
                    <button type="button" className="text-xs text-muted hover:text-text disabled:opacity-30" onClick={() => moveF(f, 1)} disabled={i === frames.length - 1} aria-label={`Move frame ${i + 1} later`}>↓</button>
                  </span>
                )}
              </li>
            ))}
          </ol>
          {canEdit && <button type="button" className="btn m-2 hidden lg:inline-flex" onClick={addAFrame}>+ Add a Frame</button>}
        </nav>

        {/* Canvas */}
        <section aria-label="Selected frame" className="flex min-w-0 flex-col gap-2">
          {frame ? (
            <>
              <div className="panel flex flex-wrap items-center gap-1 p-1.5" role="toolbar" aria-label="Compose tools">
                <ToolBtn on={tool === "select"} onClick={() => setTool("select")} label="Select" />
                <ToolBtn on={tool === "draw"} onClick={() => setTool("draw")} label="Draw" disabled={!editable} />
                <ToolBtn on={tool === "erase"} onClick={() => setTool("erase")} label="Erase" disabled={!editable} />
                {(tool === "draw" || tool === "erase") && (
                  <span className="flex items-center gap-1 px-1 text-xs">
                    {tool === "draw" && <input type="color" value={pen.color} onChange={(e) => setPen({ ...pen, color: e.target.value })} aria-label="Pen color" className="size-8" />}
                    <input type="range" min={1} max={40} value={pen.width} onChange={(e) => setPen({ ...pen, width: Number(e.target.value) })} aria-label="Pen size" />
                  </span>
                )}
                <span className="mx-1 h-6 border-l border-line" />
                <button type="button" className="btn min-h-9 px-2.5 text-xs" onClick={() => addText(false)} disabled={!editable}>Text</button>
                <button type="button" className="btn min-h-9 px-2.5 text-xs" onClick={() => addText(true)} disabled={!editable}>Caption</button>
                <button type="button" className="btn min-h-9 px-2.5 text-xs" onClick={() => setTab("assets")} disabled={!editable}>Add Asset</button>
                <span className="mx-1 h-6 border-l border-line" />
                <button type="button" className="btn min-h-9 px-2.5 text-xs" onClick={undo} disabled={!editable || !history.canUndo} aria-label="Undo (Ctrl+Z)">↶ Undo</button>
                <button type="button" className="btn min-h-9 px-2.5 text-xs" onClick={redo} disabled={!editable || !history.canRedo} aria-label="Redo (Ctrl+Shift+Z)">↷ Redo</button>
                <span className="mx-1 h-6 border-l border-line" />
                <select className="field w-auto py-1 text-xs" value={comp.grid} onChange={(e) => edit((c) => ({ ...c, grid: e.target.value as Composition["grid"] }))} aria-label="Composition grid" disabled={!editable}>
                  <option value="thirds">Grid: thirds</option><option value="center">Grid: centre</option><option value="safe">Grid: safe areas</option><option value="none">No grid</option>
                </select>
                <select className="field w-auto py-1 text-xs" value={ASPECTS.find((a) => Math.abs(a.ratio - comp.aspect) < 0.01)?.ratio ?? comp.aspect} disabled={!editable}
                  onChange={(e) => edit((c) => setAspect(c, Number(e.target.value)))} aria-label="Aspect ratio">
                  {ASPECTS.map((a) => <option key={a.id} value={a.ratio}>{a.label}</option>)}
                  <option value={1}>1:1</option><option value={9 / 16}>9:16 (vertical)</option>
                </select>
                <label className="flex items-center gap-1 px-1 text-xs"><input type="checkbox" checked={showLook} onChange={(e) => setShowLook(e.target.checked)} /> Look</label>
                <span className="ml-auto flex items-center gap-2">
                  <span className={`text-xs ${st === "conflict" || st === "error" ? "text-danger" : "text-muted"}`} role="status">{unsavedLabel}</span>
                  {canEdit && <button type="button" className="btn min-h-9 px-2.5 text-xs" onClick={dupFrame}>Duplicate</button>}
                  {canEdit && <button type="button" className="btn-primary min-h-9 px-3 text-xs" onClick={saveNow}>Save</button>}
                </span>
              </div>
              {frame.locked && <p className="help">This frame is locked. Unlock it in the Frame panel to change it.</p>}
              <div className="relative">
                <ComposeCanvas comp={comp} images={images} selected={layerSel} tool={tool} pen={pen} showLook={showLook} editable={editable}
                  onChange={(next, commit) => setComp(next, commit)} onSelect={setLayerSel}
                  onTextEdit={(id) => { setLayerSel([id]); setTab("layers"); setTimeout(() => document.getElementById(`text-${id}`)?.focus(), 50); }} />
                {trace && (
                  <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ opacity: trace.opacity }} aria-hidden>
                    <RefVisual r={trace.ref} large className="!max-h-none size-full object-contain" />
                  </div>
                )}
              </div>
              {trace && (
                <div className="flex flex-wrap items-center gap-2 text-xs" role="group" aria-label="Tracing guide">
                  <span>Tracing guide: <b>{trace.ref.title}</b> (not part of the frame, not exported)</span>
                  <label className="flex items-center gap-1">Opacity <input type="range" min={0.1} max={0.9} step={0.05} value={trace.opacity}
                    onChange={(e) => setTrace({ ...trace, opacity: Number(e.target.value) })} aria-label="Tracing guide opacity" /></label>
                  <button type="button" className="btn min-h-8 px-2 text-xs" onClick={() => setTrace(null)}>Hide</button>
                </div>
              )}
              <p className="text-xs text-muted">Tip: {tipFor(comp)} <span className="hidden sm:inline">Shortcuts: drag to move · corners to scale · circle to rotate · Shift = free scale · Alt = no snapping · arrows nudge · Ctrl+D duplicate · Delete removes · Ctrl+Z undo.</span></p>
              {frame.illustrationAssetId && (
                <details className="panel p-2 text-sm">
                  <summary className="cursor-pointer">Generated picture shown on this frame</summary>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/assets/${frame.illustrationAssetId}`} alt={`Illustration of frame ${index + 1}`} className="mt-2 w-full" />
                  <p className="mt-1 text-xs text-muted">A separate result linked to this frame (from Generate Locally or AI assist). Your editable composition above is unchanged.</p>
                </details>
              )}
              <ReferenceTray open={tray} onToggle={() => setTray((v) => !v)} library={library} editable={editable}
                onPlace={(it) => placeLibrary(it)}
                look={{ refs: frameLookRefs, label: frameLookLabel, tracing: trace?.ref.id ?? null,
                  onTrace: (r) => setTrace(r ? { ref: r, opacity: 0.35 } : null), onPlace: placeLookRef, onOpen: () => setTab("refs") }} />
            </>
          ) : <div className="panel help p-6">No frames yet. Press <b>Add a Frame</b> to start.</div>}
        </section>

        {/* Panels */}
        <aside aria-label="Assets, layers, frame, camera and look" className="panel flex min-w-0 flex-col lg:col-span-2 xl:col-span-1">
          <div role="tablist" aria-label="Panels" className="grid grid-cols-7 border-b border-line">
            {(["assets", "layers", "trace", "frame", "camera", "look", "refs"] as const).map((t) => (
              <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)}
                className={`min-h-11 px-1 text-[11px] font-medium ${tab === t ? "bg-text text-panel-2" : "text-muted hover:text-text"}`}>{t}</button>
            ))}
          </div>
          <div role="tabpanel" className="flex max-h-[78vh] flex-col gap-3 overflow-y-auto p-3">
            {!frame ? <p className="help">Add a frame first.</p> : tab === "assets" ? (
              <AssetsPanel projectId={projectId} entityId={props.entityId} library={library} film={props.film} editable={editable} canEdit={canEdit} comp={comp}
                onPlaceShape={(s) => edit((c) => { const H = frameH(c); const h = s.group === "Figures" ? H * 0.6 : s.group === "Set" ? H * 0.45 : H * 0.25;
                  const r = addLayer(c, { type: "shape", name: s.name, shape: s.id, fill: s.fill, x: FRAME_W / 2, y: H / 2, w: h * s.ratio, h, rot: 0 }); setLayerSel([r.id]); return r.comp; })}
                onPlaceItem={placeLibrary} onChanged={refresh} onMessage={setMsg}
                onDrawingToLibrary={selLayers.length === 1 && selLayers[0].type === "drawing" ? () => drawingToLibrary(selLayers[0]) : undefined} />
            ) : tab === "layers" ? (
              <LayersPanel comp={comp} selected={layerSel} editable={editable} library={library} onSelect={setLayerSel} edit={edit} />
            ) : tab === "trace" ? (
              <TracePanel comp={comp} selected={layerSel} images={images} directions={props.directions} editable={editable}
                frameDirectionId={frameLook?.kind === "direction" ? frameLook.direction.id : props.sequenceDirection}
                onTraceOver={traceOver} onPlace={placeTrace} />
            ) : tab === "frame" ? (
              <FramePanel key={`${frame.id}:${frame.revision}`} frame={frame} number={index + 1} canEdit={canEdit}
                onSave={(content) => run(saveFrameDetails({ sequenceId, shotId: frame.id, content, expectedRevision: frame.revision }), "Frame details saved.")}
                onNotes={(notes) => run(saveFrameNotes({ shotId: frame.id, notes }), "Notes saved.")}
                onState={(state, locked) => run(setFrameState({ shotId: frame.id, state, locked }))}
                onClearReview={() => run(clearReview({ shotId: frame.id }))}
                onRemove={async () => { const r = await run(removeFrame({ shotId: frame.id }), "Frame removed."); if (r) setSelId(frames.find((f) => f.id !== frame.id)?.id ?? null); }}
                onRestored={refresh} />
            ) : tab === "refs" ? (
              <RefsPanel projectId={projectId} sequenceId={sequenceId} frame={frame} canEdit={canEdit} entities={props.lookEntities} film={props.film} library={library}
                lookRefs={props.lookRefs} directions={props.directions} sequenceDirection={props.sequenceDirection} tracing={trace?.ref.id ?? null}
                onTrace={(r) => setTrace(r ? { ref: r, opacity: 0.35 } : null)} onPlace={placeLookRef} onChanged={refresh} onMessage={setMsg}
                onSaveContent={(content) => run(saveFrameDetails({ sequenceId, shotId: frame.id, content, expectedRevision: frame.revision }), "Frame details saved.")} />
            ) : tab === "camera" ? (
              <CameraPanel comp={comp} frame={frame} editable={editable} canEdit={canEdit} edit={edit}
                projectId={projectId} lenses={props.lenses} frames={frames} onLensesChanged={refresh} onMessage={setMsg}
                onSaveContent={(content) => run(saveFrameDetails({ sequenceId, shotId: frame.id, content, expectedRevision: frame.revision }), "Camera notes saved.")} />
            ) : (
              <LookPanel comp={comp} editable={editable} edit={edit} stocks={props.stocks} frames={frames.length}
                onApplyAll={async () => {
                  const look = comp.look;
                  setFrames((fs) => fs.map((f) => (f.locked ? f : { ...f, composition: { ...f.composition, look: { ...look, grain: { ...look.grain } } } })));
                  for (const f of frames) if (!f.locked && f.id !== frame.id) schedule(f.id);
                  setMsg({ kind: "notice", text: `Look applied to ${frames.filter((f) => !f.locked).length} unlocked frames (locked frames kept theirs).` });
                }} />
            )}
          </div>
        </aside>
      </div>
    </div>
  );

  /** Trace over a picture: fade and lock it, add a drawing layer above it, pen ready. */
  function traceOver(sourceId: string) {
    let drawId = "";
    edit((c) => {
      const H = frameH(c);
      const faded = { ...c, layers: c.layers.map((l) => (l.id === sourceId ? { ...l, opacity: Math.min(l.opacity ?? 1, 0.35), locked: true } : l)) };
      const r = addLayer(faded, { type: "drawing", name: "Your lines", x: FRAME_W / 2, y: H / 2, w: FRAME_W, h: H, rot: 0, strokes: [] });
      drawId = r.id;
      return r.comp;
    });
    if (drawId) { setLayerSel([drawId]); setTool("draw"); }
    setMsg({ kind: "notice", text: "Tracing: the picture is faded and locked; draw your lines on the new layer. Unlock or hide the picture in Layers when you're done." });
  }

  /** Add a tracing result as a new layer right above its source, in the same place. */
  async function placeTrace(sourceId: string, blob: Blob, name: string) {
    const { uploadImage } = await import("@/lib/storyboard/upload");
    const assetId = await uploadImage(props.entityId, blob, "trace.png");
    const loaded = await loadAll([assetId]);
    setImages((prev) => new Map([...prev, ...loaded]));
    edit((c) => {
      const src = c.layers.find((l) => l.id === sourceId);
      if (!src) return c;
      const r = addLayer(c, { type: "image", name: name.slice(0, 120), assetId, x: src.x, y: src.y, w: src.w, h: src.h, rot: src.rot, flipX: src.flipX, flipY: src.flipY });
      const layers = [...r.comp.layers];
      const added = layers.pop()!;
      layers.splice(layers.findIndex((l) => l.id === sourceId) + 1, 0, added);
      setLayerSel([r.id]);
      return { ...r.comp, layers };
    });
  }

  /** Only on her explicit action: put a Look & Feel image into the frame as a layer. */
  function placeLookRef(r: LookRef) {
    if (!r.assetId) { setMsg({ kind: "notice", text: `“${r.title}” has no image in your film, so it can't be placed.` }); return; }
    const st = images.get(r.assetId);
    const ratio = st?.ok ? st.img.naturalWidth / st.img.naturalHeight : 4 / 3;
    edit((c) => {
      const H = frameH(c);
      const w = Math.max(FRAME_W, H * ratio);
      const res = addLayer(c, { type: "image", name: `${r.title} (Look & Feel)`, assetId: r.assetId!, x: FRAME_W / 2, y: H / 2, w, h: w / ratio, rot: 0, opacity: 0.5 });
      setLayerSel([res.id]);
      return reorder(res.comp, [res.id], "back");
    });
    if (!st) void loadAll([r.assetId]).then((m) => setImages((prev) => new Map([...prev, ...m])));
    setMsg({ kind: "notice", text: `“${r.title}” placed as a half-transparent layer at the back. It's part of this frame now (and exports); remove it in Layers anytime.` });
  }

  function placeLibrary(it: LibItem) {
    if (!it.assetId || it.usage !== "composition") { setMsg({ kind: "notice", text: `“${it.name}” is a reference only. It stays in the tray; it isn't placed in exported frames.` }); return; }
    const st = images.get(it.assetId);
    const ratio = st?.ok ? st.img.naturalWidth / st.img.naturalHeight : 1;
    edit((c) => {
      const H = frameH(c);
      const bg = it.kind === "background";
      const h = bg ? H : it.kind === "prop" ? H * 0.25 : H * 0.6;
      const w = bg ? Math.max(FRAME_W, H * ratio) : h * ratio;
      const r = addLayer(c, { type: "image", name: it.name, libraryId: it.id, assetId: it.assetId!, x: FRAME_W / 2, y: H / 2, w, h: bg ? w / ratio : h, rot: 0 });
      const comp2 = bg ? reorder(r.comp, [r.id], "back") : r.comp;
      setLayerSel([r.id]);
      return comp2;
    });
    if (!st) void loadAll([it.assetId]).then((m) => setImages((prev) => new Map([...prev, ...m])));
  }

  async function drawingToLibrary(l: Layer) {
    try {
      const c = cleanComposition({ ...emptyComposition(l.w / l.h), bg: "#00000000", layers: [{ ...l, x: FRAME_W / 2, y: FRAME_W / (l.w / l.h) / 2, w: FRAME_W, h: FRAME_W / (l.w / l.h), rot: 0 }] });
      const canvas = document.createElement("canvas");
      renderComposition(canvas, { ...c, bg: "rgba(0,0,0,0)" }, new Map(), 1600, { look: false });
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      if (!blob) throw new Error("The drawing couldn't be saved.");
      const { uploadImage } = await import("@/lib/storyboard/upload");
      const assetId = await uploadImage(props.entityId, blob, `${l.name || "Drawing"}.png`);
      const { saveLibraryItem } = await import("@/app/projects/[projectId]/storyboard-actions");
      const r = await saveLibraryItem({ projectId, itemId: null, data: { kind: "drawing", name: l.name || "Drawing", asset_id: assetId, usage: "composition", views: "As drawn" } });
      setMsg(r.ok ? { kind: "notice", text: "Drawing saved to your asset library. Place it in any frame." } : { kind: "error", text: r.error });
      refresh();
    } catch (e) { setMsg({ kind: "error", text: e instanceof Error ? e.message : "The drawing couldn't be saved." }); }
  }
}

function ToolBtn({ on, onClick, label, disabled }: { on: boolean; onClick: () => void; label: string; disabled?: boolean }) {
  return <button type="button" aria-pressed={on} onClick={onClick} disabled={disabled} className={`btn min-h-9 px-2.5 text-xs ${on ? "btn-primary" : ""}`}>{label}</button>;
}

function Thumb({ comp, images }: { comp: Composition; images: Map<string, ImageState> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const t = setTimeout(() => { if (ref.current) renderComposition(ref.current, comp, images, 220, { look: true, preview: true }); }, 60);
    return () => clearTimeout(t);
  }, [comp, images]);
  return <canvas ref={ref} className="block h-auto w-full bg-white" aria-hidden />;
}

function ExportMenu({ disabled, onPng, onAll, pdfHref, jsonHref }: { disabled: boolean; onPng: (w: number) => void; onAll: (w: number) => void; pdfHref: string; jsonHref: string }) {
  const [width, setWidth] = useState(1920);
  return (
    <details className="relative">
      <summary className="btn list-none">Export</summary>
      <div className="panel absolute right-0 z-20 mt-1 flex w-64 flex-col gap-2 p-3 text-sm shadow-lg">
        <label className="flex items-center justify-between gap-2 text-xs">PNG width
          <select className="field w-auto py-1 text-xs" value={width} onChange={(e) => setWidth(Number(e.target.value))}>
            <option value={1280}>1280 px</option><option value={1920}>1920 px</option><option value={3840}>3840 px</option>
          </select>
        </label>
        <button type="button" className="btn" disabled={disabled} onClick={() => onPng(width)}>This frame (PNG)</button>
        <button type="button" className="btn" onClick={() => onAll(width)}>Every frame (PNGs)</button>
        <a className="btn" href={pdfHref} target="_blank" rel="noreferrer">Storyboard PDF</a>
        <a className="btn" href={jsonHref} download>Shot list + compositions (JSON)</a>
        <p className="text-xs text-muted">Rendered here in your browser from your latest edits. No AI is used.</p>
      </div>
    </details>
  );
}
