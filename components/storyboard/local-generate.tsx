"use client";
// GENERATE LOCALLY: make one storyboard frame on the director's own computer from an explicit
// reference bundle (composition + cast + location + Look & Feel). The instruction is built
// from her shot fields with a fixed template (no language model). One press = one job;
// nothing generates on its own; approved or locked frames are never replaced by a result.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { cancelLocalJob, localJobs, myDevices, requestLocalJob, type LocalJob } from "@/app/projects/[projectId]/local-actions";
import { pickIllustration, setFrameState } from "@/app/projects/[projectId]/storyboard-actions";
import { RefVisual } from "@/components/look/parts";
import type { FilmEntity, FilmPicture } from "@/lib/look/data";
import { fitToWorkflow, instructionFor, outputSize, type Candidate } from "@/lib/local/bundle";
import { ROLE_LABEL, isOnline, type DeviceRow, type WorkflowReport } from "@/lib/local/types";
import type { LookDirection, LookRef } from "@/lib/look/types";
import { FRAME_W, frameH, type Composition } from "@/lib/storyboard/compose";
import { exportPng } from "@/lib/storyboard/render";
import { uploadImage } from "@/lib/storyboard/upload";
import { frameContext, lookFor, resolvedRefs } from "./look-refs";
import type { FrameRow, LensPick, LibItem } from "./types";

type Msg = (m: { kind: "error" | "notice"; text: string } | null) => void;
export interface LocalProps {
  projectId: string; sequenceId: string; entityId: string; frame: FrameRow; frameIndex: number; comp: Composition; canEdit: boolean;
  library: LibItem[]; entities: FilmEntity[]; pictures: FilmPicture[]; lookRefs: LookRef[]; directions: LookDirection[]; sequenceDirection: string | null;
  lenses: LensPick[]; devices: DeviceRow[]; jobs: LocalJob[]; onMessage: Msg; onChanged: () => void;
}

const ACTIVE = new Set(["queued", "running"]);
const ago = (iso: string | null) => (iso ? `${Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))} s` : "");

export function LocalGenerate(props: LocalProps) {
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState(props.jobs);
  const [devices, setDevices] = useState(props.devices);
  useEffect(() => setJobs(props.jobs), [props.jobs]);
  const mine = jobs.filter((j) => j.shotId === props.frame.id);
  const busy = jobs.some((j) => ACTIVE.has(j.status));
  const online = devices.some((d) => isOnline(d));

  // Poll only while something is waiting/running, or while the panel is open.
  const finished = useRef(new Set(jobs.filter((j) => !ACTIVE.has(j.status)).map((j) => j.id)));
  useEffect(() => {
    if (!busy && !open) return;
    const t = setInterval(async () => {
      const [js, ds] = await Promise.all([localJobs({ sequenceId: props.sequenceId }), myDevices()]);
      setJobs(js); setDevices(ds);
      const newlyDone = js.filter((j) => !ACTIVE.has(j.status) && !finished.current.has(j.id));
      newlyDone.forEach((j) => finished.current.add(j.id));
      if (newlyDone.some((j) => j.status === "succeeded")) props.onChanged();
    }, 3000);
    return () => clearInterval(t);
  }, [busy, open, props.sequenceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const last = mine[0];
  return (
    <>
      <button type="button" className={online ? "btn-primary" : "btn"} onClick={() => setOpen(true)} disabled={!props.canEdit}
        title={online ? "Generate this frame on your computer" : "Connect your computer first"}>
        Generate Locally{busy ? " ·" : ""}
      </button>
      {last && ACTIVE.has(last.status) && !open && (
        <span role="status" className="self-center text-xs text-muted">Frame {props.frameIndex + 1}: {last.status === "queued" ? "waiting for your computer" : last.progress?.message || "generating on your computer"}…</span>
      )}
      {open && <LocalDialog {...props} jobs={jobs} devices={devices} mine={mine} onClose={() => setOpen(false)}
        onSubmitted={async () => setJobs(await localJobs({ sequenceId: props.sequenceId }))} />}
    </>
  );
}

function LocalDialog(p: LocalProps & { mine: LocalJob[]; onClose: () => void; onSubmitted: () => Promise<void> }) {
  const { frame, comp } = p;
  const ready = p.devices.filter((d) => !d.revokedAt);
  const [deviceId, setDeviceId] = useState(ready.find((d) => isOnline(d))?.id ?? ready[0]?.id ?? "");
  const device = ready.find((d) => d.id === deviceId) ?? null;
  const workflows = (device?.report.workflows ?? []) as WorkflowReport[];
  const [wfId, setWfId] = useState(workflows.find((w) => w.ready)?.id ?? workflows[0]?.id ?? "");
  const wf = workflows.find((w) => w.id === wfId) ?? null;
  const [description, setDescription] = useState(frame.content.action ?? "");
  const [start, setStart] = useState<"composition" | "frame">("composition");
  const [preset, setPreset] = useState<"draft" | "refine">("draft");
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 2 ** 31));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID().replace(/-/g, ""));
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") p.onClose(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Who / where / how: from the frame's Refs ----
  const ctx = frameContext(frame, p.entities, p.library);
  const look = lookFor(frame, p.sequenceDirection, p.directions, p.lookRefs, p.entities, p.library);
  const lookList = resolvedRefs(look, p.lookRefs);
  const picsFor = (e: FilmEntity) => {
    const fromFilm = p.pictures.filter((x) => x.entityId === e.id).map((x) => ({ assetId: x.assetId, label: x.label }));
    const fromLook = p.lookRefs.filter((r) => r.sourceEntityId === e.id && r.assetId).map((r) => ({ assetId: r.assetId!, label: r.title }));
    return [...fromFilm, ...fromLook].filter((x, i, a) => a.findIndex((y) => y.assetId === x.assetId) === i);
  };
  const [castPick, setCastPick] = useState<Record<string, string>>(() => Object.fromEntries(ctx.cast.map((e) => [e.id, picsFor(e)[0]?.assetId ?? ""])));
  const [placePick, setPlacePick] = useState(() => (ctx.place ? picsFor(ctx.place)[0]?.assetId ?? "" : ""));
  const [lookOn, setLookOn] = useState<Record<string, boolean>>(() => Object.fromEntries(lookList.map((r) => [r.id, true])));

  const aspect = FRAME_W / frameH(comp);
  const size = wf ? outputSize(aspect, wf.presets[preset].longSide, wf.sizes) : null;
  const lens = p.lenses.find((l) => l.id === frame.content.lensId);
  const lensNote = [lens?.name, frame.content.camera?.focalMm ? `${frame.content.camera.focalMm} mm` : ""].filter(Boolean).join(" ");

  const cands: Candidate[] = useMemo(() => {
    const out: Candidate[] = [];
    if (start === "frame" && frame.illustrationAssetId) out.push({ role: "start_frame", asset_id: frame.illustrationAssetId, label: `Frame ${p.frameIndex + 1} (current picture)`, available: true });
    else out.push({ role: "composition", asset_id: "(rendered when you press Generate)", label: `Frame ${p.frameIndex + 1} composition`, available: comp.layers.length > 0, why: "The frame is empty: arrange or draw it first" });
    for (const e of ctx.cast) {
      const a = castPick[e.id];
      out.push({ role: "cast", asset_id: a || "", label: e.name, entity_id: e.id, available: !!a, why: e.thumb ? "Only a treatment crop (not an image file); add a picture of this character" : "No picture of this character yet" });
    }
    if (ctx.place) out.push({ role: "location", asset_id: placePick, label: ctx.place.name, entity_id: ctx.place.id, available: !!placePick, why: "No picture of this location yet (treatment crops can't be sent)" });
    for (const r of lookList) {
      if (!lookOn[r.id]) continue;
      out.push({ role: "look", asset_id: r.assetId ?? "", label: r.title, look_reference_id: r.id, use_for: r.useFor, leave_out: r.leaveOut, attribution: r.attribution, permission: r.permission,
        available: !!r.assetId, why: r.crop ? "Treatment crop (not an image file); described in words instead" : r.sourceUrl ? "Link only (no image)" : "Image missing" });
    }
    return out;
  }, [start, frame.illustrationAssetId, comp.layers.length, castPick, placePick, lookOn]); // eslint-disable-line react-hooks/exhaustive-deps
  const fit = fitToWorkflow(cands, wf);
  const facts = {
    description, dialogue: frame.content.dialogue, size: frame.content.size, angle: frame.content.angle, aspectLabel: `${aspect.toFixed(2)}:1`,
    lensNote: lensNote || undefined, castNames: ctx.cast.map((e) => e.name), place: ctx.place?.name,
    lookName: look.kind === "direction" ? look.direction.name : undefined, lookIntention: look.kind === "direction" ? look.direction.intention : undefined,
    palette: look.kind === "direction" ? look.direction.palette.map((c) => c.hex) : undefined,
  };
  // Look notes that couldn't be attached go in as words.
  const wordsOnly = fit.omitted.filter((o) => o.role === "look").map((o) => lookList.find((r) => r.title === o.label)).filter((r): r is LookRef => !!r);
  const instruction = instructionFor(facts, fit.inputs) + (wordsOnly.length ? `\nFurther look notes (no picture): ${wordsOnly.map((r) => `${r.title}${r.useFor ? ` (use for: ${r.useFor})` : ""}${r.leaveOut ? ` (leave out: ${r.leaveOut})` : ""}`).join("; ")}.` : "");
  const online = device ? isOnline(device) : false;
  const canSubmit = p.canEdit && !!device && !!wf?.ready && !busy && fit.inputs.some((i) => i.role === "composition" || i.role === "start_frame") && description.trim().length > 0;

  async function submit() {
    if (!device || !wf || !size) return;
    setBusy(true); setErr(null);
    try {
      let inputs = fit.inputs;
      let base: string | null = null;
      if (inputs[0]?.role === "composition") {
        const png = await exportPng(comp, size.width);
        if (!png.blob) throw new Error(`The composition couldn't be rendered: ${png.problems.join("; ")}`);
        base = await uploadImage(p.entityId, png.blob, `frame-${p.frameIndex + 1}-composition.png`);
        inputs = [{ ...inputs[0], asset_id: base }, ...inputs.slice(1)];
      }
      const bundle = {
        format: 1, created_at: new Date().toISOString(),
        shot: { id: frame.id, sequence_id: p.sequenceId, frame_number: p.frameIndex + 1, scene: frame.content.source?.scene ?? null, description, dialogue: frame.content.dialogue ?? null,
          size: frame.content.size ?? null, angle: frame.content.angle ?? null, aspect, lens: lensNote || null, frame_revision: frame.revision, composition_version: frame.compositionVersion },
        cast: ctx.cast.map((e) => ({ entity_id: e.id, name: e.name, asset_id: castPick[e.id] || null })),
        location: ctx.place ? { entity_id: ctx.place.id, name: ctx.place.name, asset_id: placePick || null } : null,
        look: look.kind === "direction" ? { direction_id: look.direction.id, version: look.direction.version, name: look.direction.name } : look.kind === "references" ? { references: look.refs.map((r) => r.id) } : null,
        inputs, omitted: fit.omitted, warnings: fit.warnings,
        workflow: { id: wf.id, version: wf.version, model: wf.model, license: wf.license }, renderer: { device_id: device.id, name: device.name },
        start_from: inputs[0]?.role, preset, text_from: "template local-template-v1 (no language model)",
      };
      const r = await requestLocalJob({ shotId: frame.id, deviceId: device.id, workflow: wf.id, prompt: instruction,
        params: { preset, seed, width: size.width, height: size.height }, bundle, baseAssetId: base, key });
      if (!r.ok) throw new Error(r.error);
      setKey(crypto.randomUUID().replace(/-/g, ""));
      p.onMessage({ kind: "notice", text: online ? "Sent to your computer. Progress shows below." : "Saved. It starts when your computer checks in (run the Studio companion)." });
      await p.onSubmitted();
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't send the frame."); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-2 sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="local-h" className="panel flex w-full max-w-5xl flex-col gap-4 bg-panel p-4 outline-none sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div><p className="eyebrow">Frame {p.frameIndex + 1}</p><h2 id="local-h" className="display text-3xl">Generate Locally</h2></div>
          <button type="button" className="btn min-h-9 px-3 text-xs" onClick={p.onClose}>Close (back to the editable frame)</button>
        </div>

        {/* Renderer status */}
        <section className="flex flex-wrap items-center gap-2 border-l-2 border-line pl-3 text-sm" aria-label="Your computer">
          {ready.length === 0 ? (
            <span>No computer connected. <Link className="underline" href={`/projects/${p.projectId}/storyboards/renderer`}>Connect Local Renderer</Link>. You can keep composing frames by hand meanwhile.</span>
          ) : (<>
            <label className="flex items-center gap-1">Computer
              <select className="field w-auto py-1" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>{ready.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
            <span className={`border px-1.5 py-0.5 text-[10px] font-semibold ${online ? "border-brand bg-brand text-ink" : "border-line text-muted"}`}>{online ? "Connected" : "Not running"}</span>
            {device?.report.gpus?.[0] && <span className="text-xs text-muted">{device.report.gpus[0].name}{device.report.gpus[0].vramTotalMb ? ` · ${(device.report.gpus[0].vramTotalMb / 1024).toFixed(0)} GB` : ""}</span>}
            {workflows.length > 0 && (
              <label className="flex items-center gap-1">Workflow
                <select className="field w-auto py-1" value={wfId} onChange={(e) => setWfId(e.target.value)}>{workflows.map((w) => <option key={w.id} value={w.id}>{w.title}{w.ready ? "" : " (not ready)"}</option>)}</select></label>
            )}
            <Link className="text-xs underline" href={`/projects/${p.projectId}/storyboards/renderer`}>Setup &amp; capabilities</Link>
          </>)}
          {wf && !wf.ready && <span className="w-full text-xs text-danger">Not ready on this computer: {wf.problems.join(" · ")}</span>}
        </section>

        <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1"><span className="label">What happens in this frame</span>
              <textarea className="field min-h-20" maxLength={900} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
            {frame.illustrationAssetId && (
              <fieldset className="flex flex-wrap gap-3 text-sm"><legend className="label mb-1">Start from</legend>
                <label className="flex items-center gap-1.5"><input type="radio" checked={start === "composition"} onChange={() => setStart("composition")} /> My composition</label>
                <label className="flex items-center gap-1.5"><input type="radio" checked={start === "frame"} onChange={() => setStart("frame")} /> The picture this frame shows now (revise it)</label>
              </fieldset>
            )}

            <section aria-label="Cast" className="flex flex-col gap-1 text-sm">
              <span className="label">Cast: appearance and identity</span>
              {ctx.cast.length === 0 ? <span className="text-xs text-muted">No characters chosen for this frame (Refs tab).</span> : ctx.cast.map((e) => {
                const pics = picsFor(e);
                return <label key={e.id} className="flex flex-wrap items-center gap-2">{e.name}
                  <select className="field w-auto py-1 text-xs" value={castPick[e.id] ?? ""} onChange={(ev) => setCastPick({ ...castPick, [e.id]: ev.target.value })}>
                    <option value="">— no picture —</option>{pics.map((x) => <option key={x.assetId} value={x.assetId}>{x.label}</option>)}</select>
                  {!pics.length && <span className="text-xs text-muted">no picture file yet</span>}</label>;
              })}
            </section>
            <section aria-label="Location" className="flex flex-col gap-1 text-sm">
              <span className="label">Location: environment and space</span>
              {!ctx.place ? <span className="text-xs text-muted">No location chosen for this frame (Refs tab).</span> : (
                <label className="flex flex-wrap items-center gap-2">{ctx.place.name}
                  <select className="field w-auto py-1 text-xs" value={placePick} onChange={(ev) => setPlacePick(ev.target.value)}>
                    <option value="">— no picture —</option>{picsFor(ctx.place).map((x) => <option key={x.assetId} value={x.assetId}>{x.label}</option>)}</select></label>
              )}
            </section>
            <section aria-label="Look and Feel" className="flex flex-col gap-1 text-sm">
              <span className="label">Look &amp; Feel: illustration, palette, light, texture</span>
              <span className="text-xs">{look.kind === "direction" ? <>Direction <b>{look.direction.name}</b> (version {look.direction.version})</> : look.kind === "references" ? "References chosen for this frame" : look.kind === "conflict" ? "Two directions apply: choose one in the Refs tab first" : "No Look & Feel chosen"}</span>
              <div className="flex flex-wrap gap-1">
                {lookList.map((r) => (
                  <label key={r.id} className={`flex items-center gap-1 border p-0.5 pr-1.5 text-[11px] ${lookOn[r.id] ? "border-brand" : "border-line opacity-60"}`}>
                    <input type="checkbox" checked={!!lookOn[r.id]} onChange={(e) => setLookOn({ ...lookOn, [r.id]: e.target.checked })} />
                    <span className="size-7 overflow-hidden"><RefVisual r={r} /></span>{r.title.slice(0, 20)}</label>
                ))}
              </div>
            </section>

            <fieldset className="flex flex-wrap items-center gap-3 text-sm"><legend className="label mb-1">Quality</legend>
              {(["draft", "refine"] as const).map((k) => <label key={k} className="flex items-center gap-1.5"><input type="radio" checked={preset === k} onChange={() => setPreset(k)} /> {k === "draft" ? "Draft" : "Refine"}{wf ? ` (${outputSize(aspect, wf.presets[k].longSide, wf.sizes).width}×${outputSize(aspect, wf.presets[k].longSide, wf.sizes).height})` : ""}</label>)}
            </fieldset>
            {wf && <p className="text-xs text-muted">{wf.settingsNote || "Starting settings for this workflow."} Draft is smaller, so it usually takes less memory; time and quality aren&apos;t guaranteed.</p>}
            {wf?.params.seed && (
              <details className="text-sm"><summary className="cursor-pointer">Advanced</summary>
                <label className="mt-2 flex items-center gap-2">Seed <input className="field w-36 py-1" inputMode="numeric" value={seed} onChange={(e) => setSeed(Number(e.target.value.replace(/\D/g, "")) || 0)} />
                  <button type="button" className="btn min-h-8 px-2 text-xs" onClick={() => setSeed(Math.floor(Math.random() * 2 ** 31))}>New seed</button></label>
                <p className="mt-1 text-xs text-muted">The same seed with the same settings often gives a similar picture, but not guaranteed (different model, driver or computer can change it). This workflow has no other adjustable settings{wf.params.strength ? "" : " (no image-to-image strength)"}.</p>
              </details>
            )}
          </div>

          {/* Bundle inspector */}
          <section className="flex flex-col gap-2 text-sm" aria-label="What will be sent to your computer">
            <h3 className="font-semibold">What goes to your computer</h3>
            <ol className="flex flex-col gap-1">
              {fit.inputs.map((i, k) => (
                <li key={k} className="flex items-center gap-2 border border-line p-1 text-xs">
                  <span className="w-14 shrink-0 font-mono">image {k + 1}</span>
                  {i.role !== "composition" && <img src={`/api/assets/${i.asset_id}`} alt="" className="size-9 shrink-0 bg-panel-2 object-cover" />} {/* eslint-disable-line @next/next/no-img-element */}
                  <span className="min-w-0 flex-1"><b>{i.label}</b><span className="block text-muted">{ROLE_LABEL[i.role]}{i.permission ? ` · permission: ${i.permission}` : ""}{i.attribution ? ` · © ${i.attribution}` : ""}</span></span>
                </li>
              ))}
            </ol>
            {fit.omitted.length > 0 && (
              <div className="text-xs"><p className="font-medium">Not sent</p>
                <ul className="list-disc pl-5">{fit.omitted.map((o, k) => <li key={k}>{o.label} ({ROLE_LABEL[o.role].split(" (")[0]}): {o.reason}</li>)}</ul></div>
            )}
            {fit.warnings.map((w, k) => <p key={k} className="border-l-2 border-brand pl-2 text-xs">{w}</p>)}
            {wf && !wf.conditioning.masks && <p className="text-xs text-muted">Editing just one region isn&apos;t supported by this workflow; revise by starting from the frame&apos;s picture instead.</p>}
            <details className="text-xs"><summary className="cursor-pointer">Instruction text (built from your frame with a fixed template; no AI writes it)</summary>
              <pre className="mt-1 whitespace-pre-wrap bg-panel-2 p-2">{instruction}</pre></details>
            <p className="border-t border-line pt-2 text-xs">
              <b>Where it happens:</b> {device ? `“${device.name}”` : "your computer"} downloads {fit.inputs.length} picture{fit.inputs.length === 1 ? "" : "s"} from Studio&apos;s storage{fit.inputs[0]?.role === "composition" ? " (your composition is saved to Studio first)" : ""}, generates the frame there, keeps a copy in its results folder, and uploads the result to Studio. No cloud image service is used.
              {frame.state === "approved" || frame.locked ? " This frame is approved/locked: the result is kept in its history and won't replace what it shows." : ""}
            </p>
            {err && <p role="alert" className="text-danger">{err}</p>}
            <button type="button" className="btn-primary" disabled={!canSubmit} onClick={submit}>{busy ? "Sending…" : "Generate Locally"}</button>
            {!online && device && <p className="text-xs text-muted">Your computer isn&apos;t running the companion right now; the frame waits until it checks in.</p>}
          </section>
        </div>

        <Results {...p} />
      </div>
    </div>
  );
}

function Results(p: LocalProps & { mine: LocalJob[] }) {
  const [cmp, setCmp] = useState<string[]>([]);
  const done = p.mine.filter((j) => j.outputAssetId);
  async function act(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    const r = await fn();
    p.onMessage(r.ok ? { kind: "notice", text: ok } : { kind: "error", text: (r as { error: string }).error });
    if (r.ok) p.onChanged();
  }
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-3" aria-label="Results for this frame">
      <h3 className="font-semibold">This frame&apos;s local results</h3>
      {p.mine.length === 0 ? <p className="help">Nothing generated yet.</p> : (
        <ul className="flex flex-col gap-1 text-xs">
          {p.mine.filter((j) => !j.outputAssetId).slice(0, 6).map((j) => (
            <li key={j.id} className="flex flex-wrap items-center gap-2 border border-line p-1.5">
              <b>{j.status === "queued" ? "Waiting for your computer" : j.status === "running" ? (j.cancelRequested ? "Asked your computer to stop…" : j.progress?.message || "Working on your computer") : j.status === "cancelled" ? "Cancelled" : "Failed"}</b>
              <span className="text-muted">{new Date(j.createdAt).toLocaleTimeString()}{j.status === "running" && j.startedAt ? ` · ${ago(j.startedAt)}` : ""}</span>
              {j.error && <span className="w-full text-danger">{j.error}{j.progress?.local_file ? ` (file: ${j.progress.local_file})` : ""}</span>}
              {ACTIVE.has(j.status) && <button type="button" className="btn ml-auto min-h-7 px-2 text-[11px]" onClick={async () => {
                const r = await cancelLocalJob({ jobId: j.id });
                p.onMessage(!r.ok ? { kind: "error", text: r.error } : { kind: "notice", text: r.data === "cancelled" ? "Cancelled before it started." : r.data === "stop_requested" ? "Asked your computer to stop. If it was almost done, the picture may still arrive (it won't replace anything)." : r.data === "stopped_waiting" ? "Studio stopped waiting: your computer wasn't reachable. If it finishes later, the picture is kept in this list." : `Job is ${r.data}.` });
              }}>Cancel</button>}
            </li>
          ))}
        </ul>
      )}
      {done.length > 0 && (
        <>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {done.map((j) => {
              const shown = p.frame.illustrationAssetId === j.outputAssetId;
              return (
                <li key={j.id} className={`flex flex-col border ${shown ? "border-brand" : "border-line"} text-[11px]`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/assets/${j.outputAssetId}`} alt={`Result ${new Date(j.createdAt).toLocaleString()}`} className="aspect-video w-full bg-panel-2 object-contain" loading="lazy" />
                  <span className="p-1">{new Date(j.createdAt).toLocaleString()} · {String(j.params.preset ?? "")} · seed {String(j.params.seed ?? "?")}{j.usage?.seconds ? ` · ${j.usage.seconds}s` : ""}{shown ? " · shown" : ""}</span>
                  <span className="flex flex-wrap gap-1 p-1 pt-0">
                    {p.canEdit && !shown && !p.frame.locked && <button type="button" className="btn min-h-7 px-2 text-[11px]" onClick={() => act(() => pickIllustration({ shotId: p.frame.id, assetId: j.outputAssetId }), "Shown on the frame.")}>Show on frame</button>}
                    <label className="flex items-center gap-1"><input type="checkbox" checked={cmp.includes(j.id)} onChange={(e) => setCmp((c) => (e.target.checked ? [...c, j.id].slice(-2) : c.filter((x) => x !== j.id)))} /> Compare</label>
                  </span>
                </li>
              );
            })}
          </ul>
          {cmp.length === 2 && (
            <div className="grid grid-cols-2 gap-2" aria-label="Compare two results">
              {cmp.map((id) => { const j = done.find((x) => x.id === id)!; return /* eslint-disable-next-line @next/next/no-img-element */ <img key={id} src={`/api/assets/${j.outputAssetId}`} alt="Compared result" className="w-full bg-panel-2 object-contain" />; })}
            </div>
          )}
          {p.canEdit && (
            <div className="flex flex-wrap gap-2 text-xs">
              {p.frame.illustrationAssetId && p.frame.state !== "approved" && <button type="button" className="btn min-h-8 px-2 text-xs" onClick={() => act(() => setFrameState({ shotId: p.frame.id, state: "approved", locked: true }), "Approved and locked. New results won't replace it.")}>Approve &amp; lock this frame</button>}
              <span className="self-center text-muted">For a variation, change the seed (Advanced) and generate again; to regenerate, press Generate Locally again. Each press is one new job; earlier results stay here.</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}
