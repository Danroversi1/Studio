"use client";
// Society's mood: how people in the story's societies (US, EU) feel about jobs, prices,
// affordability and well-being, from public surveys of people, scored against the last ten
// years. Plus recent poll reports. Read by the day-by-day simulation.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { societySetRegions } from "@/app/projects/[projectId]/society-actions";
import type { Society } from "@/lib/society/data";
import { fmtMonth, fmtValue, moodWord } from "@/lib/society/score";
import { SOURCES, THEME_HINT, THEME_LABEL, type Region } from "@/lib/society/sources";

const REGION_LABEL: Record<Region, string> = { US: "United States", EU: "European Union" };
const ARROW = { better: "↑ better than last month", worse: "↓ worse than last month", steady: "→ about the same" } as const;
const ago = (iso: string | null) => {
  if (!iso) return "never";
  const h = Math.round((Date.now() - Date.parse(iso)) / 3600_000);
  return h < 1 ? "just now" : h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};

function Meter({ value }: { value: number | null }) {
  return (
    <div className="relative h-1.5 w-full bg-line" aria-hidden>
      {value !== null && <span className="absolute top-[-3px] h-3 w-1.5 bg-text" style={{ left: `calc(${value * 10}% - 3px)` }} />}
    </div>
  );
}

export function SocietyPanel({ projectId, canEdit, s }: { projectId: string; canEdit: boolean; s: Society }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (r: Region) => {
    const next = s.regions.includes(r) ? s.regions.filter((x) => x !== r) : [...s.regions, r];
    start(async () => { const res = await societySetRegions({ projectId, regions: next }); setErr(res.ok ? null : res.error); router.refresh(); });
  };
  const stale = s.sources.filter((x) => x.stale);
  return (
    <section id="society" className="panel flex flex-col gap-3 p-5" aria-labelledby="society-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="society-h" className="text-lg font-medium">Society&apos;s mood</h3>
        <div className="flex gap-1" role="group" aria-label="Societies in this story">
          {(["US", "EU"] as Region[]).map((r) => (
            <button key={r} type="button" disabled={!canEdit || pending} aria-pressed={s.regions.includes(r)} onClick={() => toggle(r)}
              className={`border px-2 py-1 text-xs ${s.regions.includes(r) ? "border-text bg-text text-panel-2" : "border-line hover:border-text"}`}>{REGION_LABEL[r]}</button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted">
        How people feel about jobs, prices, affordability and well-being, from large public surveys of people, refreshed daily. Each theme is scored 0–10 against the last ten years: 0 is as gloomy as it&apos;s been, 10 as upbeat. The day-by-day simulation uses it to judge which world events matter most right now, and how featured characters react.
      </p>
      {err && <p role="alert" className="text-xs text-danger">{err}</p>}
      {!s.regions.length && <p className="text-sm text-muted">Choose the United States, the European Union or both.</p>}
      {s.regions.map((region) => (
        <div key={region} className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold uppercase tracking-[0.08em]">{REGION_LABEL[region]}</h4>
          <div className="grid gap-2 sm:grid-cols-2">
            {s.moods.filter((m) => m.region === region).map((m) => {
              const k = `${m.region}.${m.theme}`;
              return (
                <div key={k} className="flex flex-col gap-1 border border-line p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium" title={THEME_HINT[m.theme]}>{THEME_LABEL[m.theme]}</span>
                    <span className="text-sm"><span className="text-lg font-semibold">{m.score === null ? "—" : m.score.toFixed(1)}</span><span className="text-muted"> / 10 · {moodWord(m.score)}</span></span>
                  </div>
                  <Meter value={m.score} />
                  <span className="text-[11px] text-muted">{m.change ? ARROW[m.change] : "No trend yet"} · as of {fmtMonth(m.latestPeriod)}</span>
                  <button type="button" className="self-start text-[11px] text-accent underline" aria-expanded={open === k} onClick={() => setOpen(open === k ? null : k)}>{open === k ? "Hide the surveys" : "The surveys"}</button>
                  {open === k && (
                    <ul className="flex flex-col gap-1 text-xs">
                      {m.readings.map((r) => (
                        <li key={r.series.id} className="border-t border-line pt-1">
                          {r.series.label}: <strong>{r.latest ? fmtValue(r.series, r.latest.value) : "—"}</strong>
                          <span className="text-muted"> · {fmtMonth(r.latest?.period ?? null)}{r.score !== null ? ` · ${r.score.toFixed(1)}/10 vs 10 years` : ""}{r.change ? ` · ${r.change}` : ""} · </span>
                          <a className="text-accent" href={SOURCES[r.series.source].page} target="_blank" rel="noreferrer">{SOURCES[r.series.source].short}</a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <details className="text-sm">
        <summary className="cursor-pointer font-medium">Recent poll reports ({s.reports.length})</summary>
        <ul className="mt-2 flex flex-col gap-1">
          {s.reports.map((r) => (
            <li key={r.id} className="border-b border-line py-1">
              <a className="text-accent" href={r.url} target="_blank" rel="noreferrer">{r.title}</a>
              <span className="block text-xs text-muted">{r.publisher} · {r.published_at ? new Date(r.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "date unknown"} · {r.themes.map((t) => THEME_LABEL[t]).join(", ")}{r.region !== "World" ? ` · ${r.region}` : ""}</span>
            </li>
          ))}
          {!s.reports.length && <li className="text-xs text-muted">None yet. They arrive with the next daily refresh.</li>}
        </ul>
        <p className="mt-1 text-[11px] text-muted">Only reports from Gallup, Pew Research Center, AP-NORC, Ipsos, YouGov, the New York Fed, the ECB, Eurobarometer and Eurofound are kept.</p>
      </details>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted">Sources: {s.sources.length - stale.length} up to date{stale.length ? `, ${stale.length} stale` : ""} · refreshed daily at about 4:17 AM New York time</summary>
        <ul className="mt-2 flex flex-col gap-1">
          {s.sources.map((x) => (
            <li key={x.id} className="flex flex-wrap justify-between gap-2 border-b border-line py-1">
              <span>{x.page ? <a className="text-accent" href={x.page} target="_blank" rel="noreferrer">{x.label}</a> : x.label}</span>
              <span className={x.stale ? "text-danger" : "text-muted"}>{x.last_error ? `Problem: ${x.last_error}` : "Connected"} · updated {ago(x.last_success_at)}{x.latest_period ? ` · latest survey ${fmtMonth(x.latest_period)}` : ""}</span>
            </li>
          ))}
          {!s.sources.length && <li className="text-muted">Not fetched yet. The first daily refresh brings them in.</li>}
        </ul>
        <p className="mt-1 text-muted">Surveys are published monthly, so most numbers change once a month; earlier readings are kept when a source can&apos;t be reached.</p>
      </details>
    </section>
  );
}
