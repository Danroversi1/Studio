"use client";
// Characters' daily coverage, on each main character's page: their bubble and the shared daily
// refresh (one job for all main characters). Coverage shown here was AVAILABLE to them; it is
// not what they read, and nothing becomes story until an event is approved in the review.
import { useAction } from "@/components/use-action";
import Link from "next/link";
import { useState } from "react";
import { bubbleRefreshNow, bubbleSaveSettings, bubbleSetActive, type BR } from "@/app/projects/[projectId]/bubble-actions";
import type { BubbleDesk, CharacterBubble } from "@/lib/bubbles/data";
import { InterestsEditor } from "./interests";

const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Caracas", "America/Sao_Paulo", "Europe/London", "Europe/Paris", "Europe/Madrid", "Asia/Tokyo", "Australia/Sydney", "UTC"];
const STATUS: Record<string, string> = { succeeded: "Succeeded", partial: "Partly succeeded", failed: "Failed", skipped: "Skipped (paused)", running: "Running…" };

function useAct() {
  const a = useAction();
  return { run: (f: () => Promise<BR>) => a.run(f, "Done."), pending: a.pending, line: a.line };
}

/** The shared daily refresh (one job for all main characters), shown inside each character's panel. */
export function BubbleRefresh({ projectId, d, canEdit }: { projectId: string; d: BubbleDesk; canEdit: boolean }) {
  const { run, pending, line } = useAct();
  const [tz, setTz] = useState(d.timezone);
  const [time, setTime] = useState(d.preferred);
  const stale = d.sources.filter((s) => s.stale).length;
  return (
    <div id="refresh" className="flex flex-col gap-2 border-t border-line pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-medium">Daily refresh <span className="font-normal text-muted">· shared by all protagonists, antagonists and supporting characters</span></h4>
        <span className="text-xs text-muted">{d.paused ? "Paused" : "Runs even when Studio is closed"}</span>
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
        <div><dt className="inline text-muted">Schedule: </dt><dd className="inline">{d.schedule}</dd></div>
        <div><dt className="inline text-muted">Next: </dt><dd className="inline">{d.nextLabel}</dd></div>
        <div><dt className="inline text-muted">Last attempted: </dt><dd className="inline">{d.lastAttempt ? `${d.lastAttempt.label} · ${STATUS[d.lastAttempt.status] ?? d.lastAttempt.status}${d.lastAttempt.trigger === "manual" ? " (you)" : " (scheduled)"}` : "Not yet"}</dd></div>
        <div><dt className="inline text-muted">Last successful: </dt><dd className="inline">{d.lastSuccess?.label ?? "Not yet"}</dd></div>
      </dl>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run(() => bubbleRefreshNow({ projectId }))}>{pending ? "Refreshing…" : "Refresh Now"}</button>
          <button type="button" className="btn" disabled={pending} onClick={() => run(() => bubbleSaveSettings({ projectId, paused: !d.paused }))}>{d.paused ? "Resume Daily Refresh" : "Pause Daily Refresh"}</button>
        </div>
      )}
      {line}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted">Sources: {d.sources.length ? `${d.sources.length - stale} fresh${stale ? `, ${stale} stale` : ""}` : "none yet (add World topics in World & Time)"}</summary>
        <ul className="mt-2 flex flex-col gap-1">
          {d.sources.map((s) => (
            <li key={s.id} className="flex flex-wrap justify-between gap-2 border-b border-line py-1">
              <span>{s.title}{s.paused ? " (stopped)" : ""}</span>
              <span className={s.stale ? "text-danger" : "text-muted"}>
                {s.status === "error" ? `Not connecting: ${s.last_error ?? "error"}` : s.stale ? "Stale" : "Connected"} · last new material {s.successLabel}
              </span>
            </li>
          ))}
        </ul>
      </details>
      {canEdit && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted">Timezone and time</summary>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-muted">Film&apos;s timezone (dates and times are shown in it)
              <select className="input" value={tz} onChange={(e) => setTz(e.target.value)}>{[...new Set([tz, ...ZONES])].map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}</select>
            </label>
            <label className="flex flex-col gap-1 text-muted">Preferred time
              <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
            <button type="button" className="btn" disabled={pending} onClick={() => run(() => bubbleSaveSettings({ projectId, timezone: tz, preferredTime: time }))}>Save</button>
          </div>
          <p className="mt-2 text-muted">
            {d.preferredSupported ? "Matches the daily refresh time." : `Saved, but not supported yet: Studio's hosting plan runs scheduled jobs once a day at one fixed time for every film (${d.schedule.replace("Every day at ", "")}). A different time needs a plan with more frequent scheduled jobs.`}
            {" "}Daylight saving time is handled automatically.
          </p>
        </details>
      )}
      {d.runs.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted">Recent refreshes</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {d.runs.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 border-b border-line py-1">
                <span>{r.label} · {r.trigger === "manual" ? "Refresh Now" : "Scheduled"}</span>
                <span className={r.status === "failed" ? "text-danger" : "text-muted"}>{STATUS[r.status] ?? r.status}{r.selected ? ` · ${r.selected} new` : ""}{r.error ? ` · ${r.error}` : r.note ? ` · ${r.note}` : ""}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function fmt(iso: string | null) {
  if (!iso) return "date unknown";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function CharacterBubblePanel({ projectId, characterId, name, canEdit, b, day, desk }: { projectId: string; characterId: string; name: string; canEdit: boolean; b: Extract<CharacterBubble, { eligible: true }>; day?: string; desk: BubbleDesk }) {
  const { run, pending, line } = useAct();
  const s = b.snapshot;
  const base = `/projects/${projectId}/items/${characterId}`;
  return (
    <section id="bubble" className="panel flex flex-col gap-3 p-5" aria-labelledby="bubble-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="bubble-h" className="text-lg font-medium">{name}&apos;s daily coverage</h3>
        <span className="text-sm text-muted">{!b.active ? "Paused" : b.filmPaused ? "Daily refresh paused for the film" : "Refreshes daily"}</span>
      </div>
      <p className="text-xs text-muted">
        The news that was around {name} each day: from World &amp; Time&apos;s feeds and from their own interests and the feeds they follow. Not what they read, and not story yet: it becomes part of the story only if you approve an event in{" "}
        <Link className="text-accent" href={`/projects/${projectId}/world#simulation`}>the world, day by day</Link>.
      </p>
      {!b.active && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>{b.inactiveReason === "role" ? `${name}'s bubble was paused when they were made Featured. Earlier days are kept.` : `${name}'s bubble is paused. Earlier days are kept.`}</span>
          {canEdit && <button type="button" className="btn" disabled={pending} onClick={() => run(() => bubbleSetActive({ projectId, characterId, active: true }))}>Resume {name}&apos;s bubble</button>}
        </div>
      )}
      <InterestsEditor projectId={projectId} characterId={characterId} name={name} canEdit={canEdit} topics={b.topics} avoid={b.avoid} attention={b.attention}
        searched={b.searched} followed={b.followed} active={b.active} key={`${b.topics.join("|")}/${b.avoid.join("|")}/${b.attention}/${b.followed.length}`} />
      {line}
      {s ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="font-medium">{new Date(`${s.run_date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })}</h4>
            {b.days.length > 1 && (
              <nav className="flex flex-wrap gap-2 text-xs" aria-label="Earlier days">
                {b.days.slice(0, 10).map((d) => d === s.run_date ? <span key={d} className="font-medium">{d.slice(5)}</span> : <Link key={d} className="text-accent" href={`${base}?day=${d}#bubble`} scroll={false}>{d.slice(5)}</Link>)}
              </nav>
            )}
          </div>
          <p className="text-sm">{s.summary}</p>
          {s.items.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {s.items.map((e) => (
                <li key={e.key} className="border-b border-line py-1">
                  {e.url ? <a className="text-accent" href={e.url} target="_blank" rel="noreferrer">{e.title}</a> : e.title}
                  <span className="block text-xs text-muted">
                    {e.source} · {fmt(e.published_at)} · collected {fmt(e.retrieved_at)}
                    {e.matched.length > 0 && ` · ${e.matched.join(", ")}`}
                    {e.update_of !== undefined && ` · update to an earlier report (was version ${e.update_of})`}
                    {e.propose && " · offered to the event review"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {day && day !== b.days[0] && <Link className="text-xs text-accent" href={`${base}#bubble`} scroll={false}>Back to the latest day</Link>}
        </div>
      ) : (
        <p className="text-sm text-muted">No coverage yet. It appears after the next refresh{canEdit ? " — or use Refresh Now below" : ""}.</p>
      )}
      <BubbleRefresh projectId={projectId} d={desk} canEdit={canEdit} />
    </section>
  );
}
