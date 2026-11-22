"use client";
// World simulation desk: status and controls, proposed events to review, approved history,
// characters' emotional states (fictional writing controls), and plain-language rules.
// Proposals change nothing until she approves them; dialogue only comes from approved events.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { simAddEvent, simAdvance, simCancelRun, simCloseDay, simDecide, simDevelopDialogue, simEditEvent, simReassess, simRemoveRule,
  simSaveRule, simSaveSettings, simSetScene } from "@/app/projects/[projectId]/sim-actions";
import { changeWords, FLEXIBILITY_LABEL, INTENSITY_LABEL, ruleSentence,
  type EventCharacter, type EventData, type Family, type SimRule } from "@/lib/sim/rules";
import type { SimEvent, Simulation } from "@/lib/sim/data";

type Res = { ok: true; note?: string } | { ok: false; error: string };
type Msg = { kind: "ok" | "error"; text: string } | null;
function useRun() {
  const router = useRouter();
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  function run(fn: () => Promise<Res>, after?: () => void) {
    setMsg(null);
    start(async () => {
      let r: Res;
      try { r = await fn(); } catch { r = { ok: false, error: "That didn't save. Check your connection and try again." }; }
      if (r.ok) { setMsg({ kind: "ok", text: r.note ?? "Saved." }); after?.(); router.refresh(); } else setMsg({ kind: "error", text: r.error });
    });
  }
  return { run, msg, pending };
}
function Status({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return <p role={msg.kind === "error" ? "alert" : "status"} className={`text-xs ${msg.kind === "error" ? "text-danger" : "text-muted"}`}>{msg.text}</p>;
}
const TONE = { ok: "border-ok text-ok", warn: "border-warn text-warn", muted: "border-line text-muted", accent: "border-accent text-accent" } as const;
function Badge({ tone = "muted", children }: { tone?: keyof typeof TONE; children: React.ReactNode }) {
  return <span className={`border px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] uppercase ${TONE[tone]}`}>{children}</span>;
}
const fmtDate = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");
const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }) + " (New York)" : "never");
const BASIS: Record<string, { label: string; tone: keyof typeof TONE }> = {
  source: { label: "From the news", tone: "ok" }, adaptation: { label: "Adapted from the news", tone: "warn" }, fiction: { label: "Fiction", tone: "muted" },
};

export function SimDesk({ projectId, canEdit, canApprove, aiReady, sim }: { projectId: string; canEdit: boolean; canApprove: boolean; aiReady: boolean; sim: Simulation }) {
  const open = sim.events.filter((e) => e.day === sim.openDay && ["proposed", "blocked"].includes(e.status));
  const deferred = sim.events.filter((e) => e.status === "deferred");
  const rejectedToday = sim.events.filter((e) => e.day === sim.openDay && e.status === "rejected");
  const approved = sim.events.filter((e) => e.status === "approved");
  const running = sim.runs.find((r) => r.status === "running") ?? null;
  const preparedToday = sim.runs.some((r) => r.day === sim.openDay && r.status === "succeeded") || sim.events.some((e) => e.day === sim.openDay);
  return (
    <div className="flex flex-col gap-6">
      <Controls projectId={projectId} canEdit={canEdit} canApprove={canApprove} aiReady={aiReady} sim={sim} running={running}
        waiting={open.length} preparedToday={preparedToday} />

      <section className="panel flex flex-col gap-3 p-4" aria-labelledby="prop-h">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="prop-h" className="display text-lg">Day {sim.openDay}{sim.openDate ? ` · ${fmtDate(sim.openDate)}` : ""}: proposed events</h2>
          <span className="text-xs text-muted">Proposals change nothing until you approve them.</span>
        </div>
        {open.length ? open.map((e) => <EventCard key={`${e.id}:${e.current_version}`} projectId={projectId} canEdit={canEdit} canApprove={canApprove} aiReady={aiReady} e={e} sim={sim} />)
          : <p className="text-sm text-muted">{preparedToday ? "Nothing waiting for this day." : "Nothing proposed yet. Press Advance one day when you're ready."}</p>}
        {rejectedToday.length > 0 && <p className="text-xs text-muted">Rejected today: {rejectedToday.map((e) => e.current.title).join(" · ")}. Rejections don&apos;t get replaced.</p>}
        {canEdit && <AddEvent projectId={projectId} sim={sim} />}
      </section>

      {deferred.length > 0 && (
        <section className="panel flex flex-col gap-3 p-4" aria-labelledby="def-h">
          <h2 id="def-h" className="display text-lg">Deferred</h2>
          {deferred.map((e) => <EventCard key={e.id} projectId={projectId} canEdit={canEdit} canApprove={canApprove} aiReady={aiReady} e={e} sim={sim} />)}
        </section>
      )}

      <History projectId={projectId} canEdit={canEdit} aiReady={aiReady} sim={sim} approved={approved} />
      <p className="text-xs text-muted">How each protagonist, antagonist and supporting character is feeling lives on their own character page.</p>

      <details className="panel p-4 text-sm">
        <summary className="cursor-pointer font-semibold">Recent runs (details)</summary>
        <ul className="mt-2 flex flex-col divide-y divide-line">
          {sim.runs.map((r) => (
            <li key={r.id} className="flex flex-wrap gap-x-3 py-1.5 text-xs">
              <span className="font-medium">Day {r.day}</span><span>{r.trigger === "scheduled" ? "Daily run" : "Advance one day"}</span>
              <span className={r.status === "failed" ? "text-danger" : ""}>{r.status}</span><span>{r.proposed} proposed</span>
              <span className="text-muted">{fmtTime(r.started_at)}</span>
              {r.stale && <span className="text-warn">no new world material</span>}
              {r.note && <span className="text-muted">{r.note}</span>}{r.error && <span className="text-danger">{r.error}</span>}
            </li>
          ))}
          {!sim.runs.length && <li className="text-xs text-muted">No runs yet.</li>}
        </ul>
        <p className="mt-2 text-xs text-muted">Each run stores the controls and rule versions it used, the world items it read (with their versions) and its cost. Proposing uses Anthropic Claude Haiku 5.5 (cloud). Limits, knowledge checks, emotional bounds and approvals are done in code, without AI.</p>
      </details>
    </div>
  );
}

// ---- Status and controls ----------------------------------------------------------------------
function Controls({ projectId, canEdit, canApprove, aiReady, sim, running, waiting, preparedToday }: {
  projectId: string; canEdit: boolean; canApprove: boolean; aiReady: boolean; sim: Simulation; running: Simulation["runs"][number] | null; waiting: number; preparedToday: boolean;
}) {
  const s = useRun();
  const st = sim.settings;
  const save = (data: Record<string, unknown>) => s.run(() => simSaveSettings({ projectId, data }));
  const lastFailed = sim.runs[0]?.status === "failed" ? sim.runs[0] : null;
  return (
    <section className="panel flex flex-col gap-4 p-4" aria-labelledby="ctl-h">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="ctl-h" className="display text-2xl leading-none">Today in the story</h2>
          <p className="text-sm">
            <span className="font-semibold">Open day: {sim.openDay}{sim.openDate ? ` (${fmtDate(sim.openDate)})` : ""}</span>
            {st.clock_day > 0 && <span className="text-muted"> · last closed: day {st.clock_day}{sim.closedDate ? ` (${fmtDate(sim.closedDate)})` : ""}</span>}
            {st.paused && <> · <Badge tone="warn">Paused</Badge></>}
          </p>
          <p className="max-w-2xl text-xs text-muted">
            Story time and real time are separate. Day 1 is {st.start_date ? fmtDate(st.start_date) : `${fmtDate(sim.suggestedStart.date)}, from ${sim.suggestedStart.why}`}; the story moves
            forward one day each time you close a day. News dated after the story&apos;s date can only become an adaptation, never a story fact.
          </p>
          <p className="text-xs text-muted">
            Daily run: {st.auto_daily ? (st.paused ? "on, but paused" : "on, every morning at about 4:37 AM New York time (9:37 UTC), on Studio's server") : "off"}
            {" · "}Last successful run: {fmtTime(sim.lastSuccess)}{sim.nextRun ? ` · Next: ${fmtTime(sim.nextRun)}` : ""}
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-col items-end gap-2">
            {running ? (
              <p className="flex items-center gap-2 text-xs">Preparing day {running.day}…
                <button type="button" className="btn min-h-8 text-xs" disabled={s.pending} onClick={() => s.run(() => simCancelRun({ projectId, runId: running.id }))}>Cancel</button></p>
            ) : (
              <button type="button" className="btn-primary min-h-10 text-xs" disabled={s.pending || st.paused || !aiReady || waiting > 0 || preparedToday}
                title={st.paused ? "Resume to prepare a new day" : waiting ? "Decide this day's proposals first" : preparedToday ? "Close this day to move on" : undefined}
                onClick={() => s.run(() => simAdvance({ projectId }))}>{s.pending ? "Preparing the day…" : lastFailed && lastFailed.day === sim.openDay ? `Retry day ${sim.openDay}` : `Advance one day (prepare day ${sim.openDay})`}</button>
            )}
            {canApprove && preparedToday && waiting === 0 && (
              <button type="button" className="btn min-h-9 text-xs" disabled={s.pending} onClick={() => s.run(() => simCloseDay({ projectId, day: sim.openDay }))}>Close day {sim.openDay}</button>
            )}
            {!aiReady && <span className="text-[11px] text-muted">The simulation&apos;s AI isn&apos;t set up on this server.</span>}
          </div>
        )}
      </div>
      {lastFailed && <p className="text-xs text-danger">The last run for day {lastFailed.day} didn&apos;t finish: {lastFailed.error}. Nothing was changed; you can retry.</p>}
      {canEdit && (
        <div className="grid grid-cols-1 gap-3 border-t border-line pt-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium">Events per day (at most)</span>
            <input type="number" min={0} max={10} defaultValue={st.max_events} className="field min-h-9 w-24"
              onBlur={(e) => { const v = Math.max(0, Math.min(10, Number(e.target.value) || 0)); if (v !== st.max_events) save({ max_events: v }); }} />
            <span className="text-[11px] text-muted">Several news items can inform one event. Fewer, or none, is fine.</span>
          </label>
          <Choice label="Response intensity" hint="How strongly events move how characters feel." value={st.intensity} options={INTENSITY_LABEL} disabled={s.pending} onChange={(v) => save({ intensity: v })} />
          <Choice label="Behavioral flexibility" hint="Variation around their usual tendencies. Never overrides what they know or who they are." value={st.flexibility} options={FLEXIBILITY_LABEL} disabled={s.pending} onChange={(v) => save({ flexibility: v })} />
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium">Day 1&apos;s date (story time)</span>
            <input type="date" defaultValue={st.start_date ?? ""} disabled={st.clock_day > 0} className="field min-h-9 w-44"
              onBlur={(e) => { if ((e.target.value || null) !== st.start_date) save({ start_date: e.target.value }); }} />
            <span className="text-[11px] text-muted">{st.clock_day > 0 ? "Fixed once a day has been closed." : "Leave empty to use your timeline above."}</span>
          </label>
          <div className="flex flex-col gap-1.5 text-xs">
            <label className="flex items-center gap-2"><input type="checkbox" checked={st.auto_daily} disabled={s.pending} onChange={(e) => save({ auto_daily: e.target.checked })} /> Prepare a new day each morning</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={st.auto_dialogue} disabled={s.pending} onChange={(e) => save({ auto_dialogue: e.target.checked })} /> Draft dialogue after I approve an event (only events with a scene chosen)</label>
            <button type="button" className="btn min-h-8 self-start text-xs" disabled={s.pending} onClick={() => save({ paused: !st.paused })}>{st.paused ? "Resume" : "Pause"}</button>
            <span className="text-[11px] text-muted">Pause stops new proposals only. Editing and reviewing still work. Changes apply from day {st.clock_day + 1} on.</span>
          </div>
        </div>
      )}
      <Status msg={s.msg} />
    </section>
  );
}

function Choice<T extends number>({ label, hint, value, options, onChange, disabled }: { label: string; hint: string; value: T; options: Record<T, string>; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium">{label}</span>
      <div className="flex flex-wrap gap-1" role="group" aria-label={label}>
        {(Object.keys(options) as unknown as T[]).map((k) => (
          <button key={String(k)} type="button" aria-pressed={Number(k) === Number(value)} disabled={disabled} onClick={() => onChange(Number(k) as T)}
            className={`border px-2 py-1 text-xs ${Number(k) === Number(value) ? "border-text bg-text text-panel-2" : "border-line hover:border-text"}`}>{options[k]}</button>
        ))}
      </div>
      <span className="text-[11px] text-muted">{hint}</span>
    </div>
  );
}

// ---- One event ----------------------------------------------------------------------------------
function EventCard({ projectId, canEdit, canApprove, aiReady, e, sim }: { projectId: string; canEdit: boolean; canApprove: boolean; aiReady: boolean; e: SimEvent; sim: Simulation }) {
  const s = useRun();
  const [editing, setEditing] = useState(false);
  const d = e.current;
  const deps = Object.keys(e.depends_on).map((id) => sim.events.find((x) => x.id === id)).filter(Boolean) as SimEvent[];
  const rules = sim.rules;
  const basis = e.origin === "director" ? { label: "Your event", tone: "accent" as const } : BASIS[d.basis] ?? BASIS.fiction;
  const decide = (action: "approve" | "reject" | "defer" | "restore") => s.run(() => simDecide({ projectId, eventId: e.id, action, version: e.current_version }));
  return (
    <article className="flex flex-col gap-2 border border-line bg-panel-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-semibold">{d.title}</h3>
        <Badge tone={basis.tone}>{basis.label}</Badge>
        <Badge tone={e.status === "approved" ? "ok" : e.status === "blocked" ? "warn" : "muted"}>{e.status === "blocked" ? "Needs reassessing" : e.status}</Badge>
        <span className="text-xs text-muted">Day {e.day}{d.fictional_date ? ` · ${fmtDate(d.fictional_date)}` : ""}{e.versions > 1 ? ` · version ${e.current_version}` : ""}</span>
      </div>
      {editing ? <EventEditor projectId={projectId} e={e} sim={sim} onDone={() => setEditing(false)} /> : (
        <>
          {d.description && <p className="text-sm"><span className="font-medium">What changed? </span>{d.description}</p>}
          {d.relevance && <p className="text-xs text-muted">Why it matters: {d.relevance}</p>}
          {d.sources.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-xs">
              {d.sources.map((x) => (
                <li key={x.item_id}>{x.url ? <a href={x.url} target="_blank" rel="noopener noreferrer nofollow" className="text-accent hover:underline">{x.title} ↗</a> : x.title}
                  <span className="text-muted"> · {x.source} · published {x.published_at ? fmtDate(x.published_at.slice(0, 10)) : "date unknown"} · read {fmtTime(x.retrieved_at)}</span></li>
              ))}
            </ul>
          )}
          {d.characters.length ? (
            <ul className="flex flex-col gap-1.5">
              {d.characters.map((c) => (
                <li key={c.character_id} className="border-l-2 border-line pl-2 text-sm">
                  <span className="font-semibold uppercase">{c.name}</span> <span className="text-xs text-muted">({c.channel})</span>
                  {sim.characters.find((x) => x.id === c.character_id)?.tracked !== false && <p><span className="text-muted">How might they feel? </span>{changeWords(c.d_stress, c.d_happiness)}{c.feel ? ` (${c.feel})` : ""}</p>}
                  {c.movement && <p><span className="text-muted">What might they do next? </span>{c.movement}</p>}
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-muted">No character is affected directly.</p>}
          {deps.length > 0 && <p className="text-xs text-muted">Depends on: {deps.map((x) => `“${x.current.title}” (${x.status})`).join(", ")}</p>}
          {!e.fresh && <p className="text-xs text-warn">You changed this event. Update how they might feel, or confirm the consequences still fit, before approving.</p>}
          <details className="text-xs text-muted">
            <summary className="cursor-pointer">Why this?</summary>
            {d.rationale && <p className="mt-1">{d.rationale}</p>}
            {d.characters.flatMap((c) => c.rule_ids).length > 0 && (
              <ul className="mt-1 list-disc pl-4">
                {[...new Set(d.characters.flatMap((c) => c.rule_ids))].map((id) => { const r = rules.find((x) => x.id === id); return r ? <li key={id}>{ruleSentence(r, r.character_id ? sim.characters.find((c) => c.id === r.character_id)?.name ?? null : null)}</li> : null; })}
              </ul>
            )}
            {d.flags?.length ? <ul className="mt-1 list-disc pl-4">{d.flags.map((f) => <li key={f}>{f}</li>)}</ul> : null}
            <p className="mt-1">Emotional changes are previews until you approve. Approving applies them once.</p>
          </details>
          {(canEdit || canApprove) && (
            <div className="flex flex-wrap items-center gap-2">
              {e.status === "proposed" && canApprove && <button type="button" className="btn-primary min-h-9 text-xs" disabled={s.pending || !e.fresh} onClick={() => decide("approve")}>Approve</button>}
              {["proposed", "blocked", "deferred"].includes(e.status) && canEdit && <button type="button" className="btn min-h-9 text-xs" disabled={s.pending} onClick={() => setEditing(true)}>Edit</button>}
              {e.status !== "deferred" && ["proposed", "blocked"].includes(e.status) && canEdit && <button type="button" className="btn min-h-9 text-xs" disabled={s.pending} onClick={() => decide("reject")}>Reject</button>}
              {["proposed", "blocked"].includes(e.status) && canEdit && <button type="button" className="btn min-h-9 text-xs" disabled={s.pending} onClick={() => decide("defer")}>Defer</button>}
              {e.status === "deferred" && canEdit && <button type="button" className="btn min-h-9 text-xs" disabled={s.pending} onClick={() => decide("restore")}>Bring back</button>}
              {(!e.fresh || e.status === "blocked") && canEdit && aiReady && (
                <button type="button" className="btn min-h-9 text-xs" disabled={s.pending}
                  onClick={() => s.run(() => simReassess({ projectId, eventId: e.id, clearDeps: e.status === "blocked", why: e.status === "blocked" ? "An event it depended on was rejected, deferred or changed." : "The director edited the event." }))}>
                  {s.pending ? "Working it out…" : "Update how they might feel"}</button>
              )}
              {!e.fresh && e.status !== "blocked" && canEdit && (
                <button type="button" className="btn min-h-9 text-xs" disabled={s.pending} onClick={() => s.run(() => simEditEvent({ projectId, eventId: e.id, expectedVersion: e.current_version, data: d, confirm: true }))}>These still fit</button>
              )}
            </div>
          )}
        </>
      )}
      <Status msg={s.msg} />
    </article>
  );
}

function CharacterChanges({ chars, setChars, sim }: { chars: EventCharacter[]; setChars: (c: EventCharacter[]) => void; sim: Simulation }) {
  const free = sim.characters.filter((c) => !chars.some((x) => x.character_id === c.id));
  const set = (i: number, patch: Partial<EventCharacter>) => setChars(chars.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div className="flex flex-col gap-2">
      {chars.map((c, i) => (
        <div key={c.character_id} className="flex flex-col gap-1 border-l-2 border-line pl-2">
          <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold uppercase">{c.name}</span>
            <button type="button" className="text-xs text-muted hover:text-danger" onClick={() => setChars(chars.filter((_, j) => j !== i))}>Remove</button></div>
          {sim.characters.find((x) => x.id === c.character_id)?.tracked ? (<>
          <Slider label="Stress" left="calmer" right="more stressed" value={c.d_stress} min={-25} max={25} onChange={(v) => set(i, { d_stress: v })} />
          <Slider label="Happiness" left="sadder" right="happier" value={c.d_happiness} min={-25} max={25} onChange={(v) => set(i, { d_happiness: v })} />
          <input className="field min-h-8 text-sm" value={c.feel} maxLength={200} placeholder="How might they feel? (a few words)" onChange={(e) => set(i, { feel: e.target.value })} /></>)
          : <p className="text-[11px] text-muted">Feelings aren&apos;t tracked for this character (only protagonists, antagonists and supporting characters).</p>}
          <input className="field min-h-8 text-sm" value={c.movement} maxLength={300} placeholder="What might they do next? (one action)" onChange={(e) => set(i, { movement: e.target.value })} />
        </div>
      ))}
      {free.length > 0 && (
        <select className="field min-h-8 w-auto self-start text-xs" value="" aria-label="Add a character"
          onChange={(e) => { const c = sim.characters.find((x) => x.id === e.target.value); if (c) setChars([...chars, { character_id: c.id, name: c.name, d_stress: 0, d_happiness: 0, feel: "", movement: "", channel: "It happens to them", involvement: "directly_involved", rule_ids: [] }]); }}>
          <option value="">Add a character…</option>
          {free.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
    </div>
  );
}

export function Slider({ label, left, right, value, min, max, onChange, disabled }: { label: string; left: string; right: string; value: number; min: number; max: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <label className="flex flex-wrap items-center gap-2 text-xs">
      <span className="w-20 font-medium">{label}</span>
      <span className="text-muted">{left}</span>
      <input type="range" min={min} max={max} step={1} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} className="w-40 accent-[var(--color-accent,#ea580c)]" aria-label={label} />
      <span className="text-muted">{right}</span>
    </label>
  );
}

function EventEditor({ projectId, e, sim, onDone }: { projectId: string; e: SimEvent; sim: Simulation; onDone: () => void }) {
  const s = useRun();
  const [title, setTitle] = useState(e.current.title);
  const [description, setDescription] = useState(e.current.description);
  const [chars, setChars] = useState<EventCharacter[]>(e.current.characters);
  return (
    <form className="flex flex-col gap-2" onSubmit={(ev) => { ev.preventDefault(); s.run(() => simEditEvent({ projectId, eventId: e.id, expectedVersion: e.current_version,
      data: { ...e.current, title, description, characters: chars }, confirm: false }), onDone); }}>
      <input className="field font-semibold" value={title} maxLength={140} onChange={(x) => setTitle(x.target.value)} aria-label="Title" required />
      <textarea className="field min-h-16 text-sm" value={description} maxLength={800} onChange={(x) => setDescription(x.target.value)} aria-label="What changed?" />
      <CharacterChanges chars={chars} setChars={setChars} sim={sim} />
      <p className="text-[11px] text-muted">Saving makes a new version; earlier versions are kept. If you change what happens but not how they feel, you&apos;ll be asked to update the consequences.</p>
      <div className="flex gap-2"><button className="btn-primary min-h-9 text-xs" disabled={s.pending}>Save version</button><button type="button" className="btn min-h-9 text-xs" onClick={onDone}>Cancel</button></div>
      <Status msg={s.msg} />
    </form>
  );
}

function AddEvent({ projectId, sim }: { projectId: string; sim: Simulation }) {
  const s = useRun();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [chars, setChars] = useState<EventCharacter[]>([]);
  if (!open) return <button type="button" className="btn min-h-9 self-start text-xs" onClick={() => setOpen(true)}>Add your own event for today</button>;
  return (
    <form className="flex flex-col gap-2 border border-dashed border-line p-3" onSubmit={(ev) => { ev.preventDefault(); s.run(() => simAddEvent({ projectId,
      data: { title, description, relevance: "", basis: "fiction", sources: [], characters: chars, rationale: "Added by the director.", fictional_date: sim.openDate } }), () => { setOpen(false); setTitle(""); setDescription(""); setChars([]); }); }}>
      <p className="text-xs text-muted">A present-day intervention: it affects the story from today on and never rewrites earlier days.</p>
      <input className="field" value={title} maxLength={140} onChange={(x) => setTitle(x.target.value)} placeholder="What happens? (short title)" required />
      <textarea className="field min-h-14 text-sm" value={description} maxLength={800} onChange={(x) => setDescription(x.target.value)} placeholder="Describe it" />
      <CharacterChanges chars={chars} setChars={setChars} sim={sim} />
      <div className="flex gap-2"><button className="btn-primary min-h-9 text-xs" disabled={s.pending}>Add</button><button type="button" className="btn min-h-9 text-xs" onClick={() => setOpen(false)}>Cancel</button></div>
      <Status msg={s.msg} />
    </form>
  );
}

// ---- Approved history and Develop Dialogue -------------------------------------------------------
function History({ projectId, canEdit, aiReady, sim, approved }: { projectId: string; canEdit: boolean; aiReady: boolean; sim: Simulation; approved: SimEvent[] }) {
  const s = useRun();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [scene, setScene] = useState("");
  const days = [...new Set(approved.map((e) => e.day))].sort((a, b) => b - a);
  return (
    <section className="panel flex flex-col gap-3 p-4" aria-labelledby="hist-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="hist-h" className="display text-lg">The story so far</h2>
        <span className="text-xs text-muted">Approved events are history: they&apos;re never rewritten. Change things going forward with a new event.</span>
      </div>
      {canEdit && approved.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border border-line bg-panel-2 p-2 text-xs">
          <span>{picked.size} selected →</span>
          <select className="field min-h-8 w-auto max-w-72 text-xs" value={scene} onChange={(e) => setScene(e.target.value)} aria-label="Scene to develop">
            <option value="">Choose the scene to develop…</option>
            {sim.scenes.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
          <button type="button" className="btn-primary min-h-8 text-xs" disabled={s.pending || !picked.size || !scene || !aiReady}
            onClick={() => s.run(() => simDevelopDialogue({ projectId, sceneKey: scene, eventIds: [...picked] }), () => setPicked(new Set()))}>{s.pending ? "Drafting…" : "Develop Dialogue"}</button>
          <span className="text-muted">Only approved events can be developed. The draft appears on the Script desk; your script changes only if you accept it.</span>
          <Status msg={s.msg} />
        </div>
      )}
      {days.length ? days.map((day) => (
        <div key={day} className="flex flex-col gap-1">
          <p className="text-xs font-semibold tracking-[0.08em] uppercase text-muted">Day {day}</p>
          <ul className="flex flex-col divide-y divide-line border-y border-line">
            {approved.filter((e) => e.day === day).map((e) => (
              <li key={e.id} className="flex flex-wrap items-start gap-2 py-2 text-sm">
                {canEdit && <input type="checkbox" className="mt-1" checked={picked.has(e.id)} aria-label={`Select ${e.current.title}`}
                  onChange={(x) => setPicked((p) => { const n = new Set(p); if (x.target.checked) n.add(e.id); else n.delete(e.id); return n; })} />}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{e.current.title} <span className="text-xs font-normal text-muted">({e.origin === "director" ? "your event" : BASIS[e.current.basis]?.label.toLowerCase()})</span></p>
                  <p className="text-xs text-muted">{e.current.characters.map((c) => `${c.name}: ${changeWords(c.d_stress, c.d_happiness)}${c.movement ? `; ${c.movement}` : ""}`).join(" · ") || "No direct effect on characters."}</p>
                  {e.dialogue && <p className="text-xs"><Link className="text-accent" href={`/projects/${projectId}/script#develop-scenes`}>Dialogue draft: {e.dialogue.status} →</Link></p>}
                </div>
                {canEdit && (
                  <select className="field min-h-7 w-auto max-w-56 py-0 text-[11px]" value={e.target_scene_key ?? ""} aria-label="Scene for this event"
                    onChange={(x) => s.run(() => simSetScene({ projectId, eventId: e.id, sceneKey: x.target.value }))}>
                    <option value="">Scene: not chosen</option>
                    {sim.scenes.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                  </select>
                )}
              </li>
            ))}
          </ul>
        </div>
      )) : <p className="text-sm text-muted">Nothing approved yet.</p>}
    </section>
  );
}

// ---- Characters' emotional state ------------------------------------------------------------------
// ---- Rules ---------------------------------------------------------------------------------------------
