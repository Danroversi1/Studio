"use client";
// What a main character is into: prompt it, draw it from a link or a document, or add it by
// hand. Each interest she keeps is searched in the news every day for that character, so their
// coverage fills with it. Suggestions are never followed until she picks them.
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { attentionSet, avoidAdd, avoidRemove, followFeed, interestRemove, interestsAdd, interestsSuggest, unfollowFeed, type SuggestResult } from "@/app/projects/[projectId]/interest-actions";
import { bubbleSetActive } from "@/app/projects/[projectId]/bubble-actions";
import { extractText } from "@/lib/knowledge/documents";

type Tab = "prompt" | "link" | "document";
type Sug = Extract<SuggestResult, { ok: true }>;

function Chip({ label, sub, onRemove, disabled }: { label: string; sub?: string; onRemove?: () => void; disabled?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 border border-line px-2 py-0.5 text-xs">
      {label}{sub && <span className="text-[10px] text-muted">· {sub}</span>}
      {onRemove && <button type="button" disabled={disabled} onClick={onRemove} className="text-muted hover:text-danger" aria-label={`Remove ${label}`}>×</button>}
    </span>
  );
}

export function InterestsEditor({ projectId, characterId, name, canEdit, topics, avoid, attention, searched, followed, active }: {
  projectId: string; characterId: string; name: string; canEdit: boolean; topics: string[]; avoid: string[]; attention: number;
  searched: string[]; followed: { id: string; title: string; url: string | null; status: string; last_error: string | null }[]; active: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [tab, setTab] = useState<Tab>("prompt");
  const [prompt, setPrompt] = useState("");
  const [url, setUrl] = useState("");
  const [sug, setSug] = useState<Sug | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pickedAvoid, setPickedAvoid] = useState<Set<string>>(new Set());
  const [manual, setManual] = useState("");
  const [manualAvoid, setManualAvoid] = useState("");
  const [att, setAtt] = useState(attention);
  const file = useRef<HTMLInputElement>(null);
  const isSearched = (t: string) => searched.includes(t.toLowerCase());

  const act = (f: () => Promise<{ ok: boolean; error?: string; note?: string }>, after?: () => void) => start(async () => {
    const r = await f();
    setMsg(r.ok ? (r.note ? { kind: "ok", text: r.note } : null) : { kind: "error", text: r.error ?? "Something went wrong." });
    if (r.ok) { after?.(); router.refresh(); }
  });
  const suggest = (input: { text?: string; url?: string; from: Tab }) => start(async () => {
    setMsg(null);
    const r = await interestsSuggest({ projectId, characterId, name, ...input });
    if (!r.ok) { setMsg({ kind: "error", text: r.error }); return; }
    setSug(r);
    setPicked(new Set(r.suggestions.interests.map((i) => i.label).filter((l) => !topics.some((t) => t.toLowerCase() === l.toLowerCase()))));
    setPickedAvoid(new Set(r.suggestions.avoid));
    if (!r.suggestions.interests.length && !r.feed) setMsg({ kind: "error", text: "No interests found there. Try describing them in your own words." });
    else if (r.note) setMsg({ kind: "ok", text: r.note });
  });
  const readDoc = async (f: File) => {
    try {
      const { text, note } = await extractText(f);
      if (!text.trim()) { setMsg({ kind: "error", text: note ?? "No readable text in that file. Text, Markdown and Word files work." }); return; }
      suggest({ text, from: "document" });
    } catch { setMsg({ kind: "error", text: "That file couldn't be read. Text, Markdown and Word files work." }); }
  };
  const toggle = (set: Set<string>, v: string, fn: (s: Set<string>) => void) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); fn(n); };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold">What {name} is into</span>
        <div className="flex flex-wrap gap-1">
          {topics.map((t) => <Chip key={t} label={t} sub={isSearched(t) ? "searched daily" : undefined} disabled={pending || !canEdit}
            onRemove={canEdit ? () => act(() => interestRemove({ projectId, characterId, label: t })) : undefined} />)}
          {!topics.length && <span className="text-xs text-muted">Nothing yet: {name} gets everything in the World watches. Add what they&apos;re into below.</span>}
        </div>
        {(avoid.length > 0 || canEdit) && (
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <span className="text-muted">Avoids:</span>
            {avoid.map((a) => <Chip key={a} label={a} disabled={pending || !canEdit} onRemove={canEdit ? () => act(() => avoidRemove({ projectId, characterId, label: a })) : undefined} />)}
            {!avoid.length && <span className="text-muted">nothing</span>}
          </div>
        )}
        {followed.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <span className="text-muted">Follows:</span>
            {followed.map((f) => <Chip key={f.id} label={f.title} sub={f.status === "error" ? "not connecting" : undefined} disabled={pending || !canEdit}
              onRemove={canEdit ? () => act(() => unfollowFeed({ projectId, characterId, sourceId: f.id })) : undefined} />)}
          </div>
        )}
      </div>

      {canEdit && (
        <div className="flex flex-col gap-2 border border-line p-3">
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Find what they're into">
            {([["prompt", "Describe them"], ["link", "From a link"], ["document", "From a document"]] as [Tab, string][]).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setSug(null); setMsg(null); }}
                className={`border px-2 py-1 text-xs ${tab === k ? "border-text bg-text text-panel-2" : "border-line hover:border-text"}`}>{l}</button>
            ))}
          </div>
          {tab === "prompt" && (
            <>
              <textarea className="field text-sm" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={pending}
                placeholder={`Tell me what ${name} is interested in. e.g. "${name} reads about AI safety and new research papers, follows chess, worries about jobs, never reads celebrity gossip."`} />
              <button type="button" className="btn-primary min-h-9 self-start text-xs" disabled={pending || prompt.trim().length < 3}
                onClick={() => suggest({ text: prompt, from: "prompt" })}>{pending ? "Looking…" : "Find their interests"}</button>
            </>
          )}
          {tab === "link" && (
            <>
              <input className="field text-sm" type="url" value={url} onChange={(e) => setUrl(e.target.value)} disabled={pending}
                placeholder="https://… a blog, channel, profile or article that shows what they're into" />
              <button type="button" className="btn-primary min-h-9 self-start text-xs" disabled={pending || !/^https?:\/\//i.test(url.trim())}
                onClick={() => suggest({ url: url.trim(), from: "link" })}>{pending ? "Reading…" : "Read the link"}</button>
            </>
          )}
          {tab === "document" && (
            <>
              <input ref={file} type="file" accept=".txt,.md,.markdown,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="text-xs" disabled={pending} onChange={(e) => { const f = e.target.files?.[0]; if (f) void readDoc(f); }} />
              <span className="text-[11px] text-muted">A character bio, notes or anything about them (text, Markdown or Word). It&apos;s read here to suggest interests; it isn&apos;t stored.</span>
            </>
          )}
          {sug && (
            <div className="flex flex-col gap-2 border-t border-line pt-2">
              {sug.feed && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span>That link has a feed: <strong>{sug.feed.title}</strong>.</span>
                  <button type="button" className="btn min-h-8 text-xs" disabled={pending || followed.some((f) => f.url === sug.feed!.pageUrl)}
                    onClick={() => act(() => followFeed({ projectId, characterId, ...sug.feed! }))}>{name} follows it</button>
                </div>
              )}
              {sug.suggestions.interests.length > 0 && <span className="text-xs font-medium">Pick what to follow (each is searched in the news daily):</span>}
              <ul className="flex flex-col gap-1">
                {sug.suggestions.interests.map((i) => (
                  <li key={i.label}>
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" className="mt-1" checked={picked.has(i.label)} onChange={() => toggle(picked, i.label, setPicked)} />
                      <span>{i.label}<span className="block text-[11px] text-muted">{i.why}</span></span>
                    </label>
                  </li>
                ))}
              </ul>
              {sug.suggestions.avoid.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted">Avoids:</span>
                  {sug.suggestions.avoid.map((a) => (
                    <label key={a} className="inline-flex items-center gap-1"><input type="checkbox" checked={pickedAvoid.has(a)} onChange={() => toggle(pickedAvoid, a, setPickedAvoid)} />{a}</label>
                  ))}
                </div>
              )}
              {(sug.suggestions.interests.length > 0 || sug.suggestions.avoid.length > 0) && (
                <div className="flex gap-2">
                  <button type="button" className="btn-primary min-h-9 text-xs" disabled={pending || (!picked.size && !pickedAvoid.size)}
                    onClick={() => act(() => interestsAdd({ projectId, characterId, interests: [...picked], avoid: [...pickedAvoid] }), () => { setSug(null); setPrompt(""); setUrl(""); if (file.current) file.current.value = ""; })}>
                    {pending ? "Adding…" : `Follow ${picked.size || ""} ${picked.size === 1 ? "interest" : "interests"}`.replace("  ", " ")}
                  </button>
                  <button type="button" className="btn min-h-9 text-xs" onClick={() => setSug(null)}>Cancel</button>
                </div>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-end gap-2 border-t border-line pt-2">
            <label className="flex flex-col gap-1 text-xs text-muted">Add an interest yourself
              <input className="field min-h-8 text-sm" value={manual} maxLength={60} onChange={(e) => setManual(e.target.value)} placeholder="e.g. chess tournaments"
                onKeyDown={(e) => { if (e.key === "Enter" && manual.trim().length >= 2) { e.preventDefault(); act(() => interestsAdd({ projectId, characterId, interests: [manual] }), () => setManual("")); } }} />
            </label>
            <button type="button" className="btn min-h-8 text-xs" disabled={pending || manual.trim().length < 2} onClick={() => act(() => interestsAdd({ projectId, characterId, interests: [manual] }), () => setManual(""))}>Add</button>
            <label className="flex flex-col gap-1 text-xs text-muted">Something they avoid
              <input className="field min-h-8 text-sm" value={manualAvoid} maxLength={60} onChange={(e) => setManualAvoid(e.target.value)} placeholder="e.g. celebrity gossip"
                onKeyDown={(e) => { if (e.key === "Enter" && manualAvoid.trim().length >= 2) { e.preventDefault(); act(() => avoidAdd({ projectId, characterId, label: manualAvoid }), () => setManualAvoid("")); } }} />
            </label>
            <button type="button" className="btn min-h-8 text-xs" disabled={pending || manualAvoid.trim().length < 2} onClick={() => act(() => avoidAdd({ projectId, characterId, label: manualAvoid }), () => setManualAvoid(""))}>Add</button>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
            <label className="flex items-center gap-2">How much they take in a day
              <input type="range" min={1} max={15} value={att} onChange={(e) => setAtt(Number(e.target.value))} onMouseUp={() => att !== attention && act(() => attentionSet({ projectId, characterId, attention: att }))}
                onTouchEnd={() => att !== attention && act(() => attentionSet({ projectId, characterId, attention: att }))} onKeyUp={() => att !== attention && act(() => attentionSet({ projectId, characterId, attention: att }))} />
              <span className="text-text">{att}</span>
            </label>
            {active && <button type="button" className="underline" disabled={pending} onClick={() => act(async () => { const r = await bubbleSetActive({ projectId, characterId, active: false }); return r.ok ? { ok: true, note: r.note } : r; })}>Pause {name}&apos;s coverage</button>}
          </div>
        </div>
      )}
      {msg && <p role={msg.kind === "error" ? "alert" : "status"} className={`text-xs ${msg.kind === "error" ? "text-danger" : "text-muted"}`}>{msg.text}</p>}
    </div>
  );
}
