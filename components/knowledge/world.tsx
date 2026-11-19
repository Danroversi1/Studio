"use client";
// World knowledge base: the world outside the story, gathered with a prompt window (web
// search, cloud model) or added by hand, and the characters' impressions of it (qualia).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { decideImpression, formImpression, worldKeep, worldSearch, worldSetUp } from "@/app/projects/[projectId]/world-kb-actions";
import type { Impression, KCharacter, KCollection, WorldSearch } from "@/lib/knowledge/types";

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
const KIND = { news: "News", reaction: "Reaction", background: "Background" } as const;
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

/** The World card at the top of the Knowledge Base. */
export function WorldCard({ projectId, canEdit, world, items, connected, total, open }: {
  projectId: string; canEdit: boolean; world: KCollection | null; items: number; connected: number; total: number; open: boolean;
}) {
  const router = useRouter();
  const s = useRun();
  return (
    <section className={`panel flex flex-wrap items-center justify-between gap-3 p-4 ${open ? "border-text" : ""}`}>
      <div className="flex items-center gap-3">
        <span className="grid size-12 shrink-0 place-items-center bg-text text-panel-2" aria-hidden>
          <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18" /></svg>
        </span>
        <div>
          <h2 className="display text-xl leading-none">World</h2>
          <p className="text-xs text-muted">{world ? `${items} item${items === 1 ? "" : "s"} · connected to ${connected} of ${total} characters` : "The world outside your story: news, events and how people react."}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {open ? <Link href="?" scroll={false} className="btn min-h-9 text-xs">← All research</Link> : (
          <button type="button" className="btn-primary min-h-9 text-xs" disabled={s.pending}
            onClick={() => world || !canEdit ? router.push("?world=1", { scroll: false }) : s.run(() => worldSetUp({ projectId, connectAll: false }), "World is ready.", () => router.push("?world=1", { scroll: false }))}>
            {s.pending ? "Setting up…" : "Open World"}</button>
        )}
      </div>
      <Status msg={s.msg} />
    </section>
  );
}

/** World view: what it is, who it reaches, and the prompt window. */
export function WorldPanel({ projectId, canEdit, aiReady, characters, world, searches }: {
  projectId: string; canEdit: boolean; aiReady: boolean; characters: KCharacter[]; world: KCollection; searches: WorldSearch[];
}) {
  const s = useRun();
  const [prompt, setPrompt] = useState("");
  const [focus, setFocus] = useState("both");
  const [period, setPeriod] = useState("month");
  const [openSearch, setOpenSearch] = useState<string | null>(searches[0]?.id ?? null);
  const connected = characters.filter((c) => c.links.some((l) => l.collection_id === world.id));
  const missing = characters.filter((c) => !c.links.some((l) => l.collection_id === world.id));
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

      {canEdit && aiReady && (
        <form className="flex flex-col gap-2 border border-line bg-panel-2 p-3" onSubmit={(e) => { e.preventDefault(); s.run(() => worldSearch({ projectId, prompt, focus, period }), undefined, (r) => setOpenSearch(r.id ?? null)); }}>
          <label className="text-sm font-medium" htmlFor="world-prompt">What&apos;s happening in the world that you want to follow?</label>
          <textarea id="world-prompt" className="field min-h-20 text-sm" value={prompt} maxLength={600} onChange={(e) => setPrompt(e.target.value)} required
            placeholder="e.g. New rules on exporting AI chips, and how engineers and journalists are reacting" />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select className="field min-h-8 w-auto py-0 text-xs" value={focus} onChange={(e) => setFocus(e.target.value)} aria-label="Look for">
              <option value="both">News and reactions</option><option value="news">News only</option><option value="reactions">Reactions only</option>
            </select>
            <select className="field min-h-8 w-auto py-0 text-xs" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="From">
              <option value="week">Past week</option><option value="month">Past month</option><option value="year">Past year</option><option value="any">Any time</option>
            </select>
            <button className="btn-primary min-h-8 text-xs" disabled={s.pending}>{s.pending ? "Searching the world… (about a minute)" : "Search"}</button>
          </div>
          <p className="text-[11px] text-muted">Studio searches the web (Anthropic Claude with web search, in the cloud), then shows what it found with links. Nothing is kept until you choose. About 5–8¢ per search.</p>
          <Status msg={s.msg} />
        </form>
      )}

      {searches.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-semibold tracking-[0.1em] text-muted uppercase">Searches</p>
          <ul className="flex flex-col divide-y divide-line border-y border-line">
            {searches.map((x) => (
              <li key={x.id} className="flex flex-col">
                <button type="button" className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-left text-sm" aria-expanded={openSearch === x.id} onClick={() => setOpenSearch(openSearch === x.id ? null : x.id)}>
                  <span className="min-w-0 flex-1 truncate">&ldquo;{x.prompt}&rdquo;</span>
                  <span className="text-xs text-muted">{x.status === "running" ? "Searching…" : x.status === "failed" ? "Failed" : `${x.results.length} found · ${x.results.filter((r) => r.kept).length} kept`} · {when(x.created_at)}</span>
                </button>
                {openSearch === x.id && <Findings projectId={projectId} canEdit={canEdit} search={x} onRerun={() => { setPrompt(x.prompt); setFocus(x.focus); setPeriod(x.period); }} />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Findings({ projectId, canEdit, search, onRerun }: { projectId: string; canEdit: boolean; search: WorldSearch; onRerun: () => void }) {
  const s = useRun();
  const [pick, setPick] = useState<Set<string>>(new Set(search.results.filter((r) => !r.kept).map((r) => r.id)));
  if (search.status === "failed") return <p className="pb-3 text-sm text-danger">{search.error ?? "The search failed."} Nothing was saved.</p>;
  if (search.status === "running") return <p className="pb-3 text-sm text-muted">Still searching…</p>;
  if (!search.results.length) return <p className="pb-3 text-sm text-muted">Nothing useful came back. Try different words.</p>;
  const left = search.results.filter((r) => !r.kept && pick.has(r.id));
  return (
    <div className="flex flex-col gap-2 pb-3">
      <ul className="flex flex-col gap-2">
        {search.results.map((r) => (
          <li key={r.id} className={`flex gap-2 border p-2 text-sm ${r.kept ? "border-ok/50 bg-ok-soft/30" : "border-line"}`}>
            {canEdit && !r.kept && <input type="checkbox" className="mt-1" checked={pick.has(r.id)} aria-label={`Keep ${r.title}`}
              onChange={() => setPick((p) => { const n = new Set(p); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} />}
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2">
                <span className="border border-line px-1 text-[10px] font-semibold uppercase">{KIND[r.kind]}</span>
                <a className="font-medium text-accent underline" href={r.url} target="_blank" rel="noopener noreferrer nofollow">{r.title}</a>
                {r.kept && <span className="text-[10px] font-semibold text-ok uppercase">Kept</span>}
              </p>
              <p className="text-xs text-muted">{r.source || new URL(r.url).hostname}{r.published ? ` · ${r.published}` : " · date not shown"}</p>
              <p className="mt-1">{r.summary}</p>
              {r.why && <p className="text-xs text-muted">Why: {r.why}</p>}
            </div>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted">Summaries are written by Studio&apos;s research assistant from the pages found. Open a link to check it. {search.searches} web searches · ${Number(search.cost_usd).toFixed(3)}</p>
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary min-h-8 text-xs" disabled={s.pending || !left.length}
            onClick={() => s.run(() => worldKeep({ projectId, searchId: search.id, resultIds: left.map((r) => r.id) }))}>Keep {left.length || ""} in World</button>
          <button type="button" className="btn min-h-8 text-xs" onClick={onRerun}>Search again with this prompt</button>
        </div>
      )}
      <Status msg={s.msg} />
    </div>
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
          <span className="text-[11px] text-muted">Character agent (Anthropic Claude, cloud), from their profile.</span>
        </div>
      )}
      <Status msg={s.msg} />
    </div>
  );
}
