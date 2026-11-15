// Three-act timeline on a 90-minute ruler (1 script page ≈ 1 minute). Her own act markers
// ("# ACT ONE" lines in the script) win; otherwise a common 25/45/20 guide is shown and
// labelled as a guide. Scenes are drawn where they fall in the script.
import { ACT_GUIDE, BEAT_GUIDE, type ParsedScript, TARGET_MINUTES } from "@/lib/screenplay";

const ACT_TONES = ["bg-brand/25", "bg-text/10", "bg-brand/15", "bg-text/5"];

export function ActTimeline({ script }: { script: ParsedScript }) {
  const span = Math.max(TARGET_MINUTES, Math.ceil(script.totalPages / 10) * 10);
  const pct = (page: number) => `${Math.min(100, (page / span) * 100)}%`;
  const own = script.acts.length > 0;
  const bands = own
    ? script.acts.map((a, i) => ({ label: a.label, from: a.position, to: script.acts[i + 1]?.position ?? Math.max(script.totalPages, a.position) }))
    : ACT_GUIDE.map((a) => ({ label: a.label, from: a.from, to: a.to }));
  const ticks = Array.from({ length: span / 10 + 1 }, (_, i) => i * 10);
  const pagesNow = Math.round(script.totalPages * 10) / 10;

  return (
    <section className="panel corner-marks flex flex-col gap-3 p-4" aria-labelledby="tl-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="tl-h" className="display text-lg">Three-act timeline</h2>
        <p className="text-xs tracking-[0.08em] text-muted uppercase">
          {pagesNow} of {TARGET_MINUTES} pages · about {Math.round(script.totalPages)} min · {script.scenes.length} {script.scenes.length === 1 ? "scene" : "scenes"}
        </p>
      </div>

      <div className="relative pt-1" aria-hidden>
        {/* act bands */}
        <div className="relative h-9 border border-line bg-panel-2">
          {bands.map((b, i) => (
            <div key={`${b.label}-${i}`} className={`absolute inset-y-0 border-r border-line ${own ? ACT_TONES[i % ACT_TONES.length] : i === 1 ? "bg-text/5" : "bg-brand/10"}`}
              style={{ left: pct(b.from), width: `calc(${pct(b.to)} - ${pct(b.from)})` }}>
              <span className="absolute top-1 left-1.5 text-[10px] font-semibold tracking-[0.12em] whitespace-nowrap uppercase">{b.label}</span>
            </div>
          ))}
          {/* written so far */}
          <div className="absolute inset-y-0 left-0 border-r-2 border-brand" style={{ width: pct(script.totalPages) }} />
        </div>
        {/* scenes */}
        <div className="relative mt-1 h-5">
          {script.scenes.map((s) => (
            <div key={s.number} title={`${s.number}. ${s.heading} — p. ${Math.floor(s.startPage) + 1}`}
              className="absolute top-0 h-full border border-panel-2 bg-text"
              style={{ left: pct(s.startPage), width: `max(3px, calc(${pct(s.endPage)} - ${pct(s.startPage)}))` }} />
          ))}
        </div>
        {/* guide beats */}
        {!own && (
          <div className="relative mt-1 h-10">
            {BEAT_GUIDE.map((b) => (
              <div key={b.page} className="absolute top-0 flex -translate-x-1/2 flex-col items-center" style={{ left: pct(b.page) }}>
                <span className="h-2 border-l border-dashed border-muted" />
                <span className="text-[9px] leading-tight whitespace-nowrap text-muted">{b.label}</span>
              </div>
            ))}
          </div>
        )}
        {/* ruler */}
        <div className="relative mt-1 h-4 border-t border-line">
          {ticks.map((t) => (
            <span key={t} className="absolute top-0 -translate-x-1/2 text-[10px] text-muted" style={{ left: pct(t) }}>
              <span className="block h-1.5 border-l border-line" />{t}
            </span>
          ))}
        </div>
      </div>

      <p className="help">
        {own
          ? "Act bands come from your own act markers (lines starting with #)."
          : "Shaded acts and dashed beats are a common guide for a 90-minute film, not rules. Add your own act breaks with a line like “# ACT TWO”."}
        {" "}One page is roughly one minute of screen time; the page count is an estimate.
      </p>
      {script.scenes.length > 0 && (
        <ol className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
          {script.scenes.map((s) => (
            <li key={s.number} className="flex justify-between gap-2 border-b border-line py-1">
              <span className="truncate"><span className="text-muted">{s.number}.</span> {s.heading}</span>
              <span className="shrink-0 text-muted">p. {Math.floor(s.startPage) + 1}{s.act && own ? ` · ${script.acts[s.act - 1]?.label}` : ""}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
