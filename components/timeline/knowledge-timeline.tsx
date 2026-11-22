"use client";
// The Director's Knowledge Timeline: the current world day, how far each character can see,
// the gaps the protagonist closes by investigation, and the predictions, interventions and
// changed outcomes that follow. No model; every rule is checked by the database.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { tlAddDiscovery, tlAddIntervention, tlAddPrediction, tlBrief, tlOutcome, tlReassess, tlResolvePrediction, tlSetAccess, tlSetAnchor } from "@/app/projects/[projectId]/timeline-actions";
import { METHODS, METHOD_LABEL, PROTAGONIST_LABEL, dayLabel } from "@/lib/knowledge/timeline";
import type { Timeline, TlItem } from "@/lib/knowledge/timeline-data";
import { ROLE_LABEL } from "@/lib/characters/roles";

type Res = { ok: true } | { ok: false; error: string };

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (f: () => Promise<Res>, done: string, after?: () => void) => start(async () => {
    const r = await f().catch(() => ({ ok: false as const, error: "That didn't go through. Try again." }));
    setMsg(r.ok ? { ok: true, text: done } : { ok: false, text: r.error });
    if (r.ok) { after?.(); router.refresh(); }
  });
  const line = msg && <p role="status" className={`text-xs ${msg.ok ? "text-muted" : "text-danger"}`}>{msg.text}</p>;
  return { run, pending, line };
}

const toggle = (xs: string[], x: string) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);
const itemLabel = (i: TlItem) => `Day ${i.day} · ${i.title.length > 90 ? `${i.title.slice(0, 89)}…` : i.title} (${i.source})`;

function Picks({ items, chosen, onChange, empty }: { items: { id: string; label: string }[]; chosen: string[]; onChange: (x: string[]) => void; empty: string }) {
  if (!items.length) return <p className="text-xs text-muted">{empty}</p>;
  return (
    <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto border border-line p-2 text-xs">
      {items.map((i) => (
        <li key={i.id}><label className="flex gap-2"><input type="checkbox" checked={chosen.includes(i.id)} onChange={() => onChange(toggle(chosen, i.id))} />{i.label}</label></li>
      ))}
    </ul>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1 border border-line p-3">
      <span className="eyebrow">{label}</span>
      <span className="display text-xl leading-tight">{value}</span>
      {sub && <span className="text-xs text-muted">{sub}</span>}
    </div>
  );
}

export function KnowledgeTimeline({ projectId, canEdit, tl, buffers }: { projectId: string; canEdit: boolean; tl: Timeline; buffers: Record<string, TlItem[]> }) {
  const a = useAct();
  const ahead = tl.characters.filter((c) => c.role === "antagonist");
  const leads = tl.characters.filter((c) => c.role === "protagonist");
  const others = tl.characters.filter((c) => c.role === "supporting" || c.role === "featured");
  const nameOf = (id: string | null) => (id ? tl.characters.find((c) => c.id === id)?.name ?? "Someone" : "Updated briefing");
  const [anchor, setAnchor] = useState(tl.anchor);
  const enabled = ahead.filter((c) => c.tier === "ahead");
  return (
    <section id="timeline" className="panel flex scroll-mt-6 flex-col gap-4 p-5" aria-labelledby="tl-h">
      <div className="flex flex-col gap-1">
        <h2 id="tl-h" className="display text-2xl leading-none">Knowledge Timeline</h2>
        <p className="max-w-3xl text-sm text-muted">
          The world&apos;s collected material runs ahead of the story. Only an antagonist you allow can see ahead. The protagonist&apos;s routine news stays one story day behind;
          he catches up by observing, asking, researching and seeing patterns. Supporting and featured characters live in the present.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Current world day" value={`Day ${tl.worldDay}`} sub={`The world as of ${tl.worldDate}`} />
        <Tile label="Antagonist sees through" value={enabled.length ? enabled.map((c) => `${c.name}: Day ${Math.min(c.reach, Math.max(tl.worldDay, tl.collectedThrough))}`).join(" · ") : "Nobody ahead"}
          sub={enabled.length ? enabled.map((c) => `${c.access!.ahead_days} days allowed`).join(" · ") : ahead.length ? "Future access is off" : "No antagonist yet"} />
        <Tile label="Protagonist's routine knowledge" value={leads.length ? leads.map((c) => `${c.name}: ${c.reach <= 0 ? "backstory" : `Day ${c.reach}`}`).join(" · ") : "No protagonist yet"} sub="One day behind. Discoveries can close the gap." />
        <Tile label="Collected buffer" value={tl.collectedThrough > tl.worldDay ? `Through Day ${tl.collectedThrough}` : "None ahead yet"} sub={`${tl.buffer.length} item${tl.buffer.length === 1 ? "" : "s"} after Day ${tl.worldDay}`} />
      </div>

      <div className="flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Day 1 is the world as of</span>
          <input type="date" className="field min-h-9 w-44" value={anchor} max={new Date().toISOString().slice(0, 10)} disabled={!canEdit || tl.anchorLocked} onChange={(e) => setAnchor(e.target.value)} />
        </label>
        {canEdit && !tl.anchorLocked && anchor !== tl.anchor && <button type="button" className="btn" disabled={a.pending} onClick={() => a.run(() => tlSetAnchor({ projectId, date: anchor }), "Day 1 set.")}>Set Day 1</button>}
        <span className="text-xs text-muted">{tl.anchorLocked ? "Fixed once a story day has been closed." : tl.anchorSet ? "Your choice." : "Starts on the day the film's coverage began. An earlier date leaves more of the world ahead of the story."}</span>
      </div>
      {a.line}

      <div className="flex flex-col gap-2">
        <h3 className="font-medium">Who can know what</h3>
        <ul className="flex flex-col gap-2 text-sm">
          {[...ahead, ...leads, ...others].map((c) => (
            <li key={c.id} className="flex flex-col gap-1 border-b border-line pb-2">
              <span><b>{c.name}</b> <span className="text-xs text-muted">{c.role ? ROLE_LABEL[c.role] : ""}</span></span>
              <span className="text-xs text-muted">{c.label}</span>
              {c.role === "antagonist" && canEdit && <AccessControl projectId={projectId} id={c.id} name={c.name} enabled={c.tier === "ahead"} ahead={c.access?.ahead_days ?? 4} />}
            </li>
          ))}
          {!ahead.length && !leads.length && <li className="text-xs text-muted">Choose a protagonist and an antagonist on the character pages.</li>}
        </ul>
      </div>

      {leads.map((c) => <Investigation key={c.id} projectId={projectId} canEdit={canEdit} tl={tl} id={c.id} name={c.name} />)}

      <ChangedOutcomes projectId={projectId} canEdit={canEdit} tl={tl} nameOf={nameOf} />

      <Briefings projectId={projectId} canEdit={canEdit} tl={tl} buffers={buffers} nameOf={nameOf} />
    </section>
  );
}

function AccessControl({ projectId, id, name, enabled, ahead }: { projectId: string; id: string; name: string; enabled: boolean; ahead: number }) {
  const a = useAct();
  const [days, setDays] = useState(ahead);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <label className="flex items-center gap-2"><input type="checkbox" checked={enabled} disabled={a.pending}
        onChange={(e) => a.run(() => tlSetAccess({ projectId, characterId: id, enabled: e.target.checked, ahead: days }), e.target.checked ? `${name} can see ahead.` : `${name}'s future access is off.`)} />
        Let {name} see ahead</label>
      <label className="flex items-center gap-1">by
        <select className="field min-h-7 w-auto text-xs" value={days} disabled={a.pending}
          onChange={(e) => { const d = Number(e.target.value); setDays(d); if (enabled) a.run(() => tlSetAccess({ projectId, characterId: id, enabled: true, ahead: d }), "Saved."); }}>
          {Array.from({ length: 14 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d} day{d === 1 ? "" : "s"}</option>)}
        </select>
      </label>
      {a.line}
    </div>
  );
}

function Investigation({ projectId, canEdit, tl, id, name }: { projectId: string; canEdit: boolean; tl: Timeline; id: string; name: string }) {
  const me = tl.characters.find((c) => c.id === id)!;
  const disc = tl.discoveries.filter((d) => d.character_id === id);
  const preds = tl.predictions.filter((p) => p.character_id === id);
  const acts = tl.interventions.filter((i) => i.character_id === id);
  const found = new Set(disc.map((d) => d.item_id).filter(Boolean) as string[]);
  // Gaps he could close: today's developments his feeds haven't reached.
  const gaps = tl.recent.filter((i) => i.day > me.reach && i.day <= tl.worldDay && !found.has(i.id));
  // Evidence he has encountered: yesterday's routine news, and what he discovered.
  const seen = tl.recent.filter((i) => i.day <= me.reach || found.has(i.id));
  const d = useAct(), p = useAct(), v = useAct();
  const [m, setM] = useState<string>("observation"); const [what, setWhat] = useState(""); const [how, setHow] = useState(""); const [item, setItem] = useState("");
  const [pt, setPt] = useState(""); const [pd, setPd] = useState<string[]>([]); const [pi, setPi] = useState<string[]>([]);
  const [act, setAct] = useState(""); const [exp, setExp] = useState(""); const [vp, setVp] = useState(""); const [vd, setVd] = useState<string[]>([]); const [vi, setVi] = useState<string[]>([]);
  return (
    <div className="flex flex-col gap-4 border border-line p-4">
      <div className="flex flex-col gap-1">
        <h3 className="font-medium">{name}: closing the gap</h3>
        <p className="text-sm"><b>{PROTAGONIST_LABEL}</b></p>
        <p className="text-xs text-muted">His routine news reaches {dayLabel(me.reach)}; the world is on Day {tl.worldDay}. What he finds out stays found out. His predictions come only from evidence he has encountered; he never sees the buffer.</p>
      </div>

      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-medium">Gaps {name} has closed ({disc.length})</h4>
        {disc.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {disc.map((x) => <li key={x.id}>Day {x.day} · <span className="text-muted">{METHOD_LABEL[x.method]}</span> · {x.what}{x.how && <span className="text-xs text-muted"> — {x.how}</span>}{x.item_day !== null && <span className="text-xs text-muted"> (closes a {dayLabel(x.item_day)} gap)</span>}</li>)}
          </ul>
        )}
        {canEdit && (
          <div className="flex flex-col gap-2 border-t border-line pt-2">
            <div className="flex flex-wrap gap-2">
              <select className="field min-h-9 w-auto text-sm" value={m} onChange={(e) => setM(e.target.value)} aria-label="How he found out">
                {METHODS.map((k) => <option key={k} value={k}>{METHOD_LABEL[k]}</option>)}
              </select>
              <input className="field min-h-9 flex-1 text-sm" placeholder={`What ${name} found out`} value={what} onChange={(e) => setWhat(e.target.value)} maxLength={600} />
            </div>
            <input className="field min-h-9 text-sm" placeholder="How (optional): who told him, what he examined, which pattern" value={how} onChange={(e) => setHow(e.target.value)} maxLength={600} />
            <select className="field min-h-9 text-sm" value={item} onChange={(e) => setItem(e.target.value)} aria-label="Which development it closes">
              <option value="">Not tied to a specific news item</option>
              {gaps.map((i) => <option key={i.id} value={i.id}>{itemLabel(i)}</option>)}
            </select>
            <span><button type="button" className="btn" disabled={d.pending || what.trim().length < 3}
              onClick={() => d.run(() => tlAddDiscovery({ projectId, characterId: id, method: m, what, how, itemId: item || null }), "Discovery recorded.", () => { setWhat(""); setHow(""); setItem(""); })}>Record discovery</button></span>
            {d.line}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-medium">{name}&apos;s predictions ({preds.length})</h4>
        {preds.map((x) => <Prediction key={x.id} projectId={projectId} canEdit={canEdit} x={x} />)}
        {canEdit && (
          <div className="flex flex-col gap-2 border-t border-line pt-2">
            <input className="field min-h-9 text-sm" placeholder={`What ${name} expects will happen`} value={pt} onChange={(e) => setPt(e.target.value)} maxLength={600} />
            <span className="text-xs text-muted">Evidence he has encountered (at least one):</span>
            <Picks items={disc.map((x) => ({ id: x.id, label: `Discovery: ${x.what}` }))} chosen={pd} onChange={setPd} empty="No discoveries yet." />
            <Picks items={seen.map((i) => ({ id: i.id, label: itemLabel(i) }))} chosen={pi} onChange={setPi} empty="No recent news within his reach." />
            <span><button type="button" className="btn" disabled={p.pending || pt.trim().length < 3 || !(pd.length + pi.length)}
              onClick={() => p.run(() => tlAddPrediction({ projectId, characterId: id, prediction: pt, discoveryIds: pd, itemIds: pi }), "Prediction recorded.", () => { setPt(""); setPd([]); setPi([]); })}>Record prediction</button></span>
            {p.line}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-medium">What {name} did about it ({acts.length})</h4>
        {acts.map((x) => <Intervention key={x.id} projectId={projectId} canEdit={canEdit} tl={tl} x={x} />)}
        {canEdit && (
          <div className="flex flex-col gap-2 border-t border-line pt-2">
            <input className="field min-h-9 text-sm" placeholder={`What ${name} does`} value={act} onChange={(e) => setAct(e.target.value)} maxLength={600} />
            <input className="field min-h-9 text-sm" placeholder="What it might change (optional)" value={exp} onChange={(e) => setExp(e.target.value)} maxLength={600} />
            <select className="field min-h-9 text-sm" value={vp} onChange={(e) => setVp(e.target.value)} aria-label="Acting on which prediction">
              <option value="">Not acting on a recorded prediction</option>
              {preds.map((x) => <option key={x.id} value={x.id}>{x.prediction}</option>)}
            </select>
            <Picks items={disc.map((x) => ({ id: x.id, label: `Discovery: ${x.what}` }))} chosen={vd} onChange={setVd} empty="No discoveries to link." />
            <span className="text-xs text-muted">Developments still ahead that this may change (they&apos;re flagged for reassessment; the original stays on record):</span>
            <Picks items={tl.buffer.map((i) => ({ id: i.id, label: itemLabel(i) }))} chosen={vi} onChange={setVi} empty="Nothing collected ahead of today." />
            <span><button type="button" className="btn" disabled={v.pending || act.trim().length < 3}
              onClick={() => v.run(() => tlAddIntervention({ projectId, characterId: id, action: act, expected: exp, predictionId: vp || null, discoveryIds: vd, itemIds: vi }), vi.length ? "Recorded. The developments it may change are flagged below." : "Intervention recorded.", () => { setAct(""); setExp(""); setVp(""); setVd([]); setVi([]); })}>Record intervention</button></span>
            {v.line}
          </div>
        )}
      </div>
    </div>
  );
}

const STATUS: Record<string, string> = { open: "Open", borne_out: "Borne out", wrong: "Wrong", changed: "Changed by an intervention" };

function Prediction({ projectId, canEdit, x }: { projectId: string; canEdit: boolean; x: Timeline["predictions"][number] }) {
  const a = useAct();
  const [note, setNote] = useState(x.outcome_note ?? "");
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span>Day {x.day} · {x.prediction} <span className="text-xs text-muted">· {STATUS[x.status]}{x.outcome_note ? ` — ${x.outcome_note}` : ""}</span></span>
      {canEdit && (
        <div className="flex flex-wrap gap-2 text-xs">
          <input className="field min-h-7 flex-1 text-xs" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={600} />
          {Object.keys(STATUS).filter((k) => k !== x.status).map((k) => (
            <button key={k} type="button" className="btn min-h-7 text-[11px]" disabled={a.pending} onClick={() => a.run(() => tlResolvePrediction({ projectId, predictionId: x.id, status: k, note }), "Saved.")}>{STATUS[k]}</button>
          ))}
        </div>
      )}
      {a.line}
    </div>
  );
}

function Intervention({ projectId, canEdit, tl, x }: { projectId: string; canEdit: boolean; tl: Timeline; x: Timeline["interventions"][number] }) {
  const a = useAct();
  const [out, setOut] = useState(x.outcome ?? "");
  const flags = tl.flags.filter((f) => f.intervention_id === x.id);
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span>Day {x.day} · {x.action}{x.expected_change && <span className="text-xs text-muted"> — might change: {x.expected_change}</span>}</span>
      {flags.length > 0 && <span className="text-xs text-muted">Flagged: {flags.map((f) => `“${f.original.title}” (Day ${f.original.item_day})`).join(", ")}</span>}
      {x.outcome && <span className="text-xs">What happened: {x.outcome}</span>}
      {canEdit && (
        <div className="flex gap-2">
          <input className="field min-h-7 flex-1 text-xs" placeholder="What happened afterwards" value={out} onChange={(e) => setOut(e.target.value)} maxLength={800} />
          <button type="button" className="btn min-h-7 text-[11px]" disabled={a.pending || out.trim() === (x.outcome ?? "")} onClick={() => a.run(() => tlOutcome({ projectId, interventionId: x.id, outcome: out }), "Saved.")}>Save</button>
        </div>
      )}
      {a.line}
    </div>
  );
}

function ChangedOutcomes({ projectId, canEdit, tl, nameOf }: { projectId: string; canEdit: boolean; tl: Timeline; nameOf: (id: string | null) => string }) {
  if (!tl.flags.length) return null;
  const briefed = new Map<string, string[]>();
  for (const b of tl.briefings.filter((x) => x.kind === "update")) for (const f of b.flag_ids) briefed.set(f, [...(briefed.get(f) ?? []), b.to_character]);
  const antagonists = tl.characters.filter((c) => c.role === "antagonist");
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-medium">Potentially changed outcomes</h3>
      <p className="text-xs text-muted">Buffered developments are the trajectory before anyone intervened. An antagonist keeps seeing the original until you give them an updated briefing; they never learn about the protagonist&apos;s private actions on their own.</p>
      <ul className="flex flex-col gap-3 text-sm">
        {tl.flags.map((f) => <Flag key={f.id} projectId={projectId} canEdit={canEdit} f={f} by={nameOf(tl.interventions.find((i) => i.id === f.intervention_id)?.character_id ?? null)}
          briefedTo={(briefed.get(f.id) ?? []).map((id) => nameOf(id))} antagonists={antagonists.map((c) => ({ id: c.id, name: c.name, told: (briefed.get(f.id) ?? []).includes(c.id) }))} />)}
      </ul>
    </div>
  );
}

function Flag({ projectId, canEdit, f, by, briefedTo, antagonists }: { projectId: string; canEdit: boolean; f: Timeline["flags"][number]; by: string; briefedTo: string[]; antagonists: { id: string; name: string; told: boolean }[] }) {
  const a = useAct();
  const [rev, setRev] = useState(f.revised ?? "");
  return (
    <li className="flex flex-col gap-1 border-b border-line pb-2">
      <span><b>Originally:</b> “{f.original.title}” <span className="text-xs text-muted">(Day {f.original.item_day}; flagged on Day {f.original.flagged_on_day} after {by}&apos;s intervention)</span></span>
      <span className="text-xs text-muted">Known then by: {f.original.known_by.length ? f.original.known_by.join(", ") : "no one"}</span>
      {f.status === "reassessed" ? <span><b>Revised expectation:</b> {f.revised}</span> : <span className="text-xs">Needs reassessment.</span>}
      {briefedTo.length > 0 && <span className="text-xs text-muted">Updated briefing given to {briefedTo.join(", ")}.</span>}
      {canEdit && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input className="field min-h-7 flex-1 text-xs" placeholder="The revised expectation" value={rev} onChange={(e) => setRev(e.target.value)} maxLength={800} />
            <button type="button" className="btn min-h-7 text-[11px]" disabled={a.pending || rev.trim().length < 3 || rev.trim() === (f.revised ?? "")} onClick={() => a.run(() => tlReassess({ projectId, flagId: f.id, revised: rev }), "Reassessed.")}>Reassess</button>
          </div>
          {f.status === "reassessed" && antagonists.filter((x) => !x.told).map((x) => (
            <span key={x.id}><button type="button" className="btn min-h-7 text-[11px]" disabled={a.pending}
              onClick={() => a.run(() => tlBrief({ projectId, fromId: null, toId: x.id, kind: "update", content: `Revised: ${f.revised}`, itemIds: [], flagIds: [f.id] }), `${x.name} now has the updated briefing.`)}>Give {x.name} an updated briefing</button></span>
          ))}
        </div>
      )}
      {a.line}
    </li>
  );
}

function Briefings({ projectId, canEdit, tl, buffers, nameOf }: { projectId: string; canEdit: boolean; tl: Timeline; buffers: Record<string, TlItem[]>; nameOf: (id: string | null) => string }) {
  const a = useAct();
  const from = tl.characters.filter((c) => c.tier === "ahead");
  const [f, setF] = useState(from[0]?.id ?? "");
  const [to, setTo] = useState("");
  const [kind, setKind] = useState("briefing");
  const [content, setContent] = useState("");
  const [items, setItems] = useState<string[]>([]);
  const list = tl.briefings.filter((b) => b.kind !== "update");
  const pool = f ? [...(buffers[f] ?? []), ...tl.recent.filter((i) => i.day <= tl.worldDay)] : [];
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-medium">Briefings</h3>
      <p className="text-xs text-muted">Supporting characters can&apos;t look ahead. An antagonist can pass something on in a recorded interaction; the other character takes it as a claim, warning or briefing and weighs it by their own rules.</p>
      {list.length > 0 && <ul className="flex flex-col gap-1 text-sm">{list.map((b) => <li key={b.id}>Day {b.day} · {nameOf(b.from_character)} → {nameOf(b.to_character)} <span className="text-xs text-muted">({b.kind})</span>: {b.content}</li>)}</ul>}
      {canEdit && from.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-line pt-2">
          <div className="flex flex-wrap gap-2 text-sm">
            <select className="field min-h-9 w-auto" value={f} onChange={(e) => { setF(e.target.value); setItems([]); }} aria-label="From">
              {from.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <span className="self-center">tells</span>
            <select className="field min-h-9 w-auto" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To">
              <option value="">Choose who</option>
              {tl.characters.filter((c) => c.id !== f).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <span className="self-center">a</span>
            <select className="field min-h-9 w-auto" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
              <option value="claim">claim</option><option value="warning">warning</option><option value="briefing">briefing</option>
            </select>
          </div>
          <textarea className="field text-sm" rows={2} placeholder="What they say (in the antagonist's framing)" value={content} onChange={(e) => setContent(e.target.value)} maxLength={1200} />
          <span className="text-xs text-muted">Based on (optional; only what {nameOf(f)} can see):</span>
          <Picks items={pool.map((i) => ({ id: i.id, label: itemLabel(i) }))} chosen={items} onChange={setItems} empty="Nothing in their window yet." />
          <span><button type="button" className="btn" disabled={a.pending || !to || content.trim().length < 3}
            onClick={() => a.run(() => tlBrief({ projectId, fromId: f, toId: to, kind, content, itemIds: items, flagIds: [] }), "Briefing recorded.", () => { setContent(""); setItems([]); })}>Record briefing</button></span>
          {a.line}
        </div>
      )}
      {canEdit && !from.length && <p className="text-xs text-muted">Turn on an antagonist&apos;s future access above to record briefings.</p>}
    </div>
  );
}
