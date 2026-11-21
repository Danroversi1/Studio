"use client";
// "How {name} is doing": one 0–10 mood, from the harmony between what reached them (their
// daily coverage) and their own rules. Judged on her own computer; scored by Studio's code.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { moodOverride, moodSetJudge, moodSetStart, type MR } from "@/app/projects/[projectId]/mood-actions";
import type { CharacterMood } from "@/lib/mood/data";
import { moodLabel, showMood } from "@/lib/mood/score";

const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const ago = (iso: string | null) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 2 ? "just now" : m < 120 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

function Bar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted">
      <span className="w-24 text-right">Sad &amp; stressed</span>
      <div className="relative h-1.5 flex-1 bg-line" aria-hidden><span className="absolute top-[-3px] h-3 w-1.5 bg-text" style={{ left: `calc(${value * 10}% - 3px)` }} /></div>
      <span className="w-24">Happy &amp; calm</span>
    </div>
  );
}

export function MoodPanel({ projectId, characterId, name, canEdit, m }: { projectId: string; characterId: string; name: string; canEdit: boolean; m: CharacterMood }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [startVal, setStartVal] = useState(m.start);
  const [over, setOver] = useState(m.latest ? (m.latest.override ?? m.latest.score ?? 5) : 5);
  const [note, setNote] = useState(m.latest?.override_note ?? "");
  const [open, setOpen] = useState<null | "start" | "override">(null);
  const run = (f: () => Promise<MR>) => start(async () => {
    const r = await f();
    setMsg(r.ok ? { kind: "ok", text: r.note ?? "Saved." } : { kind: "error", text: r.error });
    if (r.ok) { setOpen(null); router.refresh(); }
  });
  const l = m.latest;
  const rules = new Map((l?.payload.rules ?? []).map((r) => [r.id, r.text]));
  const items = new Map((l?.payload.items ?? []).map((i) => [i.key, i]));
  return (
    <section className="panel flex flex-col gap-3 p-5" aria-labelledby="mood-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="mood-h" className="text-lg font-medium">How {name} is doing</h3>
        <span className="text-sm"><span className="text-2xl font-semibold">{showMood(m.current)}</span><span className="text-muted"> / 10 · </span>{moodLabel(m.current)}</span>
      </div>
      <Bar value={m.current} />
      <p className="text-xs text-muted">
        Worked out each day from how the news in {name}&apos;s daily coverage sits with their rules in <a className="text-accent" href="#rules">How {name} reacts</a>: in tune lifts it toward 10, at odds pulls it toward 0, and it moves gradually. Approved story events in{" "}
        <Link className="text-accent" href={`/projects/${projectId}/world#simulation`}>the world, day by day</Link> nudge it too. A writing control for your story, not a measurement of anyone.
      </p>
      <p className="text-xs">
        {l ? <>Latest: {fmtDay(l.day)}{l.override !== null ? <> · your number {showMood(l.override)}{l.override_note ? ` (“${l.override_note}”)` : ""}</> : null}
          {l.status === "failed" ? " · couldn't be judged, counted as a quiet day" : l.harmony === null ? " · a quiet day (nothing related reached them), drifting back toward their starting point" : ` · ${l.harmony > 0.2 ? "mostly in tune" : l.harmony < -0.2 ? "mostly at odds" : "mixed"}`}
          {Math.abs(m.nudge) >= 0.05 && ` · ${m.nudge > 0 ? "+" : "−"}${Math.abs(m.nudge).toFixed(1)} from approved events since`}</> : `Starts at ${showMood(m.start)}. The first daily score comes after the next morning refresh.`}
      </p>
      {m.waiting > 0 && (
        <p className="text-xs text-warn">
          {m.judge ? `${m.waiting} day${m.waiting === 1 ? "" : "s"} waiting for ${m.judge.name} to judge (last seen ${ago(m.judge.lastSeen)}). Days are judged when that computer is on and the Mood Judge is running.`
            : `${m.waiting} day${m.waiting === 1 ? "" : "s"} waiting: choose the computer that judges moods below.`}
        </p>
      )}
      {l && l.judgments.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {l.judgments.map((j, i) => {
            const it = items.get(j.item_key);
            return (
              <li key={i} className="border-b border-line py-1">
                <span className={`mr-2 border px-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${j.relation > 0 ? "border-ok text-ok" : "border-danger text-danger"}`}>{j.relation > 0 ? "In tune" : "At odds"}</span>
                {it?.title ?? "A news item"} <span className="text-xs text-muted">· {it?.source}</span>
                <span className="block text-xs text-muted">{rules.get(j.rule_id) ?? "A rule"} — {j.reason}</span>
              </li>
            );
          })}
          <li className="text-[11px] text-muted">Judged on your computer{l.model ? ` with ${l.model}` : ""}.</li>
        </ul>
      )}
      {m.days.filter((d) => d.score !== null).length > 1 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted">Earlier days</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {m.days.filter((d) => d.score !== null).map((d) => (
              <li key={d.id} className="flex justify-between gap-2 border-b border-line py-1">
                <span>{fmtDay(d.day)}</span>
                <span className="text-muted">{showMood(d.override ?? d.score!)}{d.override !== null ? " (yours)" : ""} · {d.status === "failed" ? "not judged" : d.harmony === null ? "quiet day" : `${d.judgments.filter((j) => j.relation > 0).length} in tune, ${d.judgments.filter((j) => j.relation < 0).length} at odds`}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {canEdit && (
        <div className="flex flex-wrap gap-3 text-xs">
          <button type="button" className="text-accent underline" onClick={() => setOpen(open === "start" ? null : "start")}>Set where they start</button>
          {l && <button type="button" className="text-accent underline" onClick={() => setOpen(open === "override" ? null : "override")}>Change {fmtDay(l.day)}&apos;s number</button>}
        </div>
      )}
      {open === "start" && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <input type="range" min={0} max={10} step={0.5} value={startVal} onChange={(e) => setStartVal(Number(e.target.value))} aria-label="Starting mood" />
          <span>{showMood(startVal)} · {moodLabel(startVal)}</span>
          <button type="button" className="btn min-h-8 text-xs" disabled={pending} onClick={() => run(() => moodSetStart({ projectId, characterId, value: startVal }))}>Save</button>
        </div>
      )}
      {open === "override" && l && (
        <div className="flex flex-col gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <input type="range" min={0} max={10} step={0.5} value={over} onChange={(e) => setOver(Number(e.target.value))} aria-label="Your number for this day" />
            <span>{showMood(over)} · {moodLabel(over)}</span>
          </div>
          <input className="field" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Why (optional)" />
          <div className="flex gap-2">
            <button type="button" className="btn-primary min-h-8 text-xs" disabled={pending} onClick={() => run(() => moodOverride({ projectId, characterId, day: l.day, score: over, note }))}>Use my number</button>
            {l.override !== null && <button type="button" className="btn min-h-8 text-xs" disabled={pending} onClick={() => run(() => moodOverride({ projectId, characterId, day: l.day, score: null, note: "" }))}>Use the worked-out score</button>}
          </div>
        </div>
      )}
      {canEdit && (
        <label className="flex flex-wrap items-center gap-2 text-xs text-muted">Judged on
          <select className="field min-h-8 w-auto text-xs" value={m.judge?.id ?? ""} disabled={pending}
            onChange={(e) => run(() => moodSetJudge({ projectId, characterId, deviceId: e.target.value || null }))}>
            <option value="">{m.judgeSet && !m.judge ? "A computer that isn't yours" : "No computer chosen"}</option>
            {m.devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <span>· one computer for the whole film · runs the free Mood Judge with a local model ·{" "}
            <a className="text-accent" href="https://github.com/Danroversi1/Studio/blob/main/renderer/README.md#studio-mood-judge-how-name-is-doing-worked-out-on-your-computer" target="_blank" rel="noreferrer">set up</a>
            {!m.devices.length && <> · <Link className="text-accent" href={`/projects/${projectId}/storyboards/renderer`}>pair a computer</Link></>}</span>
        </label>
      )}
      {msg && <p role={msg.kind === "error" ? "alert" : "status"} className={`text-xs ${msg.kind === "error" ? "text-danger" : "text-muted"}`}>{msg.text}</p>}
    </section>
  );
}
