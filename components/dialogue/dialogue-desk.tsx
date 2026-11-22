"use client";
// Script desk: scenes from the outline, proposed dialogue and her decisions. Proposals sit
// beside her script; accepting writes a new revision and changes only that scene.
import { ActionStatus as Status, useAction as useRun } from "@/components/use-action";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { acceptDialogue, cancelDialogue, checkDialogueResearch, continueDrafts, decideDialogue, developDialogue, pinSceneResearch, reviewDialogue, saveAutoDraft } from "@/app/projects/[projectId]/dialogue-actions";
import { saveSceneContext } from "@/app/projects/[projectId]/connect-actions";
import type { ProposalView } from "@/lib/dialogue/data";
import { renderElements, type DialogueElement } from "@/lib/dialogue/scenes";

interface SceneRow { key: string; heading: string; beatId: string | null; beatNumber: number | null; beatText: string | null; characters: string[]; text: string }
interface Ctx { scene_key: string; story_date: string | null; story_date_note: string | null; objectives: Record<string, string>; runtime_seconds: number | null; tone: string | null; pinned_snapshot_id: string | null }

const STATUS: Record<string, { label: string; cls: string }> = {
  queued: { label: "Queued", cls: "border-line text-muted" }, drafting: { label: "Drafting…", cls: "border-warn text-warn" },
  ready: { label: "Ready to review", cls: "border-brand text-accent" }, failed: { label: "Failed", cls: "border-danger text-danger" },
  cancelled: { label: "Cancelled", cls: "border-line text-muted" }, accepted: { label: "Accepted", cls: "border-ok text-ok" },
  rejected: { label: "Rejected", cls: "border-line text-muted" }, superseded: { label: "Earlier draft", cls: "border-line text-muted" },
};
const BASIS: Record<string, { label: string; cls: string }> = {
  research: { label: "Research-informed", cls: "bg-[#2f6fd6]/10 text-[#2f6fd6]" }, canon: { label: "Your story", cls: "bg-ok-soft text-ok" },
  invention: { label: "New", cls: "bg-panel text-muted" }, adaptation: { label: "Proposed adaptation", cls: "bg-warn-soft text-warn" },
};
const FOCUS = [["", "Most useful"], ["distinction", "Character distinction"], ["subtext", "Subtext & intention"], ["progression", "Scene progression"],
  ["exposition", "Exposition"], ["continuity", "Continuity"], ["pacing", "Runtime & pacing"], ["research_use", "Research used naturally?"]] as const;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "");
const scriptDirty = () => typeof document !== "undefined" && document.getElementById("script-body")?.getAttribute("data-dirty") === "1";

function Badge({ s }: { s: string }) {
  const x = STATUS[s] ?? { label: s, cls: "border-line" };
  return <span className={`border px-1.5 py-0.5 text-[10px] font-semibold ${x.cls}`}>{x.label}</span>;
}


export function DialogueDesk({ projectId, canEdit, aiReady, provider, scenes, contexts, proposals, settings, characters, scriptVersionId }: {
  projectId: string; canEdit: boolean; aiReady: boolean; provider: string; scenes: SceneRow[]; contexts: Ctx[]; proposals: ProposalView[];
  settings: { auto_draft: boolean; paused: boolean }; characters: { id: string; name: string }[]; scriptVersionId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const s = useRun();
  const busy = proposals.some((p) => p.status === "queued" || p.status === "drafting");
  const kicked = useRef(false);
  // While drafts are waiting or drafting, keep the page current; pick up waiting Auto-drafts.
  useEffect(() => {
    if (!busy) return;
    if (!kicked.current && canEdit && aiReady && !proposals.some((p) => p.status === "drafting")) {
      kicked.current = true;
      continueDrafts({ projectId }).then(() => router.refresh()).catch(() => {}).finally(() => { kicked.current = false; });
    }
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [busy, canEdit, aiReady, projectId, proposals, router]);

  // Clicking a scene in her script (pages or editor) opens it here.
  const deskRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const onOpen = (e: Event) => {
      const { heading, nth } = (e as CustomEvent<{ heading: string; nth: number }>).detail;
      const same = scenes.filter((x) => x.heading.trim().toUpperCase() === heading.trim().toUpperCase());
      const sc = same[nth] ?? same[0];
      if (!sc) return;
      setOpen(sc.key);
      requestAnimationFrame(() => document.getElementById(`scene-${sc.key}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    };
    window.addEventListener("studio:open-scene", onOpen);
    return () => window.removeEventListener("studio:open-scene", onOpen);
  }, [scenes]);

  const latest = (key: string) => proposals.find((p) => p.scene_key === key);
  if (!scenes.length) return null;
  return (
    <section ref={deskRef} id="develop-scenes" className="panel flex scroll-mt-6 flex-col gap-4 p-4" aria-labelledby="dlg-h">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="dlg-h" className="display text-[22px]">Develop scenes</h2>
          <p className="max-w-2xl text-xs text-muted">
            Click a scene, here or in your script, to develop it: Develop scene drafts its action and dialogue from your outline beat, your characters and the research they may draw on.
            It&apos;s a proposal: your script only changes when you accept.
          </p>
          <p className="text-[11px] text-muted">Drafting and the script partner use {provider}. Nothing switches to another model on its own.</p>
        </div>
        {canEdit && aiReady && (
          <div className="flex flex-col items-end gap-1 text-xs">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={settings.auto_draft} disabled={s.pending}
                onChange={(e) => s.run(() => saveAutoDraft({ projectId, auto: e.target.checked, paused: e.target.checked ? false : null }), e.target.checked ? "Auto-draft is on." : "Auto-draft is off. Waiting auto-drafts were cancelled.")} />
              Auto-draft
            </label>
            {settings.auto_draft && (
              <button type="button" className="btn min-h-7 text-[11px]" disabled={s.pending}
                onClick={() => s.run(() => saveAutoDraft({ projectId, auto: null, paused: !settings.paused }), settings.paused ? "Auto-draft resumed." : "Auto-draft paused.")}>
                {settings.paused ? "Resume Auto-draft" : "Pause Auto-draft"}</button>
            )}
            <span className="max-w-64 text-right text-[11px] text-muted">
              {settings.auto_draft ? (settings.paused ? "Paused: saved beats don't queue drafts." : "When you save a substantially changed outline beat, its scenes get a new proposal. Feed updates never trigger drafts.")
                : "Off: drafts only when you press Develop scene."}</span>
          </div>
        )}
      </div>
      <Status msg={s.msg} />

      <ol className="flex flex-col divide-y divide-line border-y border-line">
        {scenes.map((sc, i) => {
          const p = latest(sc.key);
          const ctx = contexts.find((c) => c.scene_key === sc.key);
          return (
            <li key={sc.key} id={`scene-${sc.key}`} className={`flex scroll-mt-6 flex-col ${open === sc.key ? "bg-panel-2" : ""}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
                <button type="button" className="min-w-0 flex-1 text-left" aria-expanded={open === sc.key} onClick={() => setOpen(open === sc.key ? null : sc.key)}>
                  <span className="font-semibold">{i + 1}. {sc.heading}</span>
                  <span className="block truncate text-xs text-muted">
                    {sc.beatNumber ? `Beat ${sc.beatNumber}: ${sc.beatText}` : "Not from an outline beat"}
                    {" · "}{ctx?.story_date ? `Story date ${ctx.story_date}` : "No story date"}
                    {sc.characters.length ? ` · ${sc.characters.join(", ")}` : ""}
                  </span>
                </button>
                {p && <Badge s={p.status} />}
                {p?.stale.outline && <span className="text-[11px] text-warn">Outline changed since this draft</span>}
                {p && p.updates > 0 && <span className="text-[11px] text-warn">{p.updates} research update{p.updates > 1 ? "s" : ""}</span>}
                {canEdit && aiReady && (
                  <button type="button" className="btn min-h-8 text-xs" disabled={s.pending || p?.status === "queued" || p?.status === "drafting"}
                    onClick={() => { if (scriptDirty()) { s.setMsg({ kind: "error", text: "Save your script changes first, so the draft starts from them." }); return; } setOpen(sc.key); s.run(() => developDialogue({ projectId, sceneKey: sc.key }), "Draft ready below."); }}>
                    {s.pending && open === sc.key ? "Drafting…" : p ? "Develop again" : "Develop scene"}</button>
                )}
              </div>
              {open === sc.key && (
                <SceneDetail projectId={projectId} canEdit={canEdit} aiReady={aiReady} scene={sc} ctx={ctx ?? null} characters={characters}
                  proposals={proposals.filter((x) => x.scene_key === sc.key)} scriptVersionId={scriptVersionId} />
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function SceneSetup({ projectId, canEdit, scene, ctx, characters }: { projectId: string; canEdit: boolean; scene: SceneRow; ctx: Ctx | null; characters: { id: string; name: string }[] }) {
  const s = useRun();
  const inScene = characters.filter((c) => scene.characters.includes(c.name.toUpperCase()) || new RegExp(`\\b${c.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(`${scene.beatText ?? ""}\n${scene.text}`));
  const [date, setDate] = useState(ctx?.story_date ?? "");
  const [dateNote, setDateNote] = useState(ctx?.story_date_note ?? "");
  const [obj, setObj] = useState<Record<string, string>>(ctx?.objectives ?? {});
  const [secs, setSecs] = useState(ctx?.runtime_seconds ? String(ctx.runtime_seconds) : "");
  const [tone, setTone] = useState(ctx?.tone ?? "");
  return (
    <details className="border border-line bg-panel-2 p-3" open={!ctx}>
      <summary className="cursor-pointer list-none text-xs font-semibold">Scene setup: story time, objectives, length</summary>
      <form className="mt-3 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); s.run(() => saveSceneContext({ projectId, sceneKey: scene.key, data: {
        beat_id: scene.beatId ?? "", story_date: date, story_date_note: dateNote, objectives: Object.fromEntries(Object.entries(obj).filter(([, v]) => v.trim())),
        runtime_seconds: secs, tone } }), "Scene setup saved."); }}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_1fr]">
          <label className="text-xs text-muted">Story date (in the story&apos;s world)
            <input type="date" className="field mt-1" value={date} disabled={!canEdit} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="text-xs text-muted">Note (optional)
            <input className="field mt-1" value={dateNote} maxLength={300} disabled={!canEdit} placeholder="Day 3, evening" onChange={(e) => setDateNote(e.target.value)} />
          </label>
        </div>
        <p className="text-[11px] text-muted">Story-dated research is only available to characters if it&apos;s dated on or before this day. Without a date, dated research stays out.</p>
        {inScene.map((c) => (
          <label key={c.id} className="text-xs text-muted">What does {c.name} want right now?
            <input className="field mt-1" value={obj[c.id] ?? ""} maxLength={600} disabled={!canEdit} onChange={(e) => setObj({ ...obj, [c.id]: e.target.value })} />
          </label>
        ))}
        {!inScene.length && <p className="text-xs text-muted">No characters found in this scene yet.</p>}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="text-xs text-muted">Length in seconds (optional)
            <input type="number" min={5} max={1800} className="field mt-1" value={secs} disabled={!canEdit} onChange={(e) => setSecs(e.target.value)} />
          </label>
          <label className="text-xs text-muted">Tone (optional)
            <input className="field mt-1" value={tone} maxLength={200} disabled={!canEdit} placeholder="tense, quiet, funny…" onChange={(e) => setTone(e.target.value)} />
          </label>
        </div>
        {canEdit && <div><button className="btn-primary min-h-8 text-xs" disabled={s.pending}>{s.pending ? "Saving…" : "Save scene setup"}</button></div>}
        <Status msg={s.msg} />
      </form>
    </details>
  );
}

function SceneDetail({ projectId, canEdit, aiReady, scene, ctx, characters, proposals, scriptVersionId }: {
  projectId: string; canEdit: boolean; aiReady: boolean; scene: SceneRow; ctx: Ctx | null; characters: { id: string; name: string }[]; proposals: ProposalView[]; scriptVersionId: string | null;
}) {
  const [sel, setSel] = useState<string | null>(proposals[0]?.id ?? null);
  useEffect(() => { if (!proposals.some((p) => p.id === sel)) setSel(proposals[0]?.id ?? null); }, [proposals, sel]);
  const p = proposals.find((x) => x.id === sel) ?? null;
  const s = useRun();
  return (
    <div className="flex flex-col gap-3 pb-4">
      <SceneSetup projectId={projectId} canEdit={canEdit} scene={scene} ctx={ctx} characters={characters} />
      {ctx?.pinned_snapshot_id && (
        <p className="flex flex-wrap items-center gap-2 text-xs">
          <span className="border border-[#2f6fd6] px-1.5 py-0.5 text-[10px] font-semibold text-[#2f6fd6]">Research pinned</span>
          New drafts for this scene use exactly the research of a pinned draft, even if feeds update.
          {canEdit && <button type="button" className="text-accent underline" disabled={s.pending} onClick={() => s.run(() => pinSceneResearch({ projectId, sceneKey: scene.key, snapshotId: null }))}>Unpin</button>}
        </p>
      )}
      <Status msg={s.msg} />
      {proposals.length > 0 ? (
        <>
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Drafts">
            {proposals.map((x, i) => (
              <button key={x.id} role="tab" aria-selected={x.id === sel} type="button" onClick={() => setSel(x.id)}
                className={`btn min-h-8 gap-1.5 px-2 text-[11px] ${x.id === sel ? "border-text" : ""}`}>
                Draft {proposals.length - i} <Badge s={x.status} />
              </button>
            ))}
          </div>
          {p && <Proposal key={p.id} projectId={projectId} canEdit={canEdit} aiReady={aiReady} scene={scene} p={p} pinned={ctx?.pinned_snapshot_id ?? null} scriptVersionId={scriptVersionId} />}
        </>
      ) : <p className="text-sm text-muted">No drafts for this scene yet.</p>}
    </div>
  );
}

function Proposal({ projectId, canEdit, aiReady, scene, p, pinned, scriptVersionId }: {
  projectId: string; canEdit: boolean; aiReady: boolean; scene: SceneRow; p: ProposalView; pinned: string | null; scriptVersionId: string | null;
}) {
  const s = useRun();
  const [els, setEls] = useState<DialogueElement[]>(p.result?.elements ?? []);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [facts, setFacts] = useState<Set<number>>(new Set((p.result?.new_facts ?? []).map((_, i) => i)));
  const [note, setNote] = useState("");
  const [focus, setFocus] = useState("");
  const editable = canEdit && (p.status === "ready" || p.status === "superseded");
  const edited = JSON.stringify(els) !== JSON.stringify(p.result?.elements ?? []);
  const usedBy = useMemo(() => {
    const m = new Map<string, number[]>();
    (p.result?.elements ?? []).forEach((e, i) => (e.item_ids ?? []).forEach((id) => m.set(id, [...(m.get(id) ?? []), i + 1])));
    return m;
  }, [p.result]);
  const prov = p.provenance as { model?: string; provider?: string; location?: string; workflow_version?: string; outline?: { beat_number?: number; beat_hash?: string } | null;
    characters?: { name: string; profile_version: number }[]; retrieved_item_ids?: string[]; cost_usd?: number; story_date?: string | null; script_version_id?: string; pinned_snapshot_id?: string | null };

  function accept(mode: "all" | "adopt") {
    if (scriptDirty()) { s.setMsg({ kind: "error", text: "You have unsaved changes in the script above. Save or undo them first, so nothing is lost." }); return; }
    const chosen = mode === "all" ? els : els.filter((_, i) => picked.has(i));
    // Adopting a few lines doesn't establish the whole draft's facts: send them only on full accept.
    const f = mode === "all" ? (p.result?.new_facts ?? []).filter((_, i) => facts.has(i)) : [];
    s.run(() => acceptDialogue({ projectId, proposalId: p.id, mode, elements: chosen, facts: f, expectedScriptVersionId: scriptVersionId }));
  }

  if (p.status === "queued" || p.status === "drafting") {
    return (
      <div className="flex flex-wrap items-center gap-3 border border-line p-3 text-sm">
        <span>{p.status === "queued" ? "Waiting to draft…" : "Drafting… this takes about half a minute."} {p.trigger === "auto" ? "(Auto-draft)" : ""}</span>
        {canEdit && <button type="button" className="btn min-h-8 text-xs" disabled={s.pending} onClick={() => s.run(() => cancelDialogue({ projectId, proposalId: p.id }))}>Cancel</button>}
        <Status msg={s.msg} />
      </div>
    );
  }
  if (p.status === "failed" || p.status === "cancelled" || !p.result) {
    return (
      <div className="flex flex-col gap-1 border border-line p-3 text-sm">
        <p>{p.status === "cancelled" ? "This draft was cancelled." : `This draft failed${p.error ? `: ${p.error}` : "."}`} Earlier drafts and your script are unchanged.</p>
        {canEdit && p.status === "failed" && <div><button type="button" className="btn min-h-8 text-xs" disabled={s.pending} onClick={() => s.run(() => decideDialogue({ projectId, proposalId: p.id, action: "reject" }), "Cleared.")}>Dismiss</button></div>}
        <Status msg={s.msg} />
      </div>
    );
  }
  const r = p.result;
  return (
    <div className="flex flex-col gap-3">
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <Badge s={p.status} /> {p.trigger === "auto" ? "Auto-draft" : p.trigger === "revision" ? "Revision" : "On demand"} · {when(p.finished_at ?? p.created_at)}
        {p.director_note && <span>· Your note: &ldquo;{p.director_note}&rdquo;</span>}
      </p>
      {p.stale.outline && <p className="text-xs text-warn">The outline beat changed after this draft. Develop the scene again to draft from the new beat. This draft stays as it is.</p>}
      {(p.event_refs?.length ?? 0) > 0 && <p className="text-xs text-muted">From {p.event_refs!.length} approved story event{p.event_refs!.length === 1 ? "" : "s"} in the <a className="text-accent" href={`/projects/${projectId}/world#simulation`}>World &amp; Time</a>.</p>}
      {p.stale.scene && <p className="text-xs text-warn">The scene in your script changed after this draft. Compare carefully: accepting replaces the scene&apos;s dialogue.</p>}
      {(r.warnings ?? []).map((w, i) => <p key={i} className="text-xs text-warn">{w}</p>)}

      {p.status === "accepted" && (
        <div className="flex flex-col gap-1 border border-ok/50 bg-ok-soft/40 p-3 text-sm">
          <p>Accepted {when(p.decided_at)}. Later research or outline changes never change it.</p>
          {p.updates > 0 && (
            <p className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-warn">{p.updates} research item{p.updates > 1 ? "s" : ""} changed or arrived since.</span>
              {canEdit && aiReady && <button type="button" className="btn min-h-7 text-[11px]" disabled={s.pending} onClick={() => s.run(() => checkDialogueResearch({ projectId, proposalId: p.id }))}>Check against this dialogue</button>}
            </p>
          )}
          {p.flags.research_check && (
            <div className="text-xs">
              <p className="font-medium">Research check ({when(p.flags.research_check.at)}): {p.flags.research_check.summary}</p>
              <ul className="mt-1 flex flex-col gap-1">
                {p.flags.research_check.conflicts.map((c, i) => <li key={i}>&ldquo;{c.line}&rdquo; · {c.explanation} <span className="text-muted">(see research below)</span></li>)}
              </ul>
              <p className="mt-1 text-muted">Your accepted dialogue is unchanged. It&apos;s your call whether to revise.</p>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="flex flex-col gap-1">
          <p className="text-[11px] font-semibold text-muted">Your scene now</p>
          <pre className="max-h-[28rem] overflow-y-auto border border-line bg-paper p-3 font-mono text-[11.5px] leading-[1.45] whitespace-pre-wrap text-paper-ink">{scene.text}</pre>
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-[11px] font-semibold text-muted">Proposed{edited ? " (with your edits)" : ""} · tick lines to adopt only those</p>
          <ol className="flex max-h-[28rem] flex-col gap-1.5 overflow-y-auto border border-line bg-paper p-3 font-mono text-[11.5px] leading-[1.45] text-paper-ink">
            {els.map((e, i) => (
              <li key={i} className="flex gap-2">
                {editable && <input type="checkbox" className="mt-1" aria-label={`Adopt line ${i + 1}`} checked={picked.has(i)} onChange={() => setPicked((x) => { const n = new Set(x); if (n.has(i)) n.delete(i); else n.add(i); return n; })} />}
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 font-sans text-[10px]">
                    {e.type === "dialogue" ? <b className="font-mono text-[11.5px]">{e.speaker}</b> : <span className="text-paper-ink/50">action</span>}
                    {e.parenthetical && <span className="font-mono text-[11.5px]">({e.parenthetical})</span>}
                    <span className={`px-1 ${BASIS[e.basis]?.cls ?? ""}`}>{BASIS[e.basis]?.label ?? e.basis}</span>
                  </p>
                  {editable ? (
                    <textarea className="w-full resize-y border border-transparent bg-transparent p-0 font-mono text-[11.5px] text-paper-ink hover:border-black/10 focus:border-black/30" rows={Math.max(1, Math.ceil(e.text.length / 60))}
                      value={e.text} onChange={(ev) => setEls(els.map((x, j) => (j === i ? { ...x, text: ev.target.value } : x)))} aria-label={`Line ${i + 1}`} />
                  ) : <p className="whitespace-pre-wrap">{e.text}</p>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {(r.assumptions.length > 0 || r.open_choices.length > 0 || r.note) && (
        <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          {r.assumptions.length > 0 && <div><p className="text-[11px] font-semibold text-muted">Assumptions it made</p><ul className="list-disc pl-5">{r.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></div>}
          {r.open_choices.length > 0 && <div><p className="text-[11px] font-semibold text-muted">Choices for you</p><ul className="list-disc pl-5">{r.open_choices.map((a, i) => <li key={i}>{a}</li>)}</ul></div>}
          {r.note && <p className="text-xs text-muted md:col-span-2">Tested: {r.note}</p>}
        </div>
      )}
      {r.new_facts.length > 0 && editable && (
        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="text-[11px] font-semibold text-muted">If you accept the whole draft, it would establish (ticked ones go to the Story desk as ideas to confirm)</legend>
          {r.new_facts.map((f, i) => (
            <label key={i} className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={facts.has(i)} onChange={() => setFacts((x) => { const n = new Set(x); if (n.has(i)) n.delete(i); else n.add(i); return n; })} />
              <span>{f.kind === "adaptation" && <span className="mr-1 bg-warn-soft px-1 text-[10px] text-warn">Proposed adaptation</span>}{f.text}</span>
            </label>
          ))}
        </fieldset>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          {editable && <button type="button" className="btn-primary min-h-9 text-xs" disabled={s.pending}
            onClick={() => { if (!scene.text.includes("(write the line)") && scene.text.split("\n\n").length > 3 && !window.confirm("Accepting replaces the dialogue now in this scene. Your current version stays in Revision history. Continue?")) return; accept("all"); }}>
            {s.pending ? "Saving…" : edited ? "Accept with my edits" : "Accept"}</button>}
          {editable && <button type="button" className="btn min-h-9 text-xs" disabled={s.pending || !picked.size} onClick={() => accept("adopt")}>Adopt {picked.size || ""} selected line{picked.size === 1 ? "" : "s"}</button>}
          {editable && <button type="button" className="btn min-h-9 text-xs" disabled={s.pending} onClick={() => s.run(() => decideDialogue({ projectId, proposalId: p.id, action: "reject" }), "Rejected. It's kept under its draft tab.")}>Reject</button>}
          {(p.status === "rejected" || p.status === "superseded") && <button type="button" className="btn min-h-9 text-xs" disabled={s.pending} onClick={() => s.run(() => decideDialogue({ projectId, proposalId: p.id, action: "restore" }), "Restored for review.")}>Restore this draft</button>}
          {p.snapshot_id && p.snapshot_id !== pinned && <button type="button" className="btn min-h-9 text-xs" disabled={s.pending} onClick={() => s.run(() => pinSceneResearch({ projectId, sceneKey: p.scene_key, snapshotId: p.snapshot_id }))}>Pin this research to the scene</button>}
        </div>
      )}
      <Status msg={s.msg} />

      {canEdit && aiReady && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <form className="flex flex-col gap-2 border border-line p-3" onSubmit={(e) => { e.preventDefault(); s.run(() => developDialogue({ projectId, sceneKey: p.scene_key, parentId: p.id, directorNote: note }), "Revision drafted.", () => setNote("")); }}>
            <p className="text-sm font-medium">Request a revision</p>
            <textarea className="field min-h-16 text-sm" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="What should change? e.g. Marie shouldn't say she knows yet." required />
            <div><button className="btn min-h-8 text-xs" disabled={s.pending}>Draft a revision</button></div>
          </form>
          <div className="flex flex-col gap-2 border border-line p-3">
            <p className="text-sm font-medium">Review with the script partner</p>
            <div className="flex flex-wrap gap-2">
              <select className="field min-h-8 w-auto py-0 text-xs" value={focus} onChange={(e) => setFocus(e.target.value)} aria-label="Focus">
                {FOCUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <button type="button" className="btn min-h-8 text-xs" disabled={s.pending} onClick={() => s.run(() => reviewDialogue({ projectId, proposalId: p.id, elements: els, focus }), "The partner answered below.")}>Ask</button>
            </div>
            {p.reviews.slice().reverse().map((rv, i) => (
              <div key={i} className="flex flex-col gap-1 border-t border-line pt-2 text-sm">
                <p><span className="text-xs text-muted">Observation: </span>{rv.observation}</p>
                <p><span className="text-xs text-muted">Question: </span>{rv.question}</p>
                {rv.suggestion && <p><span className="text-xs text-muted">Suggestion: </span>{rv.suggestion}
                  <button type="button" className="ml-2 text-xs text-accent underline" onClick={() => setNote(`Try this: ${rv.suggestion}`)}>Use as revision note</button></p>}
              </div>
            ))}
          </div>
        </div>
      )}

      <details className="border border-line p-3">
        <summary className="cursor-pointer list-none text-xs font-semibold">Research behind this draft ({p.research.length})</summary>
        {p.research.length ? (
          <ul className="mt-2 flex flex-col divide-y divide-line text-sm">
            {p.research.map((x) => (
              <li key={`${x.item_id}-${x.character}`} className="flex flex-col gap-0.5 py-2">
                <span className="flex flex-wrap items-center gap-2">
                  {x.url ? <a className="text-accent underline" href={x.url} target="_blank" rel="noopener noreferrer nofollow">{x.title}</a> : <span>{x.title}</span>}
                  {x.current_version !== null && x.current_version > x.version && <span className="text-[11px] text-warn">updated since (v{x.version} → v{x.current_version})</span>}
                </span>
                <span className="text-xs text-muted">For {x.character} · {x.collection} · {x.source}{x.date ? ` · ${x.date.slice(0, 10)}` : " · date unknown"} · {x.reason}</span>
                <span className="text-xs text-muted">{usedBy.get(x.item_id)?.length ? `Used in line${usedBy.get(x.item_id)!.length > 1 ? "s" : ""} ${usedBy.get(x.item_id)!.join(", ")}` : "Available, not used in a line"}</span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-sm text-muted">No research was given to this draft. Connect collections to characters on the Connections desk.</p>}
      </details>
      <details className="border border-line p-3">
        <summary className="cursor-pointer list-none text-xs font-semibold">How this draft was made</summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted">Model</dt><dd>{prov.provider} {prov.model} · {prov.location}</dd>
          <dt className="text-muted">Workflow</dt><dd>{prov.workflow_version}</dd>
          <dt className="text-muted">Outline</dt><dd>{prov.outline ? `Beat ${prov.outline.beat_number} (version ${String(prov.outline.beat_hash).slice(0, 8)})` : "Not from an outline beat"}</dd>
          <dt className="text-muted">Story date</dt><dd>{prov.story_date ?? "unknown"}</dd>
          <dt className="text-muted">Characters</dt><dd>{(prov.characters ?? []).map((c) => `${c.name} (profile v${c.profile_version})`).join(", ") || "—"}</dd>
          <dt className="text-muted">Research</dt><dd>{(prov.retrieved_item_ids ?? []).length} items · snapshot {p.snapshot_id?.slice(0, 8)}{prov.pinned_snapshot_id ? " (pinned)" : ""}</dd>
          <dt className="text-muted">Script revision</dt><dd>{prov.script_version_id?.slice(0, 8) ?? "—"}</dd>
          {typeof prov.cost_usd === "number" && <><dt className="text-muted">Cost</dt><dd>${prov.cost_usd.toFixed(4)} from the film&apos;s AI budget</dd></>}
        </dl>
        <p className="mt-2 text-[11px] text-muted">Readable copy of the proposed dialogue:</p>
        <pre className="mt-1 max-h-48 overflow-y-auto bg-panel-2 p-2 font-mono text-[11px] whitespace-pre-wrap">{renderElements(r.elements)}</pre>
      </details>
    </div>
  );
}
