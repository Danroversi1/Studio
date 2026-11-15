"use client";
// World & Time overview: WHERE, WHEN, TIME SPAN, coverage, and "your world, in a sentence".
// Each card edits in place with Save / Cancel. What she typed stays on screen if saving
// fails. Suggestions (from the World Builder or from reading her story) show on the card
// with Accept / Dismiss and never count as decided until she accepts them.
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { acceptWorldSuggestion, dismissWorldSuggestion, saveWorldSection, type WorldResult } from "@/app/projects/[projectId]/world-actions";
import {
  COVERAGE_LABEL, COVERAGES, PLACE_KINDS, PRECISIONS, calculateSpan, cleanValue, composeSentence, guessPrecision, periodsText, placesText,
  spanConflict, type Coverage, type Period, type Place, type Precision, type Section, type SpanValue, type WhenValue, type WhereValue, type World,
} from "@/lib/world";

const KIND_LABEL: Record<Place["kind"], string> = { real: "Real place", invented: "Invented", mixed: "Real + invented", unknown: "Not sure" };
const PRECISION_LABEL: Record<Precision, string> = {
  exact: "Exact date", year: "Year", approximate: "Approximate", era: "Era", relative: "Relative (“ten years later”)", invented: "Invented calendar", undecided: "Not decided",
};
const SOURCE_LABEL = { director: "Yours", conversation: "Yours · decided with the World Builder" } as const;
const PROPOSAL_LABEL = { world_builder: "Suggested by the World Builder", story_read: "Found in your story" } as const;

type Ctx = { projectId: string; version: number; canEdit: boolean };

function useSaver(ctx: Ctx) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  function run(fn: () => Promise<WorldResult>, okText: string, after?: () => void) {
    if (pending) return;
    setMsg(null);
    start(async () => {
      let r: WorldResult;
      try { r = await fn(); } catch { r = { ok: false, error: "That didn't save. Check your connection and try again; your text is still here." }; }
      if (r.ok) { setMsg({ kind: "ok", text: okText }); after?.(); router.refresh(); }
      else setMsg({ kind: "error", text: r.error ?? "That didn't save. Try again." });
    });
  }
  return { pending, msg, run, setMsg };
}

function Status({ msg }: { msg: { kind: "error" | "ok"; text: string } | null }) {
  if (!msg) return null;
  return <p role={msg.kind === "error" ? "alert" : "status"} className={`text-xs ${msg.kind === "error" ? "text-danger" : "text-muted"}`}>{msg.text}</p>;
}

function Suggestion({ ctx, section, label, source, why }: { ctx: Ctx; section: Section; label: string; source: keyof typeof PROPOSAL_LABEL; why?: string }) {
  const s = useSaver(ctx);
  return (
    <div className="flex flex-col gap-1.5 border border-dashed border-brand p-2.5">
      <p className="text-[11px] tracking-[0.12em] text-muted uppercase">{PROPOSAL_LABEL[source]} · not decided</p>
      <p className="text-sm font-medium">{label}</p>
      {why && <p className="text-xs text-muted">{why}</p>}
      {ctx.canEdit && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn min-h-9 text-xs" disabled={s.pending}
            onClick={() => s.run(() => acceptWorldSuggestion({ projectId: ctx.projectId, section }), "Accepted.")}>Use this</button>
          <button type="button" className="btn min-h-9 text-xs" disabled={s.pending}
            onClick={() => s.run(() => dismissWorldSuggestion({ projectId: ctx.projectId, section }), "Dismissed.")}>Dismiss</button>
        </div>
      )}
      <Status msg={s.msg} />
    </div>
  );
}

function Card({ title, big, small, source, children, editing, onEdit, canEdit, flag, prompt }: {
  title: string; big: string; small: string; source?: string; children?: React.ReactNode; editing: boolean; onEdit: () => void; canEdit: boolean; flag?: string | null;
  /** Shown above the editor when the card is still empty. */
  prompt?: string;
}) {
  return (
    <section className="panel relative flex min-h-56 flex-col gap-3 p-5" aria-label={title}>
      <span className="absolute top-0 left-0 size-2 bg-brand" aria-hidden />
      <div className="flex items-start justify-between gap-2">
        <h2 className="eyebrow text-text">{title}</h2>
        {canEdit && !editing && <button type="button" className="text-xs text-accent underline-offset-2 hover:underline" onClick={onEdit}>Edit<span className="sr-only"> {title.toLowerCase()}</span></button>}
      </div>
      {editing && prompt && <p className="text-sm">{prompt}</p>}
      {!editing && (
        <div className="flex flex-col gap-1">
          <p className={`display leading-tight ${big.length > 28 ? "text-xl" : "text-3xl"} ${big === "Not decided" ? "text-muted" : ""}`}>{big}</p>
          {small && <p className="text-sm text-muted">{small}</p>}
          {source && <p className="text-[11px] tracking-[0.1em] text-muted uppercase">{source}</p>}
          {flag && <p className="mt-1 border-l-2 border-brand pl-2 text-xs">{flag}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

function EditActions({ pending, onCancel }: { pending: boolean; onCancel?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="submit" className="btn-primary min-h-9 text-xs" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
      {onCancel && <button type="button" className="btn min-h-9 text-xs" onClick={onCancel} disabled={pending}>Cancel</button>}
    </div>
  );
}

// ---------------------------------------------------------------------------
function WhereEditor({ ctx, initial, locations, onDone, onCancel }: { ctx: Ctx; initial?: WhereValue; locations: { id: string; name: string }[]; onDone: () => void; onCancel?: () => void }) {
  const id = useId();
  const [places, setPlaces] = useState<Place[]>(initial?.places.length ? initial.places : [{ name: "", kind: "unknown" }]);
  const [note, setNote] = useState(initial?.note ?? "");
  const [undecided, setUndecided] = useState(!!initial?.undecided && !!initial);
  const s = useSaver(ctx);
  const set = (i: number, p: Partial<Place>) => setPlaces((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => {
      e.preventDefault();
      const value = undecided ? { places: [], note, undecided: true } : { places: places.filter((p) => p.name.trim()), note };
      s.run(() => saveWorldSection({ projectId: ctx.projectId, section: "where", value, baseVersion: ctx.version }), "Saved.", onDone);
    }}>
      <fieldset className="flex flex-col gap-3" disabled={undecided}>
        <legend className="sr-only">Places in your story</legend>
        {places.map((p, i) => (
          <div key={i} className="flex flex-col gap-1.5 border-b border-line pb-3">
            <label className="label" htmlFor={`${id}-n${i}`}>Place {places.length > 1 ? i + 1 : ""}</label>
            <input id={`${id}-n${i}`} className="field" value={p.name} maxLength={120} placeholder="Los Angeles, a lighthouse, the planet Zarn…"
              onChange={(e) => set(i, { name: e.target.value })} />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="text-xs text-muted">Kind
                <select className="field mt-1" value={p.kind} onChange={(e) => set(i, { kind: e.target.value as Place["kind"] })}>
                  {PLACE_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </select>
              </label>
              <label className="text-xs text-muted">Size (optional)
                <input className="field mt-1" value={p.scale ?? ""} maxLength={60} placeholder="a room, a city, a planet" onChange={(e) => set(i, { scale: e.target.value })} />
              </label>
              {places.length > 1 && (
                <label className="text-xs text-muted">Inside (optional)
                  <select className="field mt-1" value={p.within ?? ""} onChange={(e) => set(i, { within: e.target.value || undefined })}>
                    <option value="">—</option>
                    {places.filter((o, j) => j !== i && o.name.trim()).map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
                  </select>
                </label>
              )}
              {locations.length > 0 && (
                <label className="text-xs text-muted">Same as a Location (optional)
                  <select className="field mt-1" value={p.location_id ?? ""} onChange={(e) => set(i, { location_id: e.target.value || undefined })}>
                    <option value="">—</option>
                    {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </label>
              )}
            </div>
            {places.length > 1 && (
              <button type="button" className="self-start text-xs text-muted underline" onClick={() => setPlaces((xs) => xs.filter((_, j) => j !== i))}>Remove this place</button>
            )}
          </div>
        ))}
        {places.length < 12 && (
          <button type="button" className="self-start text-xs text-accent" onClick={() => setPlaces((xs) => [...xs, { name: "", kind: "unknown" }])}>+ Another place</button>
        )}
        <label className="text-xs text-muted">A short line about it (optional)
          <input className="field mt-1" value={note} maxLength={400} placeholder="One city, two moments." onChange={(e) => setNote(e.target.value)} />
        </label>
      </fieldset>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={undecided} onChange={(e) => setUndecided(e.target.checked)} /> Not decided yet</label>
      <p className="text-xs text-muted">These are places in your story, not where you&apos;ll film.</p>
      <EditActions pending={s.pending} onCancel={onCancel} />
      <Status msg={s.msg} />
    </form>
  );
}

function WhenEditor({ ctx, initial, onDone, onCancel }: { ctx: Ctx; initial?: WhenValue; onDone: () => void; onCancel?: () => void }) {
  const id = useId();
  const [periods, setPeriods] = useState<Period[]>(initial?.periods.length ? initial.periods : [{ label: "", precision: "undecided" }]);
  const [touched, setTouched] = useState<Record<number, boolean>>({});
  const [note, setNote] = useState(initial?.note ?? "");
  const [undecided, setUndecided] = useState(!!initial?.undecided && !!initial);
  const s = useSaver(ctx);
  const set = (i: number, p: Partial<Period>) => setPeriods((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const preview = cleanValue("when", { periods }) as WhenValue;
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => {
      e.preventDefault();
      // Years are worked out again from her words on save; her label is always kept.
      const value = undecided ? { periods: [], note, undecided: true }
        : { periods: periods.filter((p) => p.label.trim()).map((p) => ({ label: p.label, precision: p.precision })), note };
      s.run(() => saveWorldSection({ projectId: ctx.projectId, section: "when", value, baseVersion: ctx.version }), "Saved.", onDone);
    }}>
      <fieldset className="flex flex-col gap-3" disabled={undecided}>
        <legend className="sr-only">Story periods</legend>
        {periods.map((p, i) => (
          <div key={i} className="flex flex-col gap-1.5 border-b border-line pb-3">
            <label className="label" htmlFor={`${id}-l${i}`}>Period {periods.length > 1 ? i + 1 : ""}, in your words</label>
            <input id={`${id}-l${i}`} className="field" value={p.label} maxLength={120} placeholder="2046, the 1990s, the summer before the flood…"
              onChange={(e) => set(i, { label: e.target.value, ...(touched[i] ? {} : { precision: guessPrecision(e.target.value) }) })} />
            <label className="text-xs text-muted">What kind of time is it?
              <select className="field mt-1" value={p.precision} onChange={(e) => { setTouched((t) => ({ ...t, [i]: true })); set(i, { precision: e.target.value as Precision }); }}>
                {PRECISIONS.map((k) => <option key={k} value={k}>{PRECISION_LABEL[k]}</option>)}
              </select>
            </label>
            {preview.periods[i]?.start_year != null && (
              <p className="text-xs text-muted">STUDIO reads this as {preview.periods[i].start_year! < 0 ? `${-preview.periods[i].start_year!} BCE` : preview.periods[i].start_year}
                {preview.periods[i].end_year !== preview.periods[i].start_year ? `–${preview.periods[i].end_year}` : ""}.</p>
            )}
            {periods.length > 1 && (
              <button type="button" className="self-start text-xs text-muted underline" onClick={() => setPeriods((xs) => xs.filter((_, j) => j !== i))}>Remove this period</button>
            )}
          </div>
        ))}
        {periods.length < 12 && (
          <button type="button" className="self-start text-xs text-accent" onClick={() => setPeriods((xs) => [...xs, { label: "", precision: "undecided" }])}>+ Another period</button>
        )}
        <label className="text-xs text-muted">A short line about it (optional)
          <input className="field mt-1" value={note} maxLength={400} placeholder="Two story periods." onChange={(e) => setNote(e.target.value)} />
        </label>
      </fieldset>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={undecided} onChange={(e) => setUndecided(e.target.checked)} /> Not decided yet</label>
      <EditActions pending={s.pending} onCancel={onCancel} />
      <Status msg={s.msg} />
    </form>
  );
}

function SpanEditor({ ctx, initial, calcText, onDone, onCancel }: { ctx: Ctx; initial?: SpanValue; calcText: string | null; onDone: () => void; onCancel?: () => void }) {
  const id = useId();
  const [text, setText] = useState(initial?.text ?? "");
  const [unusual, setUnusual] = useState(!!initial?.unusual);
  const [undecided, setUndecided] = useState(initial?.basis === "undecided");
  const s = useSaver(ctx);
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => {
      e.preventDefault();
      const value = undecided ? { text: "", basis: "undecided" } : { text, basis: "creator", unusual };
      if (!undecided && !text.trim()) { s.setMsg({ kind: "error", text: "Write the span, or tick Not decided yet." }); return; }
      s.run(() => saveWorldSection({ projectId: ctx.projectId, section: "span", value, baseVersion: ctx.version }), "Saved.", onDone);
    }}>
      <div className="flex flex-col gap-1.5">
        <label className="label" htmlFor={`${id}-t`}>From the first event to the last</label>
        <input id={`${id}-t`} className="field" value={text} maxLength={200} disabled={undecided}
          placeholder={calcText ?? "one afternoon, ten years, several generations…"} onChange={(e) => setText(e.target.value)} />
        {calcText && <p className="text-xs text-muted">From your dates: {calcText} (calculated).</p>}
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={unusual} disabled={undecided} onChange={(e) => setUnusual(e.target.checked)} /> Time passes differently for some characters or worlds</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={undecided} onChange={(e) => setUndecided(e.target.checked)} /> Not decided yet</label>
      <EditActions pending={s.pending} onCancel={onCancel} />
      <Status msg={s.msg} />
    </form>
  );
}

function CoverageChoice({ ctx, value }: { ctx: Ctx; value?: Coverage }) {
  const s = useSaver(ctx);
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-1.5 border-t border-line pt-3" disabled={!ctx.canEdit || s.pending}>
      <legend className="mb-1 text-xs text-muted">Do we follow that time as it happens?</legend>
      {COVERAGES.map((c) => (
        <label key={c} className="flex items-center gap-2 text-sm">
          <input type="radio" name={name} checked={value === c}
            onChange={() => s.run(() => saveWorldSection({ projectId: ctx.projectId, section: "coverage", value: c, baseVersion: ctx.version }), "Saved.")} />
          {COVERAGE_LABEL[c]}
        </label>
      ))}
      <Status msg={s.msg} />
    </fieldset>
  );
}

function SentenceCard({ ctx, world }: { ctx: Ctx; world: World }) {
  const confirmed = world.confirmed.summary?.value.text ?? "";
  const suggested = composeSentence(world.confirmed);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(confirmed || suggested || "");
  const s = useSaver(ctx);
  const save = (t: string) => s.run(() => saveWorldSection({ projectId: ctx.projectId, section: "summary", value: { text: t }, baseVersion: ctx.version }), "Saved.", () => setEditing(false));
  return (
    <section className="panel flex flex-col gap-3 p-5" aria-labelledby="world-sentence">
      <div className="flex items-start justify-between gap-2">
        <h2 id="world-sentence" className="eyebrow text-text">Your world, in a sentence</h2>
        {ctx.canEdit && !editing && <button type="button" className="text-xs text-accent hover:underline" onClick={() => { setText(confirmed || suggested || ""); setEditing(true); }}>Edit</button>}
      </div>
      {editing ? (
        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) save(text); }}>
          <label className="sr-only" htmlFor="world-sentence-text">Your world, in a sentence</label>
          <textarea id="world-sentence-text" className="field font-serif" rows={2} maxLength={600} value={text} onChange={(e) => setText(e.target.value)} />
          <EditActions pending={s.pending} onCancel={() => setEditing(false)} />
        </form>
      ) : confirmed ? (
        <>
          <p className="font-serif text-xl leading-snug">{confirmed}</p>
          {suggested && suggested !== confirmed && world.confirmed.summary && (
            <div className="flex flex-col gap-1.5 border border-dashed border-line p-2.5 text-sm">
              <p className="text-[11px] tracking-[0.12em] text-muted uppercase">Suggestion from your latest choices · not decided</p>
              <p>{suggested}</p>
              {ctx.canEdit && <button type="button" className="btn min-h-9 self-start text-xs" disabled={s.pending} onClick={() => save(suggested)}>Use this</button>}
            </div>
          )}
        </>
      ) : suggested ? (
        <div className="flex flex-col gap-2">
          <p className="font-serif text-xl leading-snug text-muted">{suggested}</p>
          <p className="text-[11px] tracking-[0.12em] text-muted uppercase">Suggested from what you&apos;ve decided · not decided</p>
          {ctx.canEdit && <button type="button" className="btn min-h-9 self-start text-xs" disabled={s.pending} onClick={() => save(suggested)}>Use this</button>}
        </div>
      ) : (
        <p className="text-sm text-muted">Once you&apos;ve chosen where and when, a sentence appears here for you to keep or rewrite.</p>
      )}
      <Status msg={s.msg} />
    </section>
  );
}

// ---------------------------------------------------------------------------
export function WorldCards({ projectId, world, canEdit, locations }: {
  projectId: string; world: World; canEdit: boolean; locations: { id: string; name: string }[];
}) {
  const ctx: Ctx = { projectId, version: world.version, canEdit };
  const [editing, setEditing] = useState<Section | null>(null);
  const c = world.confirmed, p = world.proposals;

  const where = c.where?.value;
  const when = c.when?.value;
  const span = c.span?.value;
  const calc = calculateSpan(when);
  const conflict = spanConflict(span, calc);
  // Empty cards open straight into their editor: no extra click to start.
  const isOpen = (sec: Section, has: boolean) => canEdit && (editing === sec || (!has && !p[sec]));
  const close = () => setEditing(null);
  const cancelFor = (has: boolean) => (has ? close : undefined);

  const whereBig = where ? (where.undecided ? "Not decided" : placesText(where)) : "Not decided";
  const whereSmall = where && !where.undecided ? (where.note || (where.places.length > 1 ? `${where.places.length} places` : KIND_LABEL[where.places[0]?.kind ?? "unknown"])) : "";
  const whenBig = when ? (when.undecided ? "Not decided" : periodsText(when)) : "Not decided";
  const whenSmall = when && !when.undecided ? (when.note || (when.periods.length === 1 ? PRECISION_LABEL[when.periods[0].precision] : `${when.periods.length} story periods`)) : "";
  const spanBig = span && span.basis === "creator" ? span.text : calc ? calc.text : "Not decided";
  const spanSmall = span && span.basis === "creator"
    ? (span.unusual ? "Time passes differently for some" : calc ? `Your dates: ${calc.text} (calculated)` : "")
    : calc ? "Calculated from your dates" : "";

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card title="Where" big={whereBig} small={whereSmall} source={c.where ? SOURCE_LABEL[c.where.source] : undefined}
          editing={isOpen("where", !!where)} onEdit={() => setEditing("where")} canEdit={canEdit} prompt={!where ? "Where do you imagine your story happening?" : undefined}>
          {isOpen("where", !!where) && <WhereEditor ctx={ctx} initial={where} locations={locations} onDone={close} onCancel={cancelFor(!!where)} />}
          {!isOpen("where", !!where) && p.where && <Suggestion ctx={ctx} section="where" label={placesText(p.where.value as WhereValue) || "Not decided"} source={p.where.source} why={p.where.why} />}
        </Card>
        <Card title="When" big={whenBig} small={whenSmall} source={c.when ? SOURCE_LABEL[c.when.source] : undefined}
          editing={isOpen("when", !!when)} onEdit={() => setEditing("when")} canEdit={canEdit} prompt={!when ? "When does it happen? A year, an era, \u201ca long time from now\u201d…" : undefined}>
          {isOpen("when", !!when) && <WhenEditor ctx={ctx} initial={when} onDone={close} onCancel={cancelFor(!!when)} />}
          {!isOpen("when", !!when) && p.when && <Suggestion ctx={ctx} section="when" label={periodsText(p.when.value as WhenValue) || "Not decided"} source={p.when.source} why={p.when.why} />}
        </Card>
        <Card title="Time span" big={spanBig} small={spanSmall} source={c.span ? SOURCE_LABEL[c.span.source] : undefined} flag={conflict}
          editing={isOpen("span", !!span || !!calc)} onEdit={() => setEditing("span")} canEdit={canEdit} prompt={!span && !calc ? "How much time passes, from the first event to the last?" : undefined}>
          {isOpen("span", !!span || !!calc) && <SpanEditor ctx={ctx} initial={span} calcText={calc?.text ?? null} onDone={close} onCancel={cancelFor(!!span || !!calc)} />}
          {!isOpen("span", !!span || !!calc) && p.span && <Suggestion ctx={ctx} section="span" label={(p.span.value as SpanValue).text || "Not decided"} source={p.span.source} why={p.span.why} />}
          {!isOpen("span", !!span || !!calc) && (
            <>
              {p.coverage && <Suggestion ctx={ctx} section="coverage" label={COVERAGE_LABEL[p.coverage.value as Coverage]} source={p.coverage.source} why={p.coverage.why} />}
              {(when && !when.undecided && when.periods.length > 1) || c.coverage || span ? <CoverageChoice ctx={ctx} value={c.coverage?.value} /> : null}
            </>
          )}
        </Card>
      </div>
      <SentenceCard key={`${world.version}`} ctx={ctx} world={world} />
    </div>
  );
}
