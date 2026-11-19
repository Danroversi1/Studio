"use client";
// World knowledge base: the world outside the story, followed with FREE public sources (no
// model, no tokens; checked once a day) or added by hand, and the characters' impressions
// of it (qualia; the only model use, and only when she asks).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { decideImpression, kbRefreshNow, kbWorldFollow, kbWorldPlan, kbWorldWatchRemove, worldSetUp } from "@/app/projects/[projectId]/knowledge-actions";
import { formImpression } from "@/app/projects/[projectId]/world-kb-actions";
import { ago, feedState } from "@/lib/knowledge/labels";
import { WATCH_LIMIT } from "@/lib/knowledge/watch";
import type { Impression, KCharacter, KCollection, KSource } from "@/lib/knowledge/types";
import type { WatchTopic } from "@/lib/knowledge/plan";

type Res = { ok: true; id?: string; note?: string } | { ok: false; error: string };
function useRun() {
  const router = useRouter();
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Res>, okText?: string, after?: (r: Res & { ok: true }) => void) => {
    setMsg(null);
    start(async () => {
      const r: Res = await fn().catch((): Res => ({ ok: false, error: "That didn't go through. Check your connection and try again." }));
      if (r.ok) { setMsg({ kind: "ok", text: r.note ?? okText ?? "Done." }); after?.(r); router.refresh(); } else setMsg({ kind: "error", text: r.error });
    });
  };
  return { run, msg, pending };
}
const Status = ({ msg }: { msg: { kind: "ok" | "error"; text: string } | null }) =>
  msg ? <p role={msg.kind === "error" ? "alert" : "status"} className={`text-xs ${msg.kind === "error" ? "text-danger" : "text-muted"}`}>{msg.text}</p> : null;

/** The World card at the top of the Knowledge Base. */
/** World view: what it is, who it reaches, and what she follows (free, once a day). */
export function WorldPanel({ projectId, canEdit, characters, world, sources, counts }: {
  projectId: string; canEdit: boolean; characters: KCharacter[]; world: KCollection; sources: KSource[]; counts: Record<string, number>;
}) {
  const s = useRun();
  const [query, setQuery] = useState("");
  const [plan, setPlan] = useState<(WatchTopic & { on: boolean; useNews: boolean; useReactions: boolean })[] | null>(null);
  const [free, setFree] = useState(0);
  const [planErr, setPlanErr] = useState<string | null>(null);
  const [planning, startPlan] = useTransition();
  const connected = characters.filter((c) => c.links.some((l) => l.collection_id === world.id));
  const missing = characters.filter((c) => !c.links.some((l) => l.collection_id === world.id));
  const watches = [...new Set(sources.filter((x) => x.watch_query && x.kind === "feed").map((x) => x.watch_query as string))];
  return (
    <section className="panel flex flex-col gap-4 p-4" aria-labelledby="world-h">
      <div className="flex flex-col gap-1">
        <h2 id="world-h" className="display text-2xl leading-none">The World</h2>
        <p className="max-w-3xl text-sm text-muted">
          What is happening outside your story: news, events and how people react. Your characters live in this world. Their agents draw on it,
          only what exists by each scene&apos;s story date, to form their own impressions of it: what they notice, feel and make of it.
        </p>
        <p className="text-xs text-muted">
          {connected.length ? `Connected to ${connected.map((c) => c.name).join(", ")}.` : "Not connected to any character yet."}
          {missing.length > 0 && ` Not connected: ${missing.map((c) => c.name).join(", ")}.`}
          {canEdit && missing.length > 0 && <> <button type="button" className="text-accent underline" disabled={s.pending} onClick={() => s.run(() => worldSetUp({ projectId, connectAll: true }))}>Connect everyone new</button></>}
          {" "}<Link href={`/projects/${projectId}/connections`} className="text-accent">Change on the Connections desk →</Link>
        </p>
      </div>

      {canEdit && (
        <div className="flex flex-col gap-2 border border-line bg-panel-2 p-3">
          <form className="flex flex-col gap-2" onSubmit={(e) => {
            e.preventDefault(); setPlanErr(null); setPlan(null);
            startPlan(async () => {
              const r = await kbWorldPlan({ projectId, prompt: query }).catch(() => ({ ok: false as const, error: "That didn't work. Try again." }));
              if (!r.ok) { setPlanErr(r.error); return; }
              setFree(r.free);
              setPlan(r.topics.map((t, i) => ({ ...t, on: i < r.free, useNews: !!t.news, useReactions: !!t.reactions })));
            });
          }}>
            <label className="text-sm font-medium" htmlFor="world-q">Tell me what you want me to look for to inform your world.</label>
            <textarea id="world-q" className="field min-h-16" value={query} maxLength={1000} onChange={(e) => setQuery(e.target.value)} required
              placeholder="Topics separated by commas, e.g. AI, semiconductors, the economy, local news for the cities in the story"
              disabled={watches.length >= WATCH_LIMIT} />
            <div className="flex flex-wrap items-center gap-3">
              <button className="btn-primary min-h-10 text-xs" disabled={planning || watches.length >= WATCH_LIMIT}>{planning ? "Reading…" : "Find sources"}</button>
              <span className="text-[11px] text-muted">{watches.length} of {WATCH_LIMIT} topics used.</span>
            </div>
            {planErr && <p role="alert" className="text-xs text-danger">{planErr}</p>}
          </form>

          {plan && (
            <div className="flex flex-col gap-2 border-t border-line pt-2">
              <p className="text-sm">I&apos;ll follow these as separate topics. Untick any you don&apos;t want.{plan.length > free && ` Only ${free} more fit (up to ${WATCH_LIMIT}).`}</p>
              <ul className="flex flex-col gap-1">
                {plan.map((t, i) => {
                  const set = (patch: Partial<typeof t>) => setPlan((p) => p && p.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                  return (
                    <li key={t.label} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      <label className="flex min-w-48 items-center gap-1.5 font-medium"><input type="checkbox" checked={t.on} onChange={(e) => set({ on: e.target.checked })} /> {t.label}</label>
                      {t.news && <label className="flex items-center gap-1 text-xs text-muted"><input type="checkbox" checked={t.useNews} disabled={!t.on} onChange={(e) => set({ useNews: e.target.checked })} /> News</label>}
                      {t.reactions && <label className="flex items-center gap-1 text-xs text-muted"><input type="checkbox" checked={t.useReactions} disabled={!t.on} onChange={(e) => set({ useReactions: e.target.checked })} /> Reactions</label>}
                    </li>
                  );
                })}
              </ul>
              <div className="flex flex-wrap items-center gap-2">
                {(() => {
                  const chosen = plan.filter((t) => t.on && (t.useNews || t.useReactions));
                  return <button type="button" className="btn-primary min-h-9 text-xs" disabled={s.pending || !chosen.length || chosen.length > free}
                    onClick={() => s.run(() => kbWorldFollow({ projectId, topics: chosen }), undefined, () => { setPlan(null); setQuery(""); })}>
                    {s.pending ? "Looking…" : chosen.length > free ? `Choose ${free} or fewer` : `Follow ${chosen.length} topic${chosen.length === 1 ? "" : "s"}`}</button>;
                })()}
                <button type="button" className="btn min-h-9 text-xs" disabled={s.pending} onClick={() => setPlan(null)}>Cancel</button>
              </div>
            </div>
          )}
          <p className="text-[11px] text-muted">
            NOTE: News comes from Google News and reactions from Hacker News discussions: open public sources, read without any AI.
            Checked once a day; each keeps only its newest 15 items unless you keep one.
          </p>
          <Status msg={s.msg} />
        </div>
      )}

      {watches.length > 0 && (
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {watches.map((w) => {
            const feeds = sources.filter((x) => x.watch_query === w && x.kind === "feed");
            return (
              <li key={w} className="flex flex-col gap-1 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">&ldquo;{w}&rdquo;</span>
                  {canEdit && <button type="button" className="btn min-h-7 text-[11px]" disabled={s.pending}
                    onClick={() => { if (window.confirm(`Stop following "${w}"? Items you kept stay in World.`)) s.run(() => kbWorldWatchRemove({ projectId, query: w })); }}>Stop following</button>}
                </div>
                {feeds.map((f) => {
                  const st = feedState(f);
                  return (
                    <p key={f.id} className="flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span className="w-20 shrink-0 font-medium text-text">{f.adapter === "hn" ? "Reactions" : "News"}</span>
                      <span className={st.tone === "danger" ? "text-danger" : st.tone === "warn" ? "text-warn" : ""}>{st.label}</span>
                      <span>· {counts[f.id] ?? 0} items · checked {ago(f.last_success_at)}</span>
                      {f.last_success_at && !(counts[f.id] ?? 0) && f.status !== "error" && <span className="text-warn">· nothing matched this week; try fewer words</span>}
                      {f.status === "error" && f.last_error && <span className="text-danger">· {f.last_error}</span>}
                      {canEdit && <button type="button" className="text-accent underline" disabled={s.pending} onClick={() => s.run(() => kbRefreshNow({ projectId, sourceId: f.id }))}>Check now</button>}
                    </p>
                  );
                })}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** A World item's impressions: how each character experiences it (qualia). */
export function ItemImpressions({ projectId, canEdit, aiReady, itemId, itemVersion, characters, impressions, only }: {
  projectId: string; canEdit: boolean; aiReady: boolean; itemId: string; itemVersion: number; characters: KCharacter[]; impressions: Impression[]; only?: string | null;
}) {
  const s = useRun();
  const [who, setWho] = useState(only ?? characters[0]?.id ?? "");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const mine = impressions.filter((i) => i.item_id === itemId && (!only || i.character_id === only));
  const name = (id: string) => characters.find((c) => c.id === id)?.name ?? "Character";
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-2">
      <p className="text-[11px] font-semibold tracking-[0.1em] uppercase">How characters experience this</p>
      {mine.map((i) => (
        <div key={i.id} className={`flex flex-col gap-1 p-2 text-sm ${i.status === "accepted" ? "border border-ok/50" : "border border-warn/50 bg-warn-soft/30"}`}>
          <span className="text-xs text-muted"><b className="text-text uppercase">{name(i.character_id)}</b> · {i.status === "accepted" ? "Accepted: colors their dialogue" : "Proposed: not used until you accept"}
            {i.item_version !== itemVersion ? " · the item changed since" : ""}</span>
          {canEdit && i.status === "proposed"
            ? <textarea className="field min-h-20 text-sm italic" value={edits[i.id] ?? i.text} maxLength={2000} onChange={(e) => setEdits({ ...edits, [i.id]: e.target.value })} aria-label="Impression" />
            : <p className="whitespace-pre-wrap italic">{i.text}</p>}
          {canEdit && (
            <span className="flex gap-2">
              {i.status === "proposed" && <button type="button" className="btn min-h-7 text-[11px]" disabled={s.pending} onClick={() => s.run(() => decideImpression({ projectId, impressionId: i.id, accept: true, text: edits[i.id] }))}>Accept</button>}
              <button type="button" className="btn min-h-7 text-[11px]" disabled={s.pending} onClick={() => s.run(() => decideImpression({ projectId, impressionId: i.id, accept: false }))}>{i.status === "accepted" ? "Remove" : "Dismiss"}</button>
            </span>
          )}
        </div>
      ))}
      {canEdit && aiReady && characters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {!only && (
            <select className="field min-h-8 w-auto py-0 text-xs" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Character">
              {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <button type="button" className="btn min-h-8 text-xs" disabled={s.pending || !who} onClick={() => s.run(() => formImpression({ projectId, characterId: who, itemId }), "Impression proposed.")}>
            {s.pending ? "Imagining…" : `How would ${name(who)} experience this?`}</button>
          <span className="text-[11px] text-muted">Uses a small cloud AI model (Claude Haiku), only when you ask: about 0.1¢ each.</span>
        </div>
      )}
      <Status msg={s.msg} />
    </div>
  );
}
