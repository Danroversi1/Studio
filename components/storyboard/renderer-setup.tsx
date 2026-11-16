"use client";
// Connect Local Renderer: pair her computer, see what it reports, and what each installed
// workflow really supports. Nothing is installed or downloaded from here.
import { useEffect, useState } from "react";
import { myDevices, revokeDevice, saveManualHardware, startPairing } from "@/app/projects/[projectId]/local-actions";
import { isOnline, type DeviceRow, type WorkflowReport } from "@/lib/local/types";

const CAPS: [keyof WorkflowReport["conditioning"], string][] = [
  ["editInput", "Starts from your composition picture"], ["referenceImages", "Reference pictures (cast, location, look)"],
  ["distinctRoles", "Keeps picture roles apart by itself"], ["sketchControl", "Sketch / edge guidance"], ["depthControl", "Depth guidance"],
  ["poseControl", "Pose guidance"], ["masks", "Edit just one region (masks)"], ["characterAdapter", "Character adapters"],
];

export function RendererSetup({ initial }: { initial: DeviceRow[] }) {
  const [devices, setDevices] = useState(initial);
  const [code, setCode] = useState<{ code: string; until: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [origin, setOrigin] = useState("https://studio-one-omega-46.vercel.app");
  useEffect(() => { setOrigin(window.location.origin); }, []);
  useEffect(() => {
    const t = setInterval(() => { void myDevices().then(setDevices); }, 5000);
    return () => clearInterval(t);
  }, []);
  const pair = async () => {
    setErr(null);
    const r = await startPairing();
    if (!r.ok) setErr(r.error); else setCode({ code: r.data, until: Date.now() + 10 * 60_000 });
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="panel flex flex-col gap-2 p-5 text-sm">
        <h2 className="display text-xl">What this needs</h2>
        <ul className="list-disc pl-5">
          <li><b>A computer with a suitable graphics card</b>, where you&apos;re allowed to install programs. The first workflow uses FLUX.2 [klein] 4B: Black Forest Labs says it fits in about 13 GB of graphics memory; ComfyUI measured 8.4 GB on a top-end card. Less memory may fail with an “out of memory” error, which Studio reports without losing your frame.</li>
          <li><b>ComfyUI</b> (free, open source) running on that computer, and the model files (several GB, downloaded by you, under the Apache-2.0 license). Studio never downloads or installs anything on your computer.</li>
          <li><b>The Studio companion</b>, a small Python program (<a className="underline" href="/renderer/studio_renderer.py" download>studio_renderer.py</a>, <a className="underline" href="/renderer/README.md" target="_blank" rel="noreferrer">setup guide</a>, <a className="underline" href="/renderer/workflows/flux2-klein-4b-refs/manifest.json" target="_blank" rel="noreferrer">workflow manifest</a>). It connects out to Studio; Studio never connects into your computer, and your browser&apos;s security settings stay as they are.</li>
        </ul>
        <p className="help">Generating on your own computer avoids cloud image charges, but it still uses your graphics card, memory, electricity and time. Results vary from run to run.</p>
      </section>

      <section className="panel flex flex-col gap-3 p-5">
        <h2 className="display text-xl">Connect a computer</h2>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
          <li>On that computer: install ComfyUI and the workflow (setup guide, steps 1–4), then start ComfyUI.</li>
          <li>
            <button type="button" className="btn-primary" onClick={pair}>Make a pairing code</button>
            {code && (
              <span className="mt-2 block">Code (works once, for 10 minutes): <b className="font-mono text-lg tracking-[0.2em]">{code.code}</b>
                <code className="mt-1 block overflow-x-auto bg-panel-2 p-2 text-xs">python studio_renderer.py pair {code.code} --studio {origin}</code></span>
            )}
            {err && <span role="alert" className="block text-danger">{err}</span>}
          </li>
          <li>Then keep this running while you work: <code className="bg-panel-2 px-1 text-xs">python studio_renderer.py run</code>. It shows up below within a few seconds.</li>
        </ol>
      </section>

      {devices.length === 0 ? <p className="help">No computer connected yet. You can keep composing frames by hand without one.</p> : devices.map((d) => <Device key={d.id} d={d} onChanged={() => void myDevices().then(setDevices)} />)}
    </div>
  );
}

function Device({ d, onChanged }: { d: DeviceRow; onChanged: () => void }) {
  const r = d.report;
  const online = isOnline(d);
  const [manual, setManual] = useState({ gpu: r.manual?.gpu ?? "", vramGb: r.manual?.vramGb ? String(r.manual.vramGb) : "", notes: r.manual?.notes ?? "" });
  const [msg, setMsg] = useState<string | null>(null);
  const wfs = r.workflows ?? [];
  return (
    <section className="panel flex flex-col gap-3 p-5" aria-label={`Computer ${d.name}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold">{d.name}</h3>
        <span className={`border px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.1em] uppercase ${online ? "border-brand bg-brand text-white" : "border-line text-muted"}`}>{online ? "Connected" : "Not running"}</span>
        <span className="text-xs text-muted">{d.lastSeenAt ? `last checked in ${new Date(d.lastSeenAt).toLocaleString()}` : "never checked in"}</span>
        <button type="button" className="btn ml-auto min-h-8 px-2 text-xs text-danger" onClick={async () => { const x = await revokeDevice({ deviceId: d.id }); if (x.ok) onChanged(); else setMsg(x.error); }}>Disconnect this computer</button>
      </div>
      <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted">Operating system</dt><dd>{r.os ?? "not reported"}</dd>
        <dt className="text-muted">Renderer</dt><dd>{r.rendererKind ? `${r.rendererKind}${r.rendererVersion ? ` ${r.rendererVersion}` : ""} on this computer only` : "not reported"}{r.rendererReachable === false && <span className="block text-danger">{r.rendererError}</span>}</dd>
        <dt className="text-muted">Compute</dt><dd>{r.backend ?? "not reported"}</dd>
        <dt className="text-muted">Graphics card</dt>
        <dd>{r.gpus?.length ? r.gpus.map((g) => `${g.name}${g.vramTotalMb ? ` · ${(g.vramTotalMb / 1024).toFixed(1)} GB` : ""}${g.vramFreeMb ? ` (${(g.vramFreeMb / 1024).toFixed(1)} GB free)` : ""}`).join("; ") : "not reported by the renderer"}
          {r.manual?.gpu && <span className="block text-xs text-muted">You entered: {r.manual.gpu}{r.manual.vramGb ? `, ${r.manual.vramGb} GB` : ""}</span>}</dd>
        <dt className="text-muted">Companion</dt><dd>{r.companionVersion ? `version ${r.companionVersion}, Python ${r.python ?? "?"}` : "not reported"}</dd>
      </dl>
      {!r.gpus?.length && (
        <form className="flex flex-wrap items-end gap-2 border-l-2 border-line pl-3 text-xs" onSubmit={async (e) => { e.preventDefault(); const x = await saveManualHardware({ deviceId: d.id, ...manual }); setMsg(x.ok ? "Saved." : x.error); if (x.ok) onChanged(); }}>
          <span className="w-full">The renderer didn&apos;t report a graphics card. If you know it, add it here (it&apos;s only a note: Studio doesn&apos;t guess from your browser).</span>
          <label className="flex flex-col gap-1">Graphics card<input className="field py-1" value={manual.gpu} maxLength={120} onChange={(e) => setManual({ ...manual, gpu: e.target.value })} placeholder="e.g. RTX 4070" /></label>
          <label className="flex flex-col gap-1">Memory (GB)<input className="field w-20 py-1" value={manual.vramGb} onChange={(e) => setManual({ ...manual, vramGb: e.target.value })} inputMode="decimal" /></label>
          <button type="submit" className="btn min-h-8 px-2 text-xs">Save</button>
        </form>
      )}
      {msg && <p role="status" className="text-xs">{msg}</p>}

      <h4 className="font-semibold">Workflows on this computer</h4>
      {wfs.length === 0 ? <p className="help">None reported yet.</p> : (
        <>
          {wfs.map((w) => (
            <div key={w.id} className={`border-l-2 pl-3 text-sm ${w.ready ? "border-brand" : "border-danger"}`}>
              <p><b>{w.title}</b> <span className="text-xs text-muted">({w.id} v{w.version}) · {w.model} · license: {w.license}{w.licenseUrl && <> · <a className="underline" href={w.licenseUrl} target="_blank" rel="noreferrer">model card</a></>}</span></p>
              {w.ready ? <p className="text-xs">Ready: nodes and model files found.</p> : <ul className="list-disc pl-5 text-xs text-danger">{w.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
              {w.settingsNote && <p className="text-xs text-muted">{w.settingsNote}</p>}
            </div>
          ))}
          <div className="overflow-x-auto">
            <table className="min-w-[28rem] text-xs">
              <caption className="mb-1 text-left text-muted">What each workflow can do (as checked on this computer)</caption>
              <thead><tr><th className="p-1 text-left">Capability</th>{wfs.map((w) => <th key={w.id} className="p-1 text-left">{w.id}</th>)}</tr></thead>
              <tbody>
                {CAPS.map(([k, label]) => (
                  <tr key={k} className="border-t border-line"><td className="p-1">{label}</td>{wfs.map((w) => <td key={w.id} className="p-1">{w.conditioning[k] ? (k === "referenceImages" ? `yes, up to ${w.maxImages - 1}` : "yes") : "no"}</td>)}</tr>
                ))}
                <tr className="border-t border-line"><td className="p-1">Output sizes</td>{wfs.map((w) => <td key={w.id} className="p-1">{w.sizes.min}–{w.sizes.max}px, multiples of {w.sizes.multiple}</td>)}</tr>
                <tr className="border-t border-line"><td className="p-1">Settings you can change</td>{wfs.map((w) => <td key={w.id} className="p-1">{["seed", "steps", "strength"].filter((p) => w.params[p as keyof typeof w.params]).join(", ") || "none"}</td>)}</tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
