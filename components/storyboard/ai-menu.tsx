"use client";
// Optional AI assistance, behind a secondary menu. Nothing here runs unless she presses its
// button; each action says what it sends, where, and what it costs when that's known.
import { useState } from "react";
import { PartnerChat, type ChatMessage } from "@/components/partner-chat";
import type { Composition } from "@/lib/storyboard/compose";
import { exportPng } from "@/lib/storyboard/render";
import type { ShotContent } from "@/lib/storyboard/shot";
import { uploadImage } from "@/lib/storyboard/upload";
import type { LookRef } from "@/lib/look/types";
import type { FilmItem, FrameRow, JobRow, LibItem } from "./types";

type Msg = (m: { kind: "error" | "notice"; text: string } | null) => void;
type Suggestion = { action: string; why?: string; size?: string; angle?: string; durationS?: number; source?: ShotContent["source"]; keep: boolean };

export function AiMenu({ projectId, sequenceId, entityId, frame, comp, film, scenes, canEdit, ai, jobs, onDone, onMessage, onAddFrames, lookRefs = [] }: {
  projectId: string; sequenceId: string; entityId: string; frame: FrameRow | null; comp: Composition; library: LibItem[]; film: FilmItem[];
  scenes: { number: number; heading: string; text: string }[]; canEdit: boolean; jobs: JobRow[];
  ai: { imageMissing: string | null; textAvailable: string | null; builder: { threadId: string | null; messages: ChatMessage[]; opening: string } };
  onDone: () => void; onMessage: Msg; onAddFrames: (items: ShotContent[]) => Promise<void>;
  /** The Look & Feel references this frame uses (sent only with Illustrate). */
  lookRefs?: LookRef[];
}) {
  const [open, setOpen] = useState<null | "suggest" | "asset" | "illustrate" | "builder">(null);
  const imageOk = !ai.imageMissing, textOk = !ai.textAvailable;
  if (!canEdit) return null;
  return (
    <>
      <details className="relative">
        <summary className="btn list-none">AI assist ▾</summary>
        <div className="panel absolute right-0 z-20 mt-1 flex w-72 flex-col gap-1 p-2 text-sm shadow-lg">
          <p className="px-1 pb-1 text-xs text-muted">Optional. Nothing runs until you choose it.</p>
          <button type="button" className="btn justify-start" disabled={!textOk} onClick={() => setOpen("suggest")}>Suggest Shots…</button>
          <button type="button" className="btn justify-start" disabled={!imageOk} onClick={() => setOpen("asset")}>Create Missing Asset…</button>
          <button type="button" className="btn justify-start" disabled={!imageOk || !frame} onClick={() => setOpen("illustrate")}>Illustrate This Frame…</button>
          <button type="button" className="btn justify-start" disabled={!textOk} onClick={() => setOpen("builder")}>Talk with the Shot Builder</button>
          {!imageOk && <p className="px-1 text-xs text-muted">Images: {ai.imageMissing}</p>}
          {!textOk && <p className="px-1 text-xs text-muted">Text: {ai.textAvailable}</p>}
        </div>
      </details>
      {open && (
        <div role="dialog" aria-modal="true" aria-label="AI assist" className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) setOpen(null); }}>
          <div className="panel mt-10 flex w-full max-w-2xl flex-col gap-3 p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{{ suggest: "Suggest Shots", asset: "Create Missing Asset", illustrate: "Illustrate This Frame", builder: "Shot Builder" }[open]}</h2>
              <button type="button" className="btn min-h-9 px-3 text-xs" onClick={() => setOpen(null)}>Close</button>
            </div>
            {open === "suggest" && <Suggest sequenceId={sequenceId} scenes={scenes} onMessage={onMessage} onAdd={async (items) => { await onAddFrames(items); setOpen(null); }} />}
            {open === "asset" && <CreateAsset sequenceId={sequenceId} film={film} onMessage={onMessage} onDone={() => { setOpen(null); onDone(); }} />}
            {open === "illustrate" && frame && <Illustrate sequenceId={sequenceId} entityId={entityId} frame={frame} comp={comp} jobs={jobs} lookRefs={lookRefs} onMessage={onMessage} onDone={() => { setOpen(null); onDone(); }} />}
            {open === "builder" && (
              <div className="flex flex-col gap-2">
                <p className="help">A conversation about choices (what we notice first, how close we feel). It doesn&apos;t change your frames; use Suggest Shots when you want a list to edit and add.</p>
                <PartnerChat key={ai.builder.threadId ?? "new"} projectId={projectId} agent="shots" partnerName="Shot Builder" opening={ai.builder.opening}
                  threadId={ai.builder.threadId} initial={ai.builder.messages} canTalk unavailable={null} basePath={`/projects/${projectId}/storyboards/${sequenceId}`} focus={{ storyboard_id: sequenceId }} />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Suggest({ sequenceId, scenes, onMessage, onAdd }: { sequenceId: string; scenes: { number: number; heading: string; text: string }[]; onMessage: Msg; onAdd: (items: ShotContent[]) => Promise<void> }) {
  const [scene, setScene] = useState<number | "">(scenes[0]?.number ?? "");
  const [moment, setMoment] = useState("");
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [refused, setRefused] = useState<string[]>([]);
  async function go() {
    setBusy(true); onMessage(null);
    try {
      const r = await fetch(`/api/storyboards/${sequenceId}/suggest`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scene: scene || null, moment }) });
      const j = (await r.json()) as { shots?: Suggestion[]; refused?: string[]; error?: string };
      if (!r.ok || !j.shots) throw new Error(j.error ?? "No suggestions this time.");
      setItems(j.shots.map((s) => ({ ...s, keep: true }))); setRefused(j.refused ?? []);
    } catch (e) { onMessage({ kind: "error", text: e instanceof Error ? e.message : "No suggestions this time." }); }
    finally { setBusy(false); }
  }
  return (
    <div className="flex flex-col gap-3">
      {!items ? (
        <>
          <p className="help">Uses a text model once, on what you pick below, to propose a short shot list. You&apos;ll see and edit it before anything is added. It uses the team&apos;s AI budget.</p>
          {scenes.length > 0 && (
            <label className="flex flex-col gap-1 text-sm"><span className="label">Scene</span>
              <select className="field" value={scene} onChange={(e) => setScene(e.target.value ? Number(e.target.value) : "")}>
                <option value="">None (use the description below)</option>{scenes.map((s) => <option key={s.number} value={s.number}>{s.number}. {s.heading}</option>)}
              </select></label>
          )}
          <label className="flex flex-col gap-1 text-sm"><span className="label">Or describe the moment</span>
            <textarea className="field" rows={3} value={moment} onChange={(e) => setMoment(e.target.value)} maxLength={3000} placeholder="Johnny drinks coffee; an explosion outside shakes the cups." /></label>
          <button type="button" className="btn-primary self-start" onClick={go} disabled={busy || (!scene && !moment.trim())}>{busy ? "Thinking…" : "Suggest shots"}</button>
        </>
      ) : (
        <>
          <p className="help">Proposals: edit or untick any, then add the ones you want as frames. Each keeps the words from your story it came from.</p>
          <ol className="flex flex-col gap-2">
            {items.map((s, i) => (
              <li key={i} className="flex gap-2 border border-line p-2 text-sm">
                <input type="checkbox" checked={s.keep} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)))} aria-label={`Keep suggestion ${i + 1}`} />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <textarea className="field text-sm" rows={2} value={s.action} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, action: e.target.value } : x)))} aria-label={`Suggestion ${i + 1}`} />
                  <p className="text-xs text-muted">{[s.size, s.angle, s.durationS ? `~${s.durationS}s` : ""].filter(Boolean).join(" · ")}{s.why ? ` — ${s.why}` : ""}</p>
                  {s.source?.excerpt && <p className="text-xs text-muted">From your story: “{s.source.excerpt}”</p>}
                </div>
              </li>
            ))}
          </ol>
          {refused.length > 0 && <p className="text-xs text-muted">Left out (not in your story): {refused.join(" · ")}</p>}
          <div className="flex gap-2">
            <button type="button" className="btn-primary" disabled={!items.some((s) => s.keep)} onClick={() => onAdd(items.filter((s) => s.keep).map((s) => ({ action: s.action, source: s.source, size: s.size as never, angle: s.angle as never, durationS: s.durationS, why: s.why })))}>
              Add {items.filter((s) => s.keep).length} as frames
            </button>
            <button type="button" className="btn" onClick={() => setItems(null)}>Start over</button>
          </div>
        </>
      )}
    </div>
  );
}

function CreateAsset({ sequenceId, film, onMessage, onDone }: { sequenceId: string; film: FilmItem[]; onMessage: Msg; onDone: () => void }) {
  const [kind, setKind] = useState("background");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [views, setViews] = useState("");
  const [entity, setEntity] = useState("");
  const [style, setStyle] = useState("pencil");
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => crypto.randomUUID().replace(/-/g, ""));
  async function go() {
    setBusy(true); onMessage(null);
    try {
      const r = await fetch(`/api/storyboards/${sequenceId}/ai`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "asset", idempotencyKey: key, library: { kind, name, description, views, entity_id: entity || null }, style }) });
      const j = (await r.json()) as { error?: string; status?: string };
      if (!r.ok || j.status === "failed") throw new Error(j.error ?? "The asset couldn't be made.");
      onMessage({ kind: "notice", text: `“${name}” is in your asset library. Reuse it in any frame without generating again.` });
      onDone();
    } catch (e) { onMessage({ kind: "error", text: `${e instanceof Error ? e.message : "The asset couldn't be made."} Your storyboard is unchanged.` }); }
    finally { setBusy(false); }
  }
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="help">Makes one reusable image with OpenAI&apos;s image model (billed to the OpenAI account; Studio doesn&apos;t know the price and shows the token usage it reports). It&apos;s saved to your asset library with the view it shows: one picture gives one viewpoint, not a turnaround.</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1"><span className="label">Kind</span>
          <select className="field" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="background">Background / location</option><option value="prop">Prop</option><option value="character">Character reference</option><option value="pose">Character pose</option><option value="wardrobe">Wardrobe</option>
          </select></label>
        <label className="flex flex-col gap-1"><span className="label">Name</span><input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></label>
        <label className="col-span-2 flex flex-col gap-1"><span className="label">Describe it</span><textarea className="field" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1200} /></label>
        <label className="flex flex-col gap-1"><span className="label">View / pose</span><input className="field" value={views} onChange={(e) => setViews(e.target.value)} placeholder="e.g. front, standing; wide, eye level" maxLength={300} /></label>
        <label className="flex flex-col gap-1"><span className="label">Style</span>
          <select className="field" value={style} onChange={(e) => setStyle(e.target.value)}><option value="pencil">Pencil sketch</option><option value="ink">Ink drawing</option><option value="grayscale">Grayscale tonal</option><option value="color">Color illustration</option></select></label>
        {(kind === "character" || kind === "pose" || kind === "wardrobe") && (
          <label className="col-span-2 flex flex-col gap-1"><span className="label">Which character?</span>
            <select className="field" value={entity} onChange={(e) => setEntity(e.target.value)}>
              <option value="">—</option>{film.filter((f) => f.kind === "character").map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select></label>
        )}
      </div>
      <button type="button" className="btn-primary self-start" onClick={go} disabled={busy || !name.trim() || !description.trim()}>{busy ? "Making… (up to a minute)" : "Create asset"}</button>
    </div>
  );
}

function Illustrate({ sequenceId, entityId, frame, comp, jobs, lookRefs, onMessage, onDone }: { sequenceId: string; entityId: string; frame: FrameRow; comp: Composition; jobs: JobRow[]; lookRefs: LookRef[]; onMessage: Msg; onDone: () => void }) {
  const [useLook, setUseLook] = useState(true);
  const [style, setStyle] = useState("pencil");
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => crypto.randomUUID().replace(/-/g, ""));
  const mine = jobs.filter((j) => j.shotId === frame.id && j.kind === "illustrate");
  async function go() {
    setBusy(true); onMessage(null);
    try {
      const png = await exportPng(comp, 1536);
      if (!png.blob) throw new Error(`The frame couldn't be rendered: ${png.problems.join("; ")}`);
      const baseAssetId = await uploadImage(entityId, png.blob, "frame-composition.png");
      const r = await fetch(`/api/storyboards/${sequenceId}/ai`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "illustrate", shotId: frame.id, baseAssetId, idempotencyKey: key, style, lookRefIds: useLook ? lookRefs.map((r) => r.id) : [] }) });
      const j = (await r.json()) as { error?: string; status?: string };
      if (!r.ok || j.status === "failed") throw new Error(j.error ?? "The illustration couldn't be made.");
      onMessage({ kind: "notice", text: "Illustration ready (below the canvas). Your editable frame is unchanged." });
      onDone();
    } catch (e) { onMessage({ kind: "error", text: `${e instanceof Error ? e.message : "The illustration couldn't be made."} Your frame is unchanged.` }); }
    finally { setBusy(false); }
  }
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="help">Sends a picture of this frame as you composed it (saved to Studio storage first), plus its action and dialogue, to OpenAI&apos;s image model to make a finished-looking drawing. Only this frame. The result is kept as a separate illustration linked to the frame: your layers stay editable. Billed to the OpenAI account; the token usage is recorded.</p>
      <label className="flex items-center gap-2"><span className="label">Style</span>
        <select className="field w-auto" value={style} onChange={(e) => setStyle(e.target.value)}><option value="pencil">Pencil sketch</option><option value="ink">Ink drawing</option><option value="grayscale">Grayscale tonal</option><option value="color">Color illustration</option></select></label>
      {lookRefs.length > 0 && (
        <div className="flex flex-col gap-1 border-l-2 border-line pl-2 text-xs">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={useLook} onChange={(e) => setUseLook(e.target.checked)} /> Also send this frame&apos;s Look &amp; Feel ({lookRefs.length} reference{lookRefs.length > 1 ? "s" : ""})</label>
          <p className="text-muted">The image model takes pictures but has no separate “style only” input. So: images in your film are attached as pictures, and their role (look only, not who or where) plus your “use for” and “leave out” notes are written into the request. Treatment crops and links are described in words only. The model may still not follow every note.</p>
        </div>
      )}
      <button type="button" className="btn-primary self-start" onClick={go} disabled={busy}>{busy ? "Illustrating… (up to a minute)" : "Illustrate this frame"}</button>
      {mine.length > 0 && <p className="text-xs text-muted">Earlier: {mine.map((j) => `${new Date(j.createdAt).toLocaleString()} (${j.status}${j.usage?.total_tokens ? `, ${j.usage.total_tokens} tokens` : ""})`).join(" · ")}</p>}
    </div>
  );
}
