"use client";
// The storyboard desk: shot list · selected frame and its information · settings/agent panel.
// Shots keep their identity when reordered; edits are revisions; approved and locked shots
// are never replaced automatically; every generation is kept in history.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import {
  cancelJob, clearReview, moveShot, pickFrame, removeRef, removeShot, saveRef, saveShot, saveShotNotes, setShotState, updateStoryboard,
} from "@/app/projects/[projectId]/storyboard-actions";
import { PartnerChat, type ChatMessage } from "@/components/partner-chat";
import { ASPECTS, depthOfField, distanceForFraming, equivalentFocal, fieldOfView, FORMATS, formatOf, round } from "@/lib/storyboard/camera";
import type { FinishParams } from "@/lib/storyboard/finish";
import { ROLE_LABELS } from "@/lib/storyboard/prompt";
import { ANGLES, between, FOCUS, formatSeconds, labelOf, sequenceTiming, SIZES, STYLES, type ShotContent } from "@/lib/storyboard/shot";
import { FinishPreview } from "./finish-preview";

export interface EditorShot {
  id: string; position: number; state: "proposed" | "approved"; locked: boolean; origin: "director" | "agent"; revision: number;
  approvedRevision: number | null; content: ShotContent; frameAssetId: string | null; lookAssetId: string | null;
  review: { reason: string; was?: string; now?: string } | null; notes: string;
}
export interface EditorJob {
  id: string; shotId: string; kind: string; mode: string; status: string; outputAssetId: string | null; applied: boolean;
  error: string | null; createdAt: string; model: string; usage: Record<string, unknown> | null; textOnly: number; refs: number; sourceRevision: number;
  finishId: string | null;
}
export interface EditorRef {
  id: string; shotId: string | null; assetId: string | null; entityId: string | null; url: string | null; title: string; role: string;
  borrow: string; ignore: string; access: string; attribution: string;
}
export interface Lib { lenses: { id: string; manufacturer: string; model: string; optical: string; squeeze: number | null; verification: string; source_url: string | null; character_notes: string; focal_lengths: number[]; aperture_spec: string }[];
  stocks: { id: string; manufacturer: string; stock: string; product_codes: string[]; balance: string | null; ei_daylight: number | null; ei_tungsten: number | null; source_urls: string[]; verification: string; documented: string; editorial: string; gauges: string[] }[];
  finishes: { id: string; name: string; stock_id: string | null; params: FinishParams; provenance: string; license: string; label: string; version: number }[] }

type Panel = "shot" | "look" | "refs" | "builder";

export function StoryboardEditor(props: {
  projectId: string; sequenceId: string; entityId: string; title: string; brief: string; settings: { style?: string; aspect?: number; finishId?: string; stockId?: string };
  shots: EditorShot[]; jobs: EditorJob[]; refs: EditorRef[]; lib: Lib;
  cast: { id: string; name: string }[]; locations: { id: string; name: string }[];
  canEdit: boolean; providerMissing: string | null; initialShot?: string; initialPanel?: Panel;
  builder: { threadId: string | null; messages: ChatMessage[]; unavailable: string | null; opening: string };
}) {
  const { projectId, sequenceId, shots, jobs, refs, lib, canEdit } = props;
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(props.initialShot && shots.some((s) => s.id === props.initialShot) ? props.initialShot : shots[0]?.id ?? null);
  const [panel, setPanel] = useState<Panel>(props.initialPanel ?? "shot");
  const [panelOpen, setPanelOpen] = useState(true);
  const [msg, setMsg] = useState<{ kind: "error" | "notice"; text: string } | null>(null);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const stopBatch = useRef(false);
  const retryKeys = useRef(new Map<string, string>());
  const [pending, start] = useTransition();
  const selected = shots.find((s) => s.id === selectedId) ?? null;
  const index = selected ? shots.indexOf(selected) : -1;
  const timing = sequenceTiming(shots);
  const settings = props.settings;
  const finish = lib.finishes.find((f) => f.id === (settings.finishId ?? "none")) ?? lib.finishes[0];
  const base = { projectId, sequenceId };

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) {
    setMsg(null);
    start(async () => {
      const r = await fn().catch(() => ({ ok: false, error: "That didn't save. Try again." }));
      if (!r.ok) setMsg({ kind: "error", text: r.error ?? "That didn't work." });
      else { if (ok) setMsg({ kind: "notice", text: ok }); router.refresh(); }
    });
  }

  async function generate(shot: EditorShot, kind: "frame" | "variation" | "edit" | "look", extra: { editInstruction?: string } = {}) {
    const reqKey = `${shot.id}:${kind}:${extra.editInstruction ?? ""}`;
    const key = retryKeys.current.get(reqKey) ?? crypto.randomUUID().replace(/-/g, "");
    retryKeys.current.set(reqKey, key);
    setBusy((b) => ({ ...b, [shot.id]: kind }));
    setMsg(null);
    try {
      const r = await fetch(`/api/storyboards/${sequenceId}/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shotId: shot.id, kind, style: settings.style, finishId: settings.finishId, stockId: settings.stockId, idempotencyKey: key, ...extra }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string; status?: string; configRequired?: boolean; textOnly?: number };
      retryKeys.current.delete(reqKey);   // got an answer: a new click is a new request
      if (!r.ok || j.status === "failed") setMsg({ kind: "error", text: j.error ?? "That frame couldn't be made." });
      else if (j.textOnly) setMsg({ kind: "notice", text: `Done. ${j.textOnly} reference${j.textOnly === 1 ? " was" : "s were"} described in words only (not sent as images).` });
      router.refresh();
      return r.ok && j.status !== "failed";
    } catch {
      setMsg({ kind: "error", text: "The connection dropped. Press the same button again: it won't make a duplicate." });
      return false;
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[shot.id]; return n; });
    }
  }

  async function generateApproved() {
    const todo = shots.filter((s) => s.state === "approved" && !s.locked && !s.frameAssetId);
    if (!todo.length) { setMsg({ kind: "notice", text: "Every approved shot already has a frame. Use Regenerate on a shot to make a new one." }); return; }
    stopBatch.current = false;
    setBatch({ done: 0, total: todo.length });
    for (let i = 0; i < todo.length; i++) {
      if (stopBatch.current) break;
      setSelectedId(todo[i].id);
      const ok = await generate(todo[i], "frame");
      setBatch({ done: i + 1, total: todo.length });
      if (!ok) break;
    }
    setBatch(null);
  }

  function addShot(after: EditorShot | null) {
    const i = after ? shots.indexOf(after) : shots.length - 1;
    const pos = between(shots[i]?.position ?? null, shots[i + 1]?.position ?? null);
    run(async () => {
      const r = await saveShot({ ...base, shotId: null, content: { action: "", source: { kind: "text" } }, position: shots.length ? pos : null });
      if (r.ok && r.id) setSelectedId(r.id);
      return r;
    });
  }

  function move(shot: EditorShot, dir: -1 | 1) {
    const i = shots.indexOf(shot), j = i + dir;
    if (j < 0 || j >= shots.length) return;
    const pos = dir < 0 ? between(shots[j - 1]?.position ?? null, shots[j].position) : between(shots[j].position, shots[j + 1]?.position ?? null);
    run(() => moveShot({ ...base, shotId: shot.id, position: pos }));
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Link href={`/projects/${projectId}/storyboards`} className="eyebrow hover:text-text">← Storyboards</Link>
          <h1 className="display truncate text-3xl leading-none sm:text-4xl">{props.title}</h1>
          <p className="text-sm text-muted">{shots.length} {shots.length === 1 ? "shot" : "shots"} · {timing.label} · durations are proposals, not measured</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && <button type="button" className="btn-primary" onClick={generateApproved} disabled={!!batch || !!props.providerMissing}>Generate approved sequence</button>}
          {batch && <button type="button" className="btn" onClick={() => { stopBatch.current = true; }}>Stop after this frame ({batch.done}/{batch.total})</button>}
          <a className="btn" href={`/print/storyboards/${sequenceId}`} target="_blank" rel="noreferrer">PDF</a>
          <a className="btn" href={`/api/storyboards/${sequenceId}/export`} download>Shot list (JSON)</a>
          <button type="button" className="btn" onClick={() => setPanelOpen((v) => !v)} aria-expanded={panelOpen} aria-controls="sb-panel">{panelOpen ? "Hide panel" : "Show panel"}</button>
        </div>
      </header>
      {props.providerMissing && (
        <p className="panel border-brand px-4 py-3 text-sm" role="status"><b>Image generation isn&apos;t set up yet.</b> {props.providerMissing} Everything else works, and your shots are saved; nothing is simulated.</p>
      )}
      {msg && <p role={msg.kind === "error" ? "alert" : "status"} className={`panel px-4 py-3 text-sm ${msg.kind === "error" ? "border-danger text-danger" : ""}`}>{msg.text}</p>}

      <div className={`grid grid-cols-1 gap-4 ${panelOpen ? "xl:grid-cols-[16rem_minmax(0,1fr)_24rem] lg:grid-cols-[14rem_minmax(0,1fr)]" : "lg:grid-cols-[14rem_minmax(0,1fr)]"}`}>
        {/* Shot list */}
        <nav aria-label="Shots" className="panel flex flex-col">
          <ol className="flex max-h-[70vh] flex-col overflow-y-auto">
            {shots.map((s, i) => (
              <li key={s.id} className={`border-b border-line ${s.id === selectedId ? "bg-panel-2" : ""}`}>
                <div className="flex gap-2 p-2">
                  <button type="button" onClick={() => setSelectedId(s.id)} aria-current={s.id === selectedId ? "true" : undefined}
                    className="flex min-w-0 flex-1 gap-2 text-left">
                    <span className="w-14 shrink-0 bg-line/40" style={{ aspectRatio: String(s.content.camera?.aspect ?? settings.aspect ?? 16 / 9) }}>
                      {s.frameAssetId && /* eslint-disable-next-line @next/next/no-img-element */ <img src={`/api/assets/${s.frameAssetId}`} alt="" className="size-full object-cover" loading="lazy" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold">Shot {i + 1}{s.content.durationS ? ` · ${formatSeconds(s.content.durationS)}` : ""}</span>
                      <span className="line-clamp-2 text-xs text-muted">{s.content.action || "(no action yet)"}</span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {s.origin === "agent" && <span className="badge bg-panel text-muted">Shot Builder</span>}
                        {s.state === "approved" && <span className="badge bg-text text-panel-2">Approved</span>}
                        {s.locked && <span className="badge bg-brand text-text">Locked</span>}
                        {s.review && <span className="badge border border-danger text-danger">Review</span>}
                        {busy[s.id] && <span className="badge bg-panel text-muted">Making…</span>}
                      </span>
                    </span>
                  </button>
                  {canEdit && (
                    <span className="flex flex-col">
                      <button type="button" className="px-1 text-xs text-muted hover:text-text disabled:opacity-30" onClick={() => move(s, -1)} disabled={i === 0 || pending} aria-label={`Move shot ${i + 1} up`}>↑</button>
                      <button type="button" className="px-1 text-xs text-muted hover:text-text disabled:opacity-30" onClick={() => move(s, 1)} disabled={i === shots.length - 1 || pending} aria-label={`Move shot ${i + 1} down`}>↓</button>
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {canEdit && <button type="button" className="btn m-2" onClick={() => addShot(selected)} disabled={pending}>+ Add a shot{selected ? " after this" : ""}</button>}
          {!shots.length && <p className="help p-3">No shots yet. Add one, or ask the Shot Builder to propose a few.</p>}
        </nav>

        {/* Selected frame */}
        <section aria-label="Selected shot" className="flex min-w-0 flex-col gap-3">
          {selected ? (
            <FrameView key={selected.id} shot={selected} number={index + 1} jobs={jobs.filter((j) => j.shotId === selected.id)} refs={refs}
              lib={lib} settings={settings} finish={finish} canEdit={canEdit} busy={busy[selected.id]} providerMissing={props.providerMissing}
              onGenerate={(k, x) => generate(selected, k, x)}
              onPick={(slot, assetId) => run(() => pickFrame({ ...base, shotId: selected.id, slot, assetId }), slot === "frame" ? "Frame chosen." : "Look preview chosen.")}
              onCancel={(jobId) => run(() => cancelJob({ ...base, jobId }), "Cancelled. Any earlier frame stays.")}
              onClearReview={() => run(() => clearReview({ ...base, shotId: selected.id }))}
              onState={(state, locked) => run(() => setShotState({ ...base, shotId: selected.id, state, locked }))}
              onNotes={(notes) => run(() => saveShotNotes({ ...base, shotId: selected.id, notes }), "Notes saved.")} />
          ) : <p className="panel help p-6">Pick a shot, or add one.</p>}
        </section>

        {/* Settings / agent panel */}
        {panelOpen && (
          <aside id="sb-panel" aria-label="Settings and Shot Builder" className="panel flex min-w-0 flex-col lg:col-span-2 xl:col-span-1">
            <div role="tablist" aria-label="Panel" className="grid grid-cols-4 border-b border-line">
              {(["shot", "look", "refs", "builder"] as const).map((p) => (
                <button key={p} role="tab" type="button" aria-selected={panel === p} onClick={() => setPanel(p)}
                  className={`min-h-11 px-2 text-xs font-medium tracking-[0.08em] uppercase ${panel === p ? "bg-text text-panel-2" : "text-muted hover:text-text"}`}>
                  {p === "shot" ? "Shot" : p === "look" ? "Look" : p === "refs" ? "References" : "Shot Builder"}
                </button>
              ))}
            </div>
            <div role="tabpanel" className="flex max-h-[75vh] flex-col gap-4 overflow-y-auto p-3">
              {panel === "shot" && (selected
                ? <ShotForm key={`${selected.id}:${selected.revision}`} shot={selected} lib={lib} cast={props.cast} locations={props.locations} canEdit={canEdit} defaultAspect={settings.aspect}
                    onSave={(content) => run(() => saveShot({ ...base, shotId: selected.id, content, expectedRevision: selected.revision }), "Saved as a new revision.")}
                    onRemove={() => run(async () => { const r = await removeShot({ ...base, shotId: selected.id }); if (r.ok) setSelectedId(shots.find((s) => s.id !== selected.id)?.id ?? null); return r; }, "Shot removed.")} />
                : <p className="help">Pick a shot.</p>)}
              {panel === "look" && <LookPanel settings={settings} lib={lib} canEdit={canEdit}
                onChange={(next) => run(() => updateStoryboard({ ...base, settings: { ...settings, ...next } }))} />}
              {panel === "refs" && <RefsPanel {...base} entityId={props.entityId} refs={refs} selected={selected} cast={props.cast} locations={props.locations} canEdit={canEdit}
                onSave={(refId, data) => run(() => saveRef({ ...base, refId, data }), "Reference saved.")}
                onRemove={(refId) => run(() => removeRef({ ...base, refId }))} onError={(t) => setMsg({ kind: "error", text: t })} />}
              {panel === "builder" && (
                <div className="flex flex-col gap-2">
                  <p className="help">The Shot Builder asks one question at a time and adds proposed shots to this storyboard. You edit, reorder and approve them.</p>
                  <PartnerChat key={props.builder.threadId ?? "new"} projectId={projectId} agent="shots" partnerName="Shot Builder" opening={props.builder.opening}
                    threadId={props.builder.threadId} initial={props.builder.messages} canTalk={canEdit} unavailable={canEdit ? props.builder.unavailable : null}
                    basePath={`/projects/${projectId}/storyboards/${sequenceId}`} focus={{ storyboard_id: sequenceId }} />
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function FrameView({ shot, number, jobs, refs, lib, settings, finish, canEdit, busy, providerMissing, onGenerate, onPick, onCancel, onClearReview, onState, onNotes }: {
  shot: EditorShot; number: number; jobs: EditorJob[]; refs: EditorRef[]; lib: Lib; settings: { style?: string; aspect?: number; finishId?: string; stockId?: string };
  finish: Lib["finishes"][number] | undefined; canEdit: boolean; busy?: string; providerMissing: string | null;
  onGenerate: (k: "frame" | "variation" | "edit" | "look", x?: { editInstruction?: string }) => void;
  onPick: (slot: "frame" | "look", assetId: string) => void; onCancel: (jobId: string) => void; onClearReview: () => void;
  onState: (state: "approved" | "proposed" | null, locked: boolean | null) => void; onNotes: (n: string) => void;
}) {
  const [view, setView] = useState<"storyboard" | "look">("storyboard");
  const [edit, setEdit] = useState("");
  const [notes, setNotes] = useState(shot.notes);
  const c = shot.content;
  const aspect = c.camera?.aspect ?? settings.aspect ?? 16 / 9;
  const fmt = c.camera ? formatOf(c.camera) : null;
  const lens = lib.lenses.find((l) => l.id === c.lensId);
  const stock = lib.stocks.find((s) => s.id === settings.stockId);
  const shotRefs = refs.filter((r) => !r.shotId || r.shotId === shot.id);
  const running = jobs.find((j) => j.status === "running" || j.status === "queued");
  const history = jobs.filter((j) => j.outputAssetId);
  const latest = jobs[0];
  const noGen = !!providerMissing || !canEdit;
  const lookJob = jobs.find((j) => j.mode === "look" && j.outputAssetId === shot.lookAssetId);
  const lookFinish = lib.finishes.find((f) => f.id === (lookJob?.finishId ?? settings.finishId ?? "none")) ?? finish;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Visual mode" className="flex">
          <button role="tab" type="button" aria-selected={view === "storyboard"} className={`btn min-h-9 px-3 text-xs ${view === "storyboard" ? "btn-primary" : ""}`} onClick={() => setView("storyboard")}>Storyboard</button>
          <button role="tab" type="button" aria-selected={view === "look"} className={`btn min-h-9 px-3 text-xs ${view === "look" ? "btn-primary" : ""}`} onClick={() => setView("look")}>Look Preview</button>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn min-h-9 px-3 text-xs" aria-pressed={shot.state === "approved"} onClick={() => onState(shot.state === "approved" ? "proposed" : "approved", null)}>
              {shot.state === "approved" ? "Approved ✓" : "Approve shot"}
            </button>
            <button type="button" className="btn min-h-9 px-3 text-xs" aria-pressed={shot.locked} onClick={() => onState(null, !shot.locked)}>{shot.locked ? "Locked 🔒" : "Lock frame"}</button>
          </div>
        )}
      </div>

      {shot.review && (
        <div className="panel border-danger p-3 text-sm" role="status">
          <p><b>Needs a look:</b> {shot.review.reason} Your frame and notes are kept; you decide whether to regenerate.</p>
          {shot.review.was && <p className="mt-1 text-xs text-muted">Was: “{shot.review.was}”</p>}
          {shot.review.now && <p className="text-xs text-muted">Now: “{shot.review.now}”</p>}
          {canEdit && <button type="button" className="btn mt-2 min-h-9 px-3 text-xs" onClick={onClearReview}>It&apos;s fine, clear this</button>}
        </div>
      )}

      <div className="relative w-full border border-line bg-panel-2" style={{ aspectRatio: String(aspect) }}>
        {view === "storyboard" ? (
          shot.frameAssetId
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={`/api/assets/${shot.frameAssetId}`} alt={`Storyboard frame for shot ${number}: ${c.action}`} className="size-full object-contain" />
            : <p className="flex size-full items-center justify-center p-6 text-center text-sm text-muted">No frame yet.{noGen ? "" : " Generate one below."}</p>
        ) : shot.lookAssetId ? (
          <FinishPreview assetId={shot.lookAssetId} params={lookFinish?.params ?? null} captureWidthMm={fmt?.widthMm ?? 24.89} alt={`Look preview for shot ${number}`} presetLabel={lookFinish?.name ?? "No finish"} />
        ) : (
          <p className="flex size-full items-center justify-center p-6 text-center text-sm text-muted">No look preview yet. It keeps the storyboard&apos;s composition and explores lens, color and grain (an approximation).</p>
        )}
        {busy && <p className="absolute inset-x-0 bottom-0 bg-black/70 px-3 py-2 text-sm text-white" role="status">Making a {busy === "look" ? "look preview" : busy}… this can take up to a minute.</p>}
      </div>
      {c.movement && <p className="text-xs text-muted">Movement: <b>{c.movement}</b>. A still frame can&apos;t show a camera move; it shows the start of it.</p>}

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          {view === "storyboard" ? (
            <>
              <button type="button" className="btn-primary" disabled={noGen || !!busy || shot.locked} onClick={() => onGenerate("frame")}>{shot.frameAssetId ? "Regenerate frame" : "Generate frame"}</button>
              <button type="button" className="btn" disabled={noGen || !!busy || !shot.frameAssetId} onClick={() => onGenerate("variation")}>Make a variation</button>
              <span className="flex min-w-0 flex-1 gap-2">
                <input value={edit} onChange={(e) => setEdit(e.target.value)} className="field min-w-0 flex-1" placeholder="Edit this frame: e.g. make the window rainy" aria-label="Edit instruction" maxLength={600} />
                <button type="button" className="btn" disabled={noGen || !!busy || !shot.frameAssetId || shot.locked || !edit.trim()} onClick={() => onGenerate("edit", { editInstruction: edit })}>Edit</button>
              </span>
            </>
          ) : (
            <button type="button" className="btn-primary" disabled={noGen || !!busy || shot.locked} onClick={() => onGenerate("look")}>{shot.lookAssetId ? "New look preview" : "Make a look preview"}</button>
          )}
          {running && <button type="button" className="btn" onClick={() => onCancel(running.id)}>Cancel</button>}
          {shot.locked && <span className="text-xs text-muted">Locked: unlock to replace this frame. Variations still go to history.</span>}
        </div>
      )}
      {latest?.status === "failed" && <p className="text-sm text-danger" role="status">Last attempt failed: {latest.error}. {shot.frameAssetId ? "The previous frame is unchanged." : ""}</p>}

      {history.length > 0 && (
        <section aria-label="Generation history" className="flex flex-col gap-1">
          <p className="eyebrow">History ({history.length})</p>
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {history.map((j) => {
              const shown = j.outputAssetId === (j.mode === "look" ? shot.lookAssetId : shot.frameAssetId);
              return (
                <li key={j.id} className="shrink-0">
                  <button type="button" disabled={!canEdit || shot.locked || shown} onClick={() => onPick(j.mode === "look" ? "look" : "frame", j.outputAssetId!)}
                    className={`block w-28 border-2 ${shown ? "border-brand" : "border-transparent hover:border-line"}`}
                    title={`${j.kind} · ${j.mode} · ${new Date(j.createdAt).toLocaleString()} · ${j.model}${j.usage?.total_tokens ? ` · ${j.usage.total_tokens} tokens` : ""}${j.sourceRevision ? ` · from revision ${j.sourceRevision}` : ""}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/assets/${j.outputAssetId}`} alt={`${j.kind} from ${new Date(j.createdAt).toLocaleString()}`} className="w-full object-cover" style={{ aspectRatio: String(aspect) }} loading="lazy" />
                    <span className="block truncate px-1 text-[10px] uppercase tracking-[0.08em] text-muted">{j.mode === "look" ? "look" : j.kind}{shown ? " · shown" : ""}{j.status === "cancelled" ? " · cancelled" : ""}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <dl className="panel grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 p-3 text-sm">
        <dt className="text-muted">Shot</dt><dd>#{number} · {shot.origin === "agent" ? "proposed by the Shot Builder" : "yours"} · {shot.state === "approved" ? `approved (revision ${shot.approvedRevision})${shot.approvedRevision !== shot.revision ? ", edited since" : ""}` : `proposal (revision ${shot.revision})`}</dd>
        <dt className="text-muted">Source</dt><dd>{c.source?.kind === "script" ? `Script, scene ${c.source.scene ?? "?"} (${c.source.heading})` : c.source?.kind === "image" ? "From an image" : "From text"}{c.source?.excerpt ? <span className="block text-xs text-muted">“{c.source.excerpt.slice(0, 220)}{c.source.excerpt.length > 220 ? "…" : ""}”</span> : null}</dd>
        <dt className="text-muted">Action</dt><dd>{c.action || "—"}</dd>
        {c.dialogue && (<><dt className="text-muted">Dialogue</dt><dd className="whitespace-pre-wrap">{c.dialogue}</dd></>)}
        <dt className="text-muted">Size · angle</dt><dd>{[labelOf(SIZES, c.size), labelOf(ANGLES, c.angle), c.focus ? labelOf(FOCUS, c.focus).split(" (")[0] : ""].filter(Boolean).join(" · ") || "—"}</dd>
        <dt className="text-muted">Movement</dt><dd>{c.movement || "—"}</dd>
        <dt className="text-muted">Lens · format</dt><dd>{c.camera?.focalMm ? `${c.camera.focalMm} mm ${c.camera.anamorphic ? `anamorphic ${c.camera.squeeze ?? 2}×` : "spherical"} on ${fmt?.name ?? "—"}` : "—"}{lens ? ` · ${lens.manufacturer} ${lens.model}` : ""}<span className="block text-xs text-muted">Creative guidance for the image model, not exact optics.</span></dd>
        <dt className="text-muted">Look</dt><dd>{labelOf(STYLES, settings.style ?? "pencil")} storyboard{stock ? ` · look preview inspired by ${stock.stock}` : ""}{finish && finish.id !== "none" ? ` · finish: ${finish.name}` : ""}</dd>
        <dt className="text-muted">References</dt><dd>{shotRefs.length ? shotRefs.map((r) => `${ROLE_LABELS[r.role]}${r.access === "accessible" ? "" : r.access === "text_only" ? " (words only)" : " (link not checked)"}`).join(", ") : "—"}</dd>
        <dt className="text-muted">Duration</dt><dd>{c.durationS ? `${formatSeconds(c.durationS)} (proposed)` : "not set"}</dd>
        <dt className="text-muted">Status</dt><dd>{running ? "making…" : latest ? `${latest.status}${latest.applied ? "" : latest.status === "succeeded" ? " (kept in history)" : ""}` : "not generated"}{shot.locked ? " · locked" : ""}</dd>
        {c.why && (<><dt className="text-muted">Why</dt><dd className="text-muted">{c.why}</dd></>)}
      </dl>

      <label className="flex flex-col gap-1 text-sm">
        <span className="label">Notes on this shot</span>
        <textarea className="field" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} readOnly={!canEdit} maxLength={4000} />
      </label>
      {canEdit && notes !== shot.notes && <button type="button" className="btn self-start" onClick={() => onNotes(notes)}>Save notes</button>}
    </>
  );
}

function ShotForm({ shot, lib, cast, locations, canEdit, defaultAspect, onSave, onRemove }: {
  shot: EditorShot; lib: Lib; cast: { id: string; name: string }[]; locations: { id: string; name: string }[]; canEdit: boolean; defaultAspect?: number;
  onSave: (c: ShotContent) => void; onRemove: () => void;
}) {
  const [c, setC] = useState<ShotContent>(shot.content);
  const [more, setMore] = useState(!!shot.content.camera?.focalMm);
  const cam = c.camera ?? {};
  const set = (patch: Partial<ShotContent>) => setC((x) => ({ ...x, ...patch }));
  const setCam = (patch: Partial<NonNullable<ShotContent["camera"]>>) => setC((x) => ({ ...x, camera: { ...(x.camera ?? {}), ...patch } }));
  const camFull = { formatId: "s35", aspect: defaultAspect, ...cam };
  const fov = camFull.focalMm ? fieldOfView(camFull) : null;
  const dist = camFull.focalMm && c.size ? distanceForFraming(camFull, c.size) : null;
  const dof = depthOfField(camFull);
  const eq = camFull.focalMm && camFull.formatId !== "ff" ? equivalentFocal(camFull, { formatId: "ff", aspect: camFull.aspect }) : null;
  const dirty = JSON.stringify(c) !== JSON.stringify(shot.content);
  const ro = !canEdit || shot.locked;
  const num = (v: string) => (v === "" ? undefined : Number(v));

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); onSave(c); }}>
      {shot.locked && <p className="help">This shot is locked. Unlock it (above the frame) to change it.</p>}
      <label className="flex flex-col gap-1 text-sm"><span className="label">What happens</span>
        <textarea className="field" rows={3} value={c.action} onChange={(e) => set({ action: e.target.value })} readOnly={ro} maxLength={1200} /></label>
      <label className="flex flex-col gap-1 text-sm"><span className="label">Dialogue (optional)</span>
        <textarea className="field" rows={2} value={c.dialogue ?? ""} onChange={(e) => set({ dialogue: e.target.value || undefined })} readOnly={ro} maxLength={1200} /></label>

      <fieldset className="flex flex-col gap-2" disabled={ro}>
        <legend className="label">How close?</legend>
        <div className="flex flex-wrap gap-1">
          {(["wide", "medium", "close"] as const).map((s) => (
            <button key={s} type="button" aria-pressed={c.size === s} onClick={() => set({ size: s })} className={`btn min-h-9 px-3 text-xs ${c.size === s ? "btn-primary" : ""}`}>{labelOf(SIZES, s)}</button>
          ))}
          <select className="field w-auto py-1 text-xs" value={["wide", "medium", "close"].includes(c.size ?? "") ? "" : c.size ?? ""} onChange={(e) => set({ size: (e.target.value || undefined) as ShotContent["size"] })} aria-label="More shot sizes">
            <option value="">More sizes…</option>
            {SIZES.filter(([k]) => !["wide", "medium", "close"].includes(k)).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2" disabled={ro}>
        <legend className="label">Camera angle</legend>
        <div className="flex flex-wrap gap-1">
          {(["eye", "high", "low"] as const).map((a) => (
            <button key={a} type="button" aria-pressed={c.angle === a} onClick={() => set({ angle: a })} className={`btn min-h-9 px-3 text-xs ${c.angle === a ? "btn-primary" : ""}`}>{labelOf(ANGLES, a)}</button>
          ))}
          <select className="field w-auto py-1 text-xs" value={["eye", "high", "low"].includes(c.angle ?? "") ? "" : c.angle ?? ""} onChange={(e) => set({ angle: (e.target.value || undefined) as ShotContent["angle"] })} aria-label="More angles">
            <option value="">More…</option>
            {ANGLES.filter(([k]) => !["eye", "high", "low"].includes(k)).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-sm"><span className="label">Camera distance (m)</span>
          <input type="number" step="0.1" min="0.1" className="field" value={c.distanceM ?? ""} onChange={(e) => set({ distanceM: num(e.target.value) })} readOnly={ro} placeholder={dist ? `~${round(dist, 1)}` : ""} /></label>
        <label className="flex flex-col gap-1 text-sm"><span className="label">Focus</span>
          <select className="field" value={c.focus ?? ""} onChange={(e) => set({ focus: (e.target.value || undefined) as ShotContent["focus"] })} disabled={ro}>
            <option value="">Not set</option>{FOCUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select></label>
        <label className="flex flex-col gap-1 text-sm"><span className="label">Movement note</span>
          <input className="field" value={c.movement ?? ""} onChange={(e) => set({ movement: e.target.value || undefined })} readOnly={ro} placeholder="e.g. slow push in" maxLength={300} /></label>
        <label className="flex flex-col gap-1 text-sm"><span className="label">Duration (s, proposed)</span>
          <input type="number" step="0.5" min="0.2" className="field" value={c.durationS ?? ""} onChange={(e) => set({ durationS: num(e.target.value) })} readOnly={ro} /></label>
      </div>
      <fieldset className="flex flex-col gap-1" disabled={ro}>
        <legend className="label">Who&apos;s in it · where</legend>
        <div className="flex flex-wrap gap-1">
          {cast.map((p) => {
            const on = (c.characters ?? []).includes(p.name);
            return <button key={p.id} type="button" aria-pressed={on} onClick={() => set({ characters: on ? (c.characters ?? []).filter((x) => x !== p.name) : [...(c.characters ?? []), p.name] })}
              className={`badge border ${on ? "border-text bg-text text-panel-2" : "border-line text-muted"}`}>{p.name}</button>;
          })}
        </div>
        <select className="field mt-1" value={c.location ?? ""} onChange={(e) => set({ location: e.target.value || undefined })} aria-label="Location">
          <option value="">Location: not set</option>{locations.map((l) => <option key={l.id} value={l.name}>{l.name}</option>)}
        </select>
      </fieldset>

      <details open={more} onToggle={(e) => setMore((e.target as HTMLDetailsElement).open)} className="border border-line p-2">
        <summary className="cursor-pointer text-sm font-medium">Camera &amp; lens (for experienced users)</summary>
        <fieldset className="mt-2 grid grid-cols-2 gap-2" disabled={ro}>
          <label className="col-span-2 flex flex-col gap-1 text-sm"><span className="label">Capture format</span>
            <select className="field" value={cam.formatId ?? "s35"} onChange={(e) => setCam({ formatId: e.target.value })}>
              {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.widthMm} × {f.heightMm} mm)</option>)}
              <option value="custom">Custom size…</option>
            </select></label>
          {cam.formatId === "custom" && (<>
            <label className="flex flex-col gap-1 text-sm"><span className="label">Width (mm)</span><input type="number" step="0.01" className="field" value={cam.widthMm ?? ""} onChange={(e) => setCam({ widthMm: num(e.target.value) })} /></label>
            <label className="flex flex-col gap-1 text-sm"><span className="label">Height (mm)</span><input type="number" step="0.01" className="field" value={cam.heightMm ?? ""} onChange={(e) => setCam({ heightMm: num(e.target.value) })} /></label>
          </>)}
          <label className="flex flex-col gap-1 text-sm"><span className="label">Focal length (mm)</span><input type="number" step="1" min="4" className="field" value={cam.focalMm ?? ""} onChange={(e) => setCam({ focalMm: num(e.target.value) })} /></label>
          <label className="flex flex-col gap-1 text-sm"><span className="label">Aspect ratio</span>
            <select className="field" value={cam.aspect ?? defaultAspect ?? ""} onChange={(e) => setCam({ aspect: num(e.target.value) })}>
              <option value="">Storyboard default</option>{ASPECTS.map((a) => <option key={a.id} value={a.ratio}>{a.label}</option>)}
            </select></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!cam.anamorphic} onChange={(e) => setCam({ anamorphic: e.target.checked || undefined, squeeze: e.target.checked ? cam.squeeze ?? 2 : undefined })} /> Anamorphic</label>
          {cam.anamorphic && <label className="flex flex-col gap-1 text-sm"><span className="label">Squeeze</span>
            <select className="field" value={cam.squeeze ?? 2} onChange={(e) => setCam({ squeeze: Number(e.target.value) })}><option value={1.3}>1.3×</option><option value={1.5}>1.5×</option><option value={1.8}>1.8×</option><option value={2}>2×</option></select></label>}
          <label className="flex flex-col gap-1 text-sm"><span className="label">Aperture</span>
            <span className="flex gap-1">
              <select className="field w-16 px-1" value={cam.apertureKind ?? "f"} onChange={(e) => setCam({ apertureKind: e.target.value as "f" | "T" })} aria-label="f-number or T-stop"><option value="f">f/</option><option value="T">T</option></select>
              <input type="number" step="0.1" min="0.7" className="field" value={cam.aperture ?? ""} onChange={(e) => setCam({ aperture: num(e.target.value) })} aria-label="Aperture value" />
            </span></label>
          <label className="flex flex-col gap-1 text-sm"><span className="label">Focus distance (m)</span><input type="number" step="0.1" className="field" value={cam.focusM ?? ""} onChange={(e) => setCam({ focusM: num(e.target.value) })} /></label>
          <label className="flex flex-col gap-1 text-sm"><span className="label">Camera height (m)</span><input type="number" step="0.1" className="field" value={cam.cameraHeightM ?? ""} onChange={(e) => setCam({ cameraHeightM: num(e.target.value) })} /></label>
          <label className="flex flex-col gap-1 text-sm"><span className="label">Tilt (°, + up)</span><input type="number" step="1" className="field" value={cam.tiltDeg ?? ""} onChange={(e) => setCam({ tiltDeg: num(e.target.value) })} /></label>
          <label className="flex flex-col gap-1 text-sm"><span className="label">Pan (°)</span><input type="number" step="1" className="field" value={cam.panDeg ?? ""} onChange={(e) => setCam({ panDeg: num(e.target.value) })} /></label>
          <label className="col-span-2 flex flex-col gap-1 text-sm"><span className="label">Lens (library)</span>
            <select className="field" value={c.lensId ?? ""} onChange={(e) => set({ lensId: e.target.value || undefined })}>
              <option value="">None</option>{lib.lenses.map((l) => <option key={l.id} value={l.id}>{l.manufacturer} {l.model} ({l.optical}{l.squeeze ? ` ${l.squeeze}×` : ""}; {l.verification.replace("_", " ")})</option>)}
            </select></label>
          <label className="col-span-2 flex flex-col gap-1 text-sm"><span className="label">Lens character (creative guidance)</span>
            <input className="field" value={c.lensCharacter ?? ""} onChange={(e) => set({ lensCharacter: e.target.value || undefined })} placeholder="e.g. soft edges, warm flares" maxLength={300} /></label>
        </fieldset>
        <div className="mt-2 border-t border-line pt-2 text-xs text-muted" aria-live="polite">
          {fov ? (
            <ul className="flex flex-col gap-0.5">
              <li>Field of view: {Math.round(fov.h)}° × {Math.round(fov.v)}° (calculated from format, focal length{cam.anamorphic ? ", squeeze" : ""} and aspect).</li>
              {eq && <li>Same view as about {Math.round(eq)} mm on full frame.</li>}
              {dist && <li>For a {labelOf(SIZES, c.size).toLowerCase()} shot of a person, the camera is about {round(dist, 1)} m away. Moving the camera changes perspective; the focal length only changes how much fits.</li>}
              {dof && <li>Depth of field: sharp from {round(dof.nearM, 2)} m to {dof.farM ? `${round(dof.farM, 2)} m` : "infinity"}{dof.approximate ? " (approximate: T-stops and anamorphics don't map exactly)" : ""}.</li>}
              <li>These numbers are calculated; the image model treats them as creative guidance.</li>
            </ul>
          ) : <p>Add a focal length to see the field of view and camera distance.</p>}
        </div>
      </details>

      {canEdit && !shot.locked && (
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn-primary" disabled={!dirty}>Save shot</button>
          {dirty && <button type="button" className="btn" onClick={() => setC(shot.content)}>Undo changes</button>}
          <button type="button" className="btn ml-auto" onClick={onRemove}>Remove</button>
        </div>
      )}
      {shot.state === "approved" && dirty && <p className="help">Saving changes makes this an unapproved proposal again (the approved version is kept in history).</p>}
    </form>
  );
}

function LookPanel({ settings, lib, canEdit, onChange }: { settings: { style?: string; aspect?: number; finishId?: string; stockId?: string }; lib: Lib; canEdit: boolean; onChange: (s: Record<string, unknown>) => void }) {
  const stock = lib.stocks.find((s) => s.id === settings.stockId);
  const finish = lib.finishes.find((f) => f.id === (settings.finishId ?? "none"));
  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-1" disabled={!canEdit}>
        <legend className="label">Storyboard drawing style</legend>
        <div className="grid grid-cols-2 gap-1">
          {STYLES.map(([k, l]) => <button key={k} type="button" aria-pressed={(settings.style ?? "pencil") === k} onClick={() => onChange({ style: k })} className={`btn min-h-9 px-2 text-xs ${(settings.style ?? "pencil") === k ? "btn-primary" : ""}`}>{l}</button>)}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1 text-sm"><span className="label">Default aspect ratio</span>
        <select className="field" value={settings.aspect ?? 16 / 9} onChange={(e) => onChange({ aspect: Number(e.target.value) })} disabled={!canEdit}>
          {ASPECTS.map((a) => <option key={a.id} value={a.ratio}>{a.label}</option>)}
        </select></label>
      <section className="flex flex-col gap-2 border-t border-line pt-3">
        <h3 className="font-semibold">Look Preview</h3>
        <p className="help">A photographic approximation of an approved shot, linked to its storyboard composition. It doesn&apos;t reproduce real lens optics or film response.</p>
        <label className="flex flex-col gap-1 text-sm"><span className="label">Film stock reference</span>
          <select className="field" value={settings.stockId ?? ""} onChange={(e) => onChange({ stockId: e.target.value || undefined })} disabled={!canEdit}>
            <option value="">None</option>{lib.stocks.map((s) => <option key={s.id} value={s.id}>{s.manufacturer} {s.stock} ({s.product_codes.join("/")})</option>)}
          </select></label>
        {stock && (
          <div className="border border-line p-2 text-xs">
            <p><b>{stock.manufacturer} {stock.stock}</b> · motion-picture camera negative · {stock.gauges.join(", ")}</p>
            <p>EI {stock.ei_tungsten} tungsten (3200K) · EI {stock.ei_daylight} daylight · balanced for {stock.balance}</p>
            <p className="mt-1">From {stock.manufacturer}: {stock.documented}</p>
            <p className="mt-1 text-muted">{stock.editorial}</p>
            <p className="mt-1 text-muted">Source: {stock.source_urls.map((u, i) => <a key={u} href={u} target="_blank" rel="noreferrer" className="underline">{i ? ", " : ""}{stock.manufacturer} document {i + 1}</a>)} · {stock.verification.replace("_", " ")}</p>
          </div>
        )}
        <label className="flex flex-col gap-1 text-sm"><span className="label">Finish (applied after generation)</span>
          <select className="field" value={settings.finishId ?? "none"} onChange={(e) => onChange({ finishId: e.target.value })} disabled={!canEdit}>
            {lib.finishes.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select></label>
        {finish && finish.id !== "none" && (
          <p className="text-xs text-muted">{finish.label === "stock-inspired" ? "Stock-inspired approximation." : ""} {finish.provenance} {finish.license}. Grain is added here as texture (scaled to resolution and format), so the image model is asked for a clean image.</p>
        )}
      </section>
      <section className="flex flex-col gap-1 border-t border-line pt-3 text-xs text-muted">
        <h3 className="text-sm font-semibold text-text">Libraries</h3>
        <p>Lenses: {lib.lenses.length} curated entries ({lib.lenses.filter((l) => l.verification === "generic").length} generic starting points). Production examples are kept apart from lens specifications; a film&apos;s look also comes from lighting, filtration, exposure, processing and grading.</p>
        <p>Stocks: Kodak VISION3 50D, 250D, 200T, 500T, checked against Kodak&apos;s own documents.</p>
      </section>
    </div>
  );
}

function RefsPanel({ entityId, refs, selected, cast, locations, canEdit, onSave, onRemove, onError }: {
  projectId: string; sequenceId: string; entityId: string; refs: EditorRef[]; selected: EditorShot | null;
  cast: { id: string; name: string }[]; locations: { id: string; name: string }[]; canEdit: boolean;
  onSave: (refId: string | null, data: Record<string, unknown>) => void; onRemove: (refId: string) => void; onError: (t: string) => void;
}) {
  const router = useRouter();
  const [role, setRole] = useState("character");
  const [scope, setScope] = useState<"all" | "shot">("all");
  const [borrow, setBorrow] = useState("");
  const [ignore, setIgnore] = useState("");
  const [url, setUrl] = useState("");
  const [attribution, setAttribution] = useState("");
  const [desc, setDesc] = useState("");
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const shotId = scope === "shot" ? selected?.id ?? null : null;
  const common = () => ({ role, borrow, ignore, shot_id: shotId, attribution });
  const grouped = useMemo(() => ({ all: refs.filter((r) => !r.shotId), shot: refs.filter((r) => r.shotId && r.shotId === selected?.id) }), [refs, selected]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(files).slice(0, 8)) {
        const reserve = await fetch("/api/assets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityId, fileName: f.name, mimeType: f.type, byteSize: f.size }) });
        const rj = (await reserve.json().catch(() => ({}))) as { assetId?: string; upload?: { url: string; method: string; headers: Record<string, string> }; error?: string };
        if (!reserve.ok || !rj.assetId || !rj.upload) throw new Error(rj.error ?? "Upload failed.");
        const put = await fetch(rj.upload.url, { method: rj.upload.method, headers: rj.upload.headers, body: f });
        if (!put.ok) throw new Error("The upload was interrupted.");
        const fin = await fetch(`/api/assets/${rj.assetId}/complete`, { method: "POST" });
        if (!fin.ok) throw new Error(((await fin.json().catch(() => ({}))) as { error?: string }).error ?? "Upload failed.");
        onSave(null, { ...common(), asset_id: rj.assetId, title: f.name.replace(/\.[a-z]+$/i, "") });
      }
      router.refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (file.current) file.current.value = "";
    }
  }

  const access = (a: string) => a === "accessible" ? "Sent as an image" : a === "text_only" ? "Described in words only" : a === "inaccessible" ? "Couldn't be opened" : "Link not checked: not sent, reuse rights unknown";
  const list = (items: EditorRef[]) => (
    <ul className="flex flex-col gap-2">
      {items.map((r) => (
        <li key={r.id} className="flex gap-2 border border-line p-2 text-sm">
          {r.assetId && /* eslint-disable-next-line @next/next/no-img-element */ <img src={`/api/assets/${r.assetId}`} alt="" className="size-14 shrink-0 object-cover" />}
          <div className="min-w-0 flex-1">
            <p className="font-medium">{ROLE_LABELS[r.role]}{r.title ? ` · ${r.title}` : ""}</p>
            {r.borrow && <p className="text-xs">Borrow: {r.borrow}</p>}
            {r.ignore && <p className="text-xs">Ignore: {r.ignore}</p>}
            {r.url && <p className="truncate text-xs"><a href={r.url} target="_blank" rel="noreferrer" className="underline">{r.url}</a></p>}
            {r.attribution && <p className="text-xs text-muted">Credit: {r.attribution}</p>}
            <p className={`text-[11px] uppercase tracking-[0.08em] ${r.access === "accessible" ? "text-muted" : "text-danger"}`}>{access(r.access)}</p>
          </div>
          {canEdit && <button type="button" className="self-start text-xs text-muted hover:text-text" onClick={() => onRemove(r.id)} aria-label={`Remove ${ROLE_LABELS[r.role]} reference`}>Remove</button>}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">For every shot (continuity)</h3>
        {grouped.all.length ? list(grouped.all) : <p className="help">None yet. Add the characters, places, wardrobe and props that should look the same in every frame.</p>}
      </section>
      {selected && (
        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">For this shot only</h3>
          {grouped.shot.length ? list(grouped.shot) : <p className="help">None.</p>}
        </section>
      )}
      {canEdit && (
        <section className="flex flex-col gap-2 border-t border-line pt-3" aria-label="Add a reference">
          <h3 className="font-semibold">Add a reference</h3>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm"><span className="label">What it&apos;s for</span>
              <select className="field" value={role} onChange={(e) => setRole(e.target.value)}>{Object.entries(ROLE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="flex flex-col gap-1 text-sm"><span className="label">Use it for</span>
              <select className="field" value={scope} onChange={(e) => setScope(e.target.value as "all" | "shot")}><option value="all">Every shot</option><option value="shot" disabled={!selected}>This shot only</option></select></label>
            <label className="col-span-2 flex flex-col gap-1 text-sm"><span className="label">Borrow</span><input className="field" value={borrow} onChange={(e) => setBorrow(e.target.value)} placeholder="e.g. her coat and hair" maxLength={600} /></label>
            <label className="col-span-2 flex flex-col gap-1 text-sm"><span className="label">Ignore</span><input className="field" value={ignore} onChange={(e) => setIgnore(e.target.value)} placeholder="e.g. the background, the colors" maxLength={600} /></label>
          </div>
          <div className="flex flex-col gap-2 border border-line p-2">
            <p className="text-sm font-medium">Your drawing or picture</p>
            <input ref={file} type="file" accept="image/png,image/jpeg" multiple onChange={(e) => upload(e.target.files)} disabled={uploading} aria-label="Upload images" />
            {uploading && <p className="help" role="status">Uploading…</p>}
          </div>
          <div className="flex flex-col gap-2 border border-line p-2">
            <p className="text-sm font-medium">From your film</p>
            <select className="field" defaultValue="" onChange={(e) => { if (e.target.value) { onSave(null, { ...common(), entity_id: e.target.value }); e.target.value = ""; } }} aria-label="Character or location">
              <option value="">Pick a character or location…</option>
              <optgroup label="Characters">{cast.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
              <optgroup label="Locations">{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</optgroup>
            </select>
            <p className="text-xs text-muted">Its artwork is sent as an image when it has some; otherwise its description is used in words.</p>
          </div>
          <div className="flex flex-col gap-2 border border-line p-2">
            <p className="text-sm font-medium">A link</p>
            <input className="field" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" type="url" aria-label="Image link" />
            <input className="field" value={attribution} onChange={(e) => setAttribution(e.target.value)} placeholder="Credit (who made it), if known" aria-label="Credit" maxLength={300} />
            <button type="button" className="btn self-start" disabled={!/^https:\/\//.test(url)} onClick={() => { onSave(null, { ...common(), url, title: url.replace(/^https:\/\/(www\.)?/, "").slice(0, 80) }); setUrl(""); }}>Add link</button>
            <p className="text-xs text-muted">A link doesn&apos;t prove the picture can be opened or reused, so it isn&apos;t sent to the image model. To use it as an image, import it in References first.</p>
          </div>
          <div className="flex flex-col gap-2 border border-line p-2">
            <p className="text-sm font-medium">Describe it in words</p>
            <input className="field" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. rainy neon street at night" maxLength={200} aria-label="Description" />
            <button type="button" className="btn self-start" disabled={!desc.trim()} onClick={() => { onSave(null, { ...common(), title: desc.trim() }); setDesc(""); }}>Add description</button>
          </div>
          <p className="text-xs text-muted">Studio doesn&apos;t promise perfect consistency between frames; regenerate, vary or edit a frame to correct it.</p>
        </section>
      )}
    </div>
  );
}
