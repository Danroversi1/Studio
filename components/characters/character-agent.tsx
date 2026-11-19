"use client";
// A character's agent: her confirmed facts, the partner's proposed interpretations (never
// facts until she accepts), the research the character could draw on, and what the
// character actually knows. Editable any time; nothing is required before use.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { decideCharacterProposal, saveCharacterProfile, talkAboutCharacter } from "@/app/projects/[projectId]/character-actions";
import { FIELDS, FIELD_LABEL, type CharacterProfile, type FieldKey } from "@/lib/characters/fields";
import { PURPOSE_LABEL, TEMPORAL_LABEL, type Purpose, type Temporal } from "@/lib/knowledge/eligibility";

export function CharacterAgent({ projectId, entityId, name, canEdit, aiReady, profile, links, turns }: {
  projectId: string; entityId: string; name: string; canEdit: boolean; aiReady: boolean; profile: CharacterProfile;
  links: { id: string; purpose: string; temporal: string; scope: string[]; collection: string }[];
  turns: { id: string; at: string; message: string; reply: string; failed: boolean }[];
}) {
  const router = useRouter();
  const [vals, setVals] = useState<Record<string, string>>(profile.confirmed as Record<string, string>);
  const [version, setVersion] = useState(profile.version);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [ask, setAsk] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const dirty = FIELDS.some((f) => (vals[f.key] ?? "") !== ((profile.confirmed as Record<string, string>)[f.key] ?? ""));

  function run(fn: () => Promise<{ ok: boolean; error?: string; version?: number; conflict?: boolean }>, okText: string, after?: () => void) {
    setMsg(null);
    start(async () => {
      type Out = { ok: boolean; error?: string; version?: number };
      const r: Out = await fn().catch((): Out => ({ ok: false, error: "That didn't save. Check your connection and try again." }));
      if (r.ok) { if (typeof r.version === "number") setVersion(r.version); setMsg({ kind: "ok", text: okText }); after?.(); router.refresh(); }
      else setMsg({ kind: "error", text: r.error ?? "That didn't save." });
    });
  }
  const field = (key: FieldKey, hint: string, label: string) => (
    <label key={key} className="flex flex-col gap-1 text-xs text-muted">
      <span><span className="font-medium text-text">{label}</span> · {hint}</span>
      <textarea className="field min-h-14 text-sm text-text" value={vals[key] ?? ""} maxLength={4000} readOnly={!canEdit}
        onChange={(e) => setVals({ ...vals, [key]: e.target.value })} rows={Math.min(8, Math.max(2, Math.ceil((vals[key] ?? "").length / 70) + 1))} />
    </label>
  );

  return (
    <section className="panel flex flex-col gap-4 p-5" aria-labelledby="agent-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="agent-h" className="text-lg font-medium">{name}&apos;s character agent</h3>
        <p className="text-xs text-muted">Used when Studio proposes dialogue. Fill in what you know; leave the rest.</p>
      </div>

      {canEdit && aiReady && (
        <div className="flex flex-col gap-2 border border-line bg-panel-2 p-3">
          <p className="text-sm font-medium">Talk it through</p>
          {turns.length > 0 && (
            <ol className="flex max-h-72 flex-col gap-2 overflow-y-auto text-sm">
              {turns.map((t) => (
                <li key={t.id} className="flex flex-col gap-1">
                  {t.message && <p className="self-end bg-panel px-2 py-1"><span className="text-xs text-muted">You: </span>{t.message}</p>}
                  {t.reply ? <p className="whitespace-pre-wrap">{t.reply}</p> : t.failed ? <p className="text-xs text-danger">That turn didn&apos;t go through.</p> : null}
                </li>
              ))}
            </ol>
          )}
          <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); run(() => talkAboutCharacter({ projectId, entityId, message: ask }), "Answered.", () => setAsk("")); }}>
            <textarea className="field min-h-14 text-sm" value={ask} maxLength={4000} onChange={(e) => setAsk(e.target.value)}
              placeholder={turns.length ? "Answer, or ask something else…" : `Tell the partner something about ${name}, or ask "what don't I know yet?"`} />
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn-primary min-h-9 text-xs" disabled={pending}>{pending ? "Thinking…" : "Send"}</button>
              <span className="text-[11px] text-muted">Cloud model (Anthropic Claude). It can suggest; only you decide.</span>
            </div>
          </form>
        </div>
      )}

      {profile.proposed.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-semibold tracking-[0.1em] text-warn uppercase">Proposed interpretations · not part of {name} until you accept</p>
          <ul className="flex flex-col gap-2">
            {profile.proposed.map((p) => (
              <li key={p.id} className="flex flex-col gap-1.5 border border-warn/50 bg-warn-soft/40 p-2 text-sm">
                <span className="text-xs text-muted">{FIELD_LABEL[p.field] ?? p.field}{p.why ? ` · ${p.why}` : ""}</span>
                {canEdit ? <textarea className="field min-h-12 text-sm" value={edits[p.id] ?? p.text} maxLength={1000} onChange={(e) => setEdits({ ...edits, [p.id]: e.target.value })} aria-label="Proposed text" />
                  : <p>{p.text}</p>}
                {canEdit && (
                  <span className="flex gap-2">
                    <button type="button" className="btn min-h-8 text-xs" disabled={pending || dirty} title={dirty ? "Save your edits first" : undefined}
                      onClick={() => run(() => decideCharacterProposal({ projectId, entityId, proposalId: p.id, accept: true, text: edits[p.id] }), `Added to ${FIELD_LABEL[p.field]}.`,
                        () => setVals((v) => ({ ...v, [p.field]: v[p.field] ? `${v[p.field]}\n${edits[p.id] ?? p.text}` : (edits[p.id] ?? p.text) })))}>Accept</button>
                    <button type="button" className="btn min-h-8 text-xs" disabled={pending} onClick={() => run(() => decideCharacterProposal({ projectId, entityId, proposalId: p.id, accept: false }), "Dismissed.")}>Dismiss</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); run(() => saveCharacterProfile({ projectId, entityId, baseVersion: version, confirmed: vals }), "Saved."); }}>
        <details open={Object.keys(profile.confirmed).length > 0}>
          <summary className="cursor-pointer list-none text-[11px] font-semibold tracking-[0.1em] uppercase">Confirmed facts · who {name} is</summary>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">{FIELDS.filter((f) => f.group === "who").map((f) => field(f.key, f.hint, f.label))}</div>
        </details>
        <details open={!!(vals.knows || vals.misbeliefs || vals.conceals)}>
          <summary className="cursor-pointer list-none text-[11px] font-semibold tracking-[0.1em] uppercase">What {name} actually knows</summary>
          <p className="mt-2 text-xs text-muted">This is knowledge {name} has in the story. Research connected below is only what they could draw on.</p>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">{FIELDS.filter((f) => f.group === "knows").map((f) => field(f.key, f.hint, f.label))}</div>
        </details>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-primary min-h-9 text-xs" disabled={pending || !dirty}>{pending ? "Saving…" : "Save facts"}</button>
            {dirty && <span className="text-xs text-accent">Unsaved changes</span>}
            {version > 0 && <span className="text-xs text-muted">Version {version}</span>}
          </div>
        )}
      </form>

      <div className="flex flex-col gap-1.5">
        <p className="text-[11px] font-semibold tracking-[0.1em] uppercase">Research {name} could draw on</p>
        {links.length ? (
          <ul className="flex flex-col gap-1 text-sm">
            {links.map((l) => (
              <li key={l.id}><b>{l.collection}</b> <span className="text-muted">· {PURPOSE_LABEL[l.purpose as Purpose]} · {TEMPORAL_LABEL[l.temporal as Temporal].split(":")[0]}{l.scope.length ? ` · only about ${l.scope.join(", ")}` : ""}</span></li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">None connected.</p>}
        <Link href={`/projects/${projectId}/connections`} className="text-xs text-accent">Connect research on the Connections desk →</Link>
      </div>
      {msg && <p role={msg.kind === "error" ? "alert" : "status"} className={`text-xs ${msg.kind === "error" ? "text-danger" : "text-muted"}`}>{msg.text}</p>}
    </section>
  );
}
