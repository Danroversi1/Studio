"use client";
// Her rules, written by hand, in plain language. One list/editor used in three places:
//  - World & Time → What's happening: "How the world works" (the periphery; no feelings)
//  - each main character's page: how their feelings react to what reaches them
//  - World & Time → the world, day by day: pressure from the world and story consequences
// Changes are versioned and apply from the next story day; past days keep the rules they used.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { simRemoveRule, simSaveRule } from "@/app/projects/[projectId]/sim-actions";
import { FAMILY_HINT, FAMILY_LABEL, feelWords, ruleSentence, type Family, type SimRule } from "@/lib/sim/rules";

type Res = { ok: true; note?: string } | { ok: false; error: string };
type Msg = { kind: "ok" | "error"; text: string } | null;
function useRun() {
  const router = useRouter();
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  function run(fn: () => Promise<Res>, after?: () => void) {
    setMsg(null);
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { kind: "ok", text: r.note ?? "Saved." } : { kind: "error", text: r.error });
      if (r.ok) { after?.(); router.refresh(); }
    });
  }
  return { run, pending, msg };
}

const EXAMPLES: Record<Family, { when_text: string; stress: number; happiness: number; tend_text: string; relief_text: string }> = {
  character: { when_text: "news about AI breakthroughs reaches him", stress: 1, happiness: 1, tend_text: "dig into the details late at night", relief_text: "talking it through with Marie" },
  world: { when_text: "the news is full of conflict between powerful countries", stress: 1, happiness: -1, tend_text: "", relief_text: "time with people they trust" },
  story: { when_text: "someone shares a secret with a character", stress: 1, happiness: 0, tend_text: "act on it, or hide it, depending on what they want", relief_text: "" },
  periphery: { when_text: "a big tech story breaks in San Francisco", stress: 0, happiness: 0, tend_text: "it reaches Washington by the next morning and officials respond within days", relief_text: "" },
};
const STEP_LABEL: Record<string, Record<number, string>> = {
  stress: { [-2]: "much calmer", [-1]: "calmer", 0: "—", 1: "more stressed", 2: "much more stressed" },
  happiness: { [-2]: "much sadder", [-1]: "sadder", 0: "—", 1: "happier", 2: "much happier" },
};
const BADGE = "border px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] uppercase";

export function RuleList({ projectId, canEdit, rules, families, characters, fixedCharacter, title, intro, empty, addLabel = "Add a rule" }: {
  projectId: string; canEdit: boolean; rules: SimRule[]; families: Family[]; characters: { id: string; name: string }[];
  fixedCharacter?: { id: string; name: string }; title: string; intro: React.ReactNode; empty: string; addLabel?: string;
}) {
  const s = useRun();
  const [editing, setEditing] = useState<SimRule | "new" | null>(null);
  const nameOf = (id: string | null) => (id ? characters.find((c) => c.id === id)?.name ?? fixedCharacter?.name ?? null : null);
  const list = rules.filter((r) => families.includes(r.family) && (!fixedCharacter || r.character_id === fixedCharacter.id));
  return (
    <section className="panel flex flex-col gap-3 p-4" aria-label={title}>
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-medium">{title}</h3>
        <p className="text-xs text-muted">{intro}</p>
      </div>
      <ul className="flex flex-col divide-y divide-line border-y border-line">
        {list.map((r) => (
          <li key={r.id} className="flex flex-wrap items-start gap-2 py-2 text-sm">
            {families.length > 1 && <span className={`${BADGE} ${r.enabled ? "border-ok text-ok" : "border-line text-muted"}`}>{FAMILY_LABEL[r.family]}</span>}
            <p className={`min-w-0 flex-1 ${r.enabled ? "" : "text-muted line-through"}`}>{ruleSentence(r, nameOf(r.character_id))}</p>
            {canEdit && (
              <span className="flex gap-2 text-xs">
                <button type="button" className="text-accent underline" disabled={s.pending}
                  onClick={() => s.run(() => simSaveRule({ projectId, ruleId: r.id, data: { ...r, enabled: !r.enabled } }))}>{r.enabled ? "Turn off" : "Turn on"}</button>
                <button type="button" className="text-accent underline" onClick={() => setEditing(r)}>Edit</button>
                <button type="button" className="text-muted underline hover:text-danger" disabled={s.pending} onClick={() => s.run(() => simRemoveRule({ projectId, ruleId: r.id }))}>Remove</button>
              </span>
            )}
          </li>
        ))}
        {!list.length && <li className="py-2 text-sm text-muted">{empty}</li>}
      </ul>
      {canEdit && (editing
        ? <RuleEditor key={editing === "new" ? "new" : editing.id} projectId={projectId} families={families} characters={characters} fixedCharacter={fixedCharacter}
            rule={editing === "new" ? null : editing} onDone={() => setEditing(null)} />
        : <button type="button" className="btn min-h-9 self-start text-xs" onClick={() => setEditing("new")}>{addLabel}</button>)}
      {s.msg && <p role={s.msg.kind === "error" ? "alert" : "status"} className={`text-xs ${s.msg.kind === "error" ? "text-danger" : "text-muted"}`}>{s.msg.text}</p>}
    </section>
  );
}

function RuleEditor({ projectId, families, characters, fixedCharacter, rule, onDone }: {
  projectId: string; families: Family[]; characters: { id: string; name: string }[]; fixedCharacter?: { id: string; name: string }; rule: SimRule | null; onDone: () => void;
}) {
  const s = useRun();
  const [r, setR] = useState({ family: rule?.family ?? families[0], character_id: rule?.character_id ?? fixedCharacter?.id ?? characters[0]?.id ?? "", when_text: rule?.when_text ?? "",
    stress: rule?.stress ?? 0, happiness: rule?.happiness ?? 0, tend_text: rule?.tend_text ?? "", relief_text: rule?.relief_text ?? "", enabled: rule?.enabled ?? true });
  const world = r.family === "periphery";
  const who = r.family === "character" ? (fixedCharacter?.name ?? characters.find((c) => c.id === r.character_id)?.name ?? null) : null;
  return (
    <form className="flex flex-col gap-2 border border-line bg-panel-2 p-3 text-sm" onSubmit={(e) => {
      e.preventDefault();
      s.run(() => simSaveRule({ projectId, ruleId: rule?.id ?? null, data: { ...r, character_id: r.family === "character" ? r.character_id : null } }), onDone);
    }}>
      {(families.length > 1 || (r.family === "character" && !fixedCharacter)) && (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Kind of rule">
          {families.length > 1 && families.map((f) => (
            <button key={f} type="button" aria-pressed={r.family === f} title={FAMILY_HINT[f]} onClick={() => setR({ ...r, family: f })}
              className={`border px-2 py-1 text-xs ${r.family === f ? "border-text bg-text text-panel-2" : "border-line hover:border-text"}`}>{FAMILY_LABEL[f]}</button>
          ))}
          {r.family === "character" && !fixedCharacter && (
            <select className="field min-h-8 w-auto text-xs" value={r.character_id} onChange={(e) => setR({ ...r, character_id: e.target.value })} aria-label="Character">
              {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </div>
      )}
      {families.length > 1 && <p className="text-[11px] text-muted">{FAMILY_HINT[r.family]}</p>}
      <label className="flex flex-col gap-1"><span className="font-medium">When…</span>
        <input className="field" value={r.when_text} maxLength={300} required onChange={(e) => setR({ ...r, when_text: e.target.value })}
          placeholder={world ? "e.g. a big tech story breaks in San Francisco" : r.family === "character" ? "e.g. news about AI breakthroughs reaches him" : "e.g. he encounters evidence he cannot explain"} /></label>
      {world ? (
        <label className="flex flex-col gap-1"><span className="font-medium">Then, in the world…</span>
          <input className="field" value={r.tend_text} maxLength={300} required onChange={(e) => setR({ ...r, tend_text: e.target.value })} placeholder="e.g. it reaches Washington by the next morning" /></label>
      ) : (
        <>
          <div className="flex flex-col gap-1"><span className="font-medium">{who ? `${who} feels…` : "They feel…"}</span>
            {(["stress", "happiness"] as const).map((axis) => (
              <div key={axis} className="flex flex-wrap gap-1" role="group" aria-label={axis}>
                {[-2, -1, 0, 1, 2].map((v) => (
                  <button key={v} type="button" aria-pressed={r[axis] === v} onClick={() => setR({ ...r, [axis]: v })}
                    className={`border px-2 py-0.5 text-xs ${r[axis] === v ? "border-text bg-text text-panel-2" : "border-line hover:border-text"}`}>{STEP_LABEL[axis][v]}</button>
                ))}
              </div>
            ))}
          </div>
          <label className="flex flex-col gap-1"><span className="font-medium">{who ? `${who} tends to…` : "They tend to…"} <span className="font-normal text-muted">(optional)</span></span>
            <input className="field" value={r.tend_text} maxLength={300} onChange={(e) => setR({ ...r, tend_text: e.target.value })} placeholder="e.g. investigate" /></label>
          <label className="flex flex-col gap-1"><span className="font-medium">Relief comes from… <span className="font-normal text-muted">(optional)</span></span>
            <input className="field" value={r.relief_text} maxLength={300} onChange={(e) => setR({ ...r, relief_text: e.target.value })} placeholder="e.g. talking with his mentor" /></label>
        </>
      )}
      {r.when_text.trim().length > 1 && <p className="border-l-2 border-accent pl-2 text-sm">{ruleSentence(r, who)}</p>}
      <p className="text-[11px] text-muted">
        <button type="button" className="mr-2 text-accent underline" onClick={() => setR({ ...r, ...EXAMPLES[r.family] })}>Fill in an example</button>
        (not added unless you save){!world && <> · Feelings: {feelWords(r.stress, r.happiness)}.</>}
      </p>
      <div className="flex gap-2"><button className="btn-primary min-h-9 text-xs" disabled={s.pending}>{rule ? "Save rule" : "Add rule"}</button><button type="button" className="btn min-h-9 text-xs" onClick={onDone}>Cancel</button></div>
      {s.msg && <p role={s.msg.kind === "error" ? "alert" : "status"} className={`text-xs ${s.msg.kind === "error" ? "text-danger" : "text-muted"}`}>{s.msg.text}</p>}
    </form>
  );
}
