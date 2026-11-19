"use client";
// The Knowledge Base: her film's research library and updating sources. Plain data work
// (no model calls). Research here is research, not story fact.
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  kbAddFeed, kbAddNote, kbAnnotateItem, kbArchive, kbCollectionArchive, kbCollectionMember, kbCollectionSave, kbDocumentOwner,
  kbFeedUpdate, kbImportReference, kbPreviewFeed, kbRefreshDueOnOpen, kbRefreshNow, kbSaveDocument, kbSaveLink, type FeedPreview,
} from "@/app/projects/[projectId]/knowledge-actions";
import { ADAPTERS } from "@/lib/knowledge/adapters";
import { collectionsOf, type KCollection, type KItem, type KMember, type KSource } from "@/lib/knowledge/types";
import { docTypeOf, extractText, uploadDocument } from "@/lib/knowledge/documents";
import { CONTENT_STATUS, KIND_LABEL, REFRESH_CHOICES, STATUS, VERIFICATION, ago, feedState } from "@/lib/knowledge/labels";

type Msg = { kind: "ok" | "error"; text: string } | null;
type Res = { ok: true; id?: string; note?: string } | { ok: false; error: string };

function useRun() {
  const router = useRouter();
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  function run(fn: () => Promise<Res>, okText?: string, after?: (r: Res & { ok: true }) => void) {
    setMsg(null);
    start(async () => {
      let r: Res;
      try { r = await fn(); } catch { r = { ok: false, error: "That didn't save. Check your connection and try again." }; }
      if (r.ok) { setMsg({ kind: "ok", text: r.note ?? okText ?? "Saved." }); after?.(r); router.refresh(); }
      else setMsg({ kind: "error", text: r.error });
    });
  }
  return { run, msg, setMsg, pending };
}

function Status({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return <p role={msg.kind === "error" ? "alert" : "status"} className={`text-xs ${msg.kind === "error" ? "text-danger" : "text-muted"}`}>{msg.text}</p>;
}
const TONE = { ok: "border-ok bg-ok-soft text-ok", warn: "border-warn bg-warn-soft text-warn", muted: "border-line text-muted", danger: "border-danger text-danger" };
function Badge({ tone, children }: { tone: keyof typeof TONE; children: React.ReactNode }) {
  return <span className={`border px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] uppercase ${TONE[tone]}`}>{children}</span>;
}
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }) : null);
const host = (u: string | null) => { try { return u ? new URL(u).hostname.replace(/^www\./, "") : ""; } catch { return ""; } };

function CollectionPicker({ collections, value, onChange, label = "Add to collections (optional)" }: {
  collections: KCollection[]; value: string[]; onChange: (v: string[]) => void; label?: string;
}) {
  if (!collections.length) return <p className="text-xs text-muted">Make a collection above to group research by topic.</p>;
  return (
    <fieldset className="flex flex-wrap gap-1.5">
      <legend className="mb-1 text-xs text-muted">{label}</legend>
      {collections.map((c) => (
        <button key={c.id} type="button" aria-pressed={value.includes(c.id)} onClick={() => onChange(value.includes(c.id) ? value.filter((x) => x !== c.id) : [...value, c.id])}
          className={`btn min-h-8 px-2 text-xs ${value.includes(c.id) ? "border-brand bg-brand/10" : ""}`}>{c.name}</button>
      ))}
    </fieldset>
  );
}

// ---- Adding research ------------------------------------------------------------------------
type Tab = "note" | "link" | "document" | "reference" | "feed";
const TABS: { id: Tab; label: string }[] = [
  { id: "note", label: "Note" }, { id: "link", label: "Link" }, { id: "document", label: "Document" },
  { id: "reference", label: "From References" }, { id: "feed", label: "Updating source" },
];

function AddResearch({ projectId, collections, references, preset }: { projectId: string; collections: KCollection[]; references: { id: string; title: string | null; source_url: string | null; source_domain: string | null }[]; preset: string[] }) {
  const [tab, setTab] = useState<Tab>("note");
  const [cols, setCols] = useState<string[]>(preset);
  useEffect(() => { setCols(preset); }, [preset]);
  const s = useRun();
  const [title, setTitle] = useState(""); const [body, setBody] = useState("");
  const [url, setUrl] = useState(""); const [excerpt, setExcerpt] = useState(""); const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null); const [docText, setDocText] = useState(""); const [docNote, setDocNote] = useState<string | null>(null);
  const [preview, setPreview] = useState<FeedPreview | null>(null); const [hours, setHours] = useState(24);
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const reset = () => { setTitle(""); setBody(""); setUrl(""); setExcerpt(""); setNote(""); setFile(null); setDocText(""); setDocNote(null); setPreview(null); setRef(""); };

  async function pickFile(f: File | null) {
    setFile(f); setDocText(""); setDocNote(null);
    if (!f) return;
    if (!docTypeOf(f)) { s.setMsg({ kind: "error", text: "Use a PDF, Word (.docx), text or Markdown file." }); return; }
    setTitle((t) => t || f.name.replace(/\.[a-z0-9]+$/i, ""));
    const r = await extractText(f);
    setDocText(r.text); setDocNote(r.note);
  }
  async function saveDoc() {
    if (!file) return;
    setBusy(true); s.setMsg(null);
    try {
      const owner = await kbDocumentOwner({ projectId });
      if (!owner.ok || !owner.id) throw new Error(owner.ok ? "Couldn't prepare the upload." : owner.error);
      const assetId = await uploadDocument(owner.id, file);
      s.run(() => kbSaveDocument({ projectId, assetId, title: title || file.name, text: docText, collections: cols }), docText ? "Document saved and its text imported." : "Document saved. Its text isn't imported.", reset);
    } catch (e) { s.setMsg({ kind: "error", text: e instanceof Error ? e.message : "The upload failed." }); }
    setBusy(false);
  }

  return (
    <section className="panel flex flex-col gap-3 p-4" aria-labelledby="add-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="add-h" className="display text-lg">Add research</h2>
        <div role="tablist" aria-label="Kind of research" className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} onClick={() => { setTab(t.id); s.setMsg(null); }}
              className={`btn min-h-8 px-2.5 text-xs ${tab === t.id ? "border-text bg-text text-panel-2" : ""}`}>{t.label}</button>
          ))}
        </div>
      </div>

      {tab === "note" && (
        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); s.run(() => kbAddNote({ projectId, title, body, collections: cols }), "Note saved.", reset); }}>
          <input className="field" placeholder="Title (optional)" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
          <textarea className="field min-h-28" placeholder="What you found out, in your words." value={body} maxLength={40000} onChange={(e) => setBody(e.target.value)} aria-label="Note" required />
          <CollectionPicker collections={collections} value={cols} onChange={setCols} />
          <div><button className="btn-primary min-h-9 text-xs" disabled={s.pending}>{s.pending ? "Saving…" : "Save note"}</button></div>
        </form>
      )}

      {tab === "link" && (
        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); s.run(() => kbSaveLink({ projectId, url, excerpt, note, collections: cols }), excerpt.trim() ? "Link saved with your excerpt." : "Link saved.", reset); }}>
          <input className="field" type="url" inputMode="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Link" required />
          <p className="help">Saving a link keeps the address and the page&apos;s title, author and date. It doesn&apos;t copy the article.</p>
          <textarea className="field min-h-20" placeholder="Excerpt to keep (optional): only a passage you're allowed to save, a few paragraphs at most." value={excerpt} maxLength={6000} onChange={(e) => setExcerpt(e.target.value)} aria-label="Excerpt" />
          <textarea className="field min-h-14" placeholder="Your note: why it matters to the film (optional)" value={note} maxLength={3000} onChange={(e) => setNote(e.target.value)} aria-label="Your note" />
          <CollectionPicker collections={collections} value={cols} onChange={setCols} />
          <div><button className="btn-primary min-h-9 text-xs" disabled={s.pending}>{s.pending ? "Saving…" : "Save link"}</button></div>
        </form>
      )}

      {tab === "document" && (
        <div className="flex flex-col gap-2">
          <input type="file" accept=".pdf,.docx,.txt,.md,.markdown" className="text-sm" onChange={(e) => void pickFile(e.target.files?.[0] ?? null)} aria-label="Document" />
          <p className="help">PDF, Word (.docx), text or Markdown, up to 20 MB. The file is stored privately with your film. Text is imported from Word, text and Markdown files.</p>
          {file && (
            <>
              <input className="field" placeholder="Title" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
              {docNote && <p className="text-xs text-warn">{docNote}</p>}
              <textarea className="field min-h-24 font-mono text-xs" value={docText} onChange={(e) => setDocText(e.target.value)} maxLength={40000}
                placeholder="Text to import (optional). Paste the parts you need." aria-label="Text to import" />
              <CollectionPicker collections={collections} value={cols} onChange={setCols} />
              <div><button type="button" className="btn-primary min-h-9 text-xs" disabled={busy || s.pending} onClick={() => void saveDoc()}>{busy || s.pending ? "Uploading…" : "Save document"}</button></div>
            </>
          )}
        </div>
      )}

      {tab === "reference" && (
        references.length ? (
          <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (ref) s.run(() => kbImportReference({ projectId, referenceId: ref, collections: cols }), "Reference added.", reset); }}>
            <select className="field" value={ref} onChange={(e) => setRef(e.target.value)} aria-label="Reference" required>
              <option value="">Choose one of your film&apos;s references…</option>
              {references.map((r) => <option key={r.id} value={r.id}>{r.title || r.source_domain || host(r.source_url) || "Reference"}</option>)}
            </select>
            <p className="help">Adds your title, observations and credit. The reference stays where it is.</p>
            <CollectionPicker collections={collections} value={cols} onChange={setCols} />
            <div><button className="btn-primary min-h-9 text-xs" disabled={s.pending}>Add reference</button></div>
          </form>
        ) : <p className="text-sm text-muted">All of your film&apos;s references are already here, or there aren&apos;t any yet.</p>
      )}

      {tab === "feed" && (
        <div className="flex flex-col gap-2">
          <form className="flex flex-wrap gap-2" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setPreview(null); s.setMsg(null);
            try { setPreview(await kbPreviewFeed({ projectId, url })); } catch { setPreview({ ok: false, status: "error", error: "Couldn't check that address." }); } setBusy(false); }}>
            <input className="field min-w-0 flex-1" placeholder="News site, blog, feed, Bluesky or Mastodon profile" value={url} onChange={(e) => { setUrl(e.target.value); setPreview(null); }} aria-label="Address" required />
            <button className="btn min-h-10 text-xs" disabled={busy}>{busy ? "Checking…" : "Check"}</button>
          </form>
          <p className="help">Works with: {Object.values(ADAPTERS).map((a) => a.label).join(" · ")}. Studio only reads feeds the site publishes itself.</p>
          {preview && !preview.ok && (
            <div className="border border-line p-3 text-sm">
              <p className="flex flex-wrap items-center gap-2">
                <Badge tone={preview.status === "needs_authorization" ? "warn" : "danger"}>{preview.status === "needs_authorization" ? "Requires authorization" : "Unsupported or unavailable"}</Badge>
                {preview.service && <span className="font-medium">{preview.service}</span>}
              </p>
              <p className="mt-1">{preview.error}</p>
              <button type="button" className="btn mt-2 min-h-8 text-xs" disabled={s.pending}
                onClick={() => s.run(() => kbSaveLink({ projectId, url, collections: cols }), "Saved as a link (not updating).", reset)}>Save it as a link instead</button>
            </div>
          )}
          {preview && preview.ok && (
            <div className="flex flex-col gap-2 border border-line p-3 text-sm">
              <p className="flex flex-wrap items-center gap-2"><span className="font-semibold">{preview.title}</span><span className="text-xs text-muted">{ADAPTERS[preview.adapter as keyof typeof ADAPTERS]?.label}</span></p>
              <p className="text-xs text-muted">Found {preview.count} items ({preview.dated} dated). {ADAPTERS[preview.adapter as keyof typeof ADAPTERS]?.how}</p>
              <ul className="flex flex-col gap-0.5 text-xs">
                {preview.samples.map((x, i) => <li key={i} className="truncate">· {x.title}{x.date ? ` (${fmtDate(x.date)})` : " (no date)"}</li>)}
              </ul>
              <label className="text-xs text-muted">How often to check
                <select className="field mt-1" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
                  {REFRESH_CHOICES.map((c) => <option key={c.hours} value={c.hours}>{c.label}</option>)}
                </select>
              </label>
              <p className="help">Studio&apos;s server checks due feeds once a day, and again when you open this page. You can also refresh any time. It never writes dialogue on its own when new items arrive.</p>
              <CollectionPicker collections={collections} value={cols} onChange={setCols} />
              <div><button type="button" className="btn-primary min-h-9 text-xs" disabled={s.pending}
                onClick={() => s.run(() => kbAddFeed({ projectId, feedUrl: preview.feedUrl, pageUrl: preview.pageUrl, adapter: preview.adapter, title: preview.title, refreshHours: hours, collections: cols }), "Connected.", reset)}>
                {s.pending ? "Connecting…" : "Connect this source"}</button></div>
            </div>
          )}
        </div>
      )}
      <Status msg={s.msg} />
    </section>
  );
}

// ---- Collections ----------------------------------------------------------------------------
function Collections({ projectId, collections, counts, used, active, onActive }: {
  projectId: string; collections: KCollection[]; counts: Record<string, number>; used: Record<string, number>; active: string | null; onActive: (id: string | null) => void;
}) {
  const s = useRun();
  const [name, setName] = useState("");
  const [edit, setEdit] = useState<KCollection | null>(null);
  return (
    <section className="panel flex flex-col gap-3 p-4" aria-labelledby="col-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="col-h" className="display text-lg">Collections</h2>
        <p className="text-xs text-muted">Group research by topic. One source can be in several collections without copying it.</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" aria-pressed={active === null} onClick={() => onActive(null)} className={`btn min-h-8 px-2.5 text-xs ${active === null ? "border-text bg-text text-panel-2" : ""}`}>Everything</button>
        {collections.map((c) => (
          <button key={c.id} type="button" aria-pressed={active === c.id} onClick={() => onActive(active === c.id ? null : c.id)}
            className={`btn min-h-8 px-2.5 text-xs ${active === c.id ? "border-text bg-text text-panel-2" : ""}`}>
            {c.name} <span className="ml-1 opacity-70">{counts[c.id] ?? 0}</span>
          </button>
        ))}
      </div>
      {active && (() => {
        const c = collections.find((x) => x.id === active);
        if (!c) return null;
        return edit?.id === c.id ? (
          <form className="flex flex-col gap-2 border-l-2 border-line pl-3" onSubmit={(e) => { e.preventDefault(); s.run(() => kbCollectionSave({ projectId, collectionId: c.id, name: edit.name, description: edit.description ?? "" }), "Saved.", () => setEdit(null)); }}>
            <input className="field" value={edit.name} maxLength={120} onChange={(e) => setEdit({ ...edit, name: e.target.value })} aria-label="Name" />
            <input className="field" value={edit.description ?? ""} maxLength={1000} placeholder="What it's for (optional)" onChange={(e) => setEdit({ ...edit, description: e.target.value })} aria-label="Description" />
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary min-h-8 text-xs" disabled={s.pending}>Save</button>
              <button type="button" className="btn min-h-8 text-xs" onClick={() => setEdit(null)}>Cancel</button>
              <button type="button" className="btn min-h-8 text-xs text-danger" disabled={s.pending}
                onClick={() => { if (window.confirm(`Remove the collection "${c.name}"? Its research stays in the library${used[c.id] ? `, and ${used[c.id]} character connection(s) to it will be disconnected` : ""}.`)) s.run(() => kbCollectionArchive({ projectId, collectionId: c.id }), "Collection removed. Its research is still here.", () => onActive(null)); }}>
                Remove collection</button>
            </div>
          </form>
        ) : (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            {c.description && <span className="text-muted">{c.description}</span>}
            {used[c.id] ? <span className="text-xs text-muted">Connected to {used[c.id]} character{used[c.id] > 1 ? "s" : ""} (Connections desk)</span> : null}
            <button type="button" className="text-xs text-accent underline" onClick={() => setEdit(c)}>Rename or remove</button>
          </p>
        );
      })()}
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); s.run(() => kbCollectionSave({ projectId, collectionId: null, name, description: "" }), "Collection made.", () => setName("")); }}>
        <input className="field min-w-0 flex-1" placeholder="New collection, e.g. Semiconductor industry" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} aria-label="New collection" required />
        <button className="btn min-h-10 text-xs" disabled={s.pending}>Add collection</button>
      </form>
      <Status msg={s.msg} />
    </section>
  );
}

// ---- Updating sources -----------------------------------------------------------------------
function Feeds({ projectId, feeds, collections, members, itemCounts }: { projectId: string; feeds: KSource[]; collections: KCollection[]; members: KMember[]; itemCounts: Record<string, number> }) {
  const s = useRun();
  const [now, setNow] = useState(0);
  useEffect(() => { setNow(Date.now()); }, [feeds]);
  if (!feeds.length) return null;
  return (
    <section className="panel flex flex-col gap-3 p-4" aria-labelledby="feeds-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="feeds-h" className="display text-lg">Updating sources</h2>
        <p className="text-xs text-muted">Checked on Studio&apos;s server once a day and when you open this page, if due. New items never write dialogue on their own.</p>
      </div>
      <ul className="flex flex-col divide-y divide-line">
        {feeds.map((f) => {
          const st = feedState(f, now || Date.now());
          const cols = collections.filter((c) => members.some((m) => m.collection_id === c.id && m.source_id === f.id));
          return (
            <li key={f.id} className="flex flex-col gap-1.5 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{f.title}</span>
                <Badge tone={st.tone}>{st.label}</Badge>
                <span className="text-xs text-muted">{ADAPTERS[f.adapter as keyof typeof ADAPTERS]?.label ?? f.adapter}</span>
              </div>
              <p className="text-xs text-muted">
                Last successful refresh: {f.last_success_at ? `${ago(f.last_success_at, now || Date.now())} (${new Date(f.last_success_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })})` : "never"}
                {" · "}{REFRESH_CHOICES.find((c) => c.hours === f.refresh_hours)?.label ?? `Every ${f.refresh_hours} h`}
                {" · "}{itemCounts[f.id] ?? 0} items saved
                {cols.length ? ` · In ${cols.map((c) => c.name).join(", ")}` : ""}
              </p>
              {f.last_error && f.status === "error" && <p className="text-xs text-danger">Last attempt failed: {f.last_error} Everything collected before is still here.</p>}
              <p className="truncate text-xs"><a className="text-accent underline" href={f.feed_url ?? "#"} target="_blank" rel="noopener noreferrer nofollow">{f.feed_url}</a></p>
              <div className="flex flex-wrap gap-1.5">
                {!f.disconnected_at && <button type="button" className="btn min-h-8 text-xs" disabled={s.pending} onClick={() => s.run(() => kbRefreshNow({ projectId, sourceId: f.id }))}>Refresh now</button>}
                {!f.disconnected_at && <button type="button" className="btn min-h-8 text-xs" disabled={s.pending}
                  onClick={() => s.run(() => kbFeedUpdate({ projectId, sourceId: f.id, data: { paused: !f.paused } }), f.paused ? "Resumed." : "Paused. Saved items are kept.")}>{f.paused ? "Resume" : "Pause"}</button>}
                <select className="field min-h-8 w-auto py-0 text-xs" aria-label="How often to check" value={f.refresh_hours ?? 24} disabled={s.pending}
                  onChange={(e) => s.run(() => kbFeedUpdate({ projectId, sourceId: f.id, data: { refresh_hours: Number(e.target.value) } }))}>
                  {REFRESH_CHOICES.map((c) => <option key={c.hours} value={c.hours}>{c.label}</option>)}
                </select>
                <button type="button" className="btn min-h-8 text-xs" disabled={s.pending}
                  onClick={() => s.run(() => kbFeedUpdate({ projectId, sourceId: f.id, data: { disconnected: !f.disconnected_at } }), f.disconnected_at ? "Reconnected." : "Disconnected. Saved items are kept.")}>
                  {f.disconnected_at ? "Reconnect" : "Disconnect"}</button>
                <SourceCollections projectId={projectId} sourceId={f.id} collections={collections} members={members} />
              </div>
            </li>
          );
        })}
      </ul>
      <Status msg={s.msg} />
    </section>
  );
}

function SourceCollections({ projectId, sourceId, collections, members }: { projectId: string; sourceId: string; collections: KCollection[]; members: KMember[] }) {
  const s = useRun();
  const [open, setOpen] = useState(false);
  if (!collections.length) return null;
  return (
    <span className="relative">
      <button type="button" className="btn min-h-8 text-xs" aria-expanded={open} onClick={() => setOpen(!open)}>Collections…</button>
      {open && (
        <span className="absolute z-10 mt-1 flex w-64 flex-col gap-1 border border-line bg-panel-2 p-2 shadow-sm">
          {collections.map((c) => {
            const on = members.some((m) => m.collection_id === c.id && m.source_id === sourceId);
            return (
              <label key={c.id} className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={on} disabled={s.pending} onChange={() => s.run(() => kbCollectionMember({ projectId, collectionId: c.id, sourceId, on: !on }), on ? "Removed from collection." : "Added to collection.")} />
                {c.name}
              </label>
            );
          })}
          <span className="text-[11px] text-muted">Applies to everything from this source, including future items.</span>
          <Status msg={s.msg} />
        </span>
      )}
    </span>
  );
}

// ---- Library ------------------------------------------------------------------------------
function ItemRow({ projectId, item, source, collections, members, canEdit }: { projectId: string; item: KItem; source: KSource; collections: KCollection[]; members: KMember[]; canEdit: boolean }) {
  const s = useRun();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(item.director_note ?? "");
  const [ver, setVer] = useState(item.verification);
  const [verNote, setVerNote] = useState(item.verification_note ?? "");
  const [date, setDate] = useState(item.published_at ? item.published_at.slice(0, 10) : "");
  const inCols = collectionsOf(item, members);
  const st = source.kind === "feed" ? null : STATUS[source.status];
  return (
    <li className="flex flex-col gap-1 py-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <button type="button" className="text-left font-semibold hover:text-accent" aria-expanded={open} onClick={() => setOpen(!open)}>{item.title}</button>
        <span className="text-xs text-muted">{KIND_LABEL[source.kind]}{source.kind === "feed" ? ` · ${source.title}` : source.origin ? ` · ${source.origin}` : ""}</span>
      </div>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        <span>{item.published_at ? `Dated ${fmtDate(item.published_at)}` : "Date unknown"}</span>
        {item.author && <span>· {item.author}</span>}
        <span>· Saved {fmtDate(item.retrieved_at)}</span>
        {item.version > 1 && <span>· Version {item.version}</span>}
        {st && <Badge tone={st.tone}>{st.label}</Badge>}
        {item.verification !== "unverified" && <Badge tone={item.verification === "checked" ? "ok" : "warn"}>{VERIFICATION[item.verification]}</Badge>}
        {inCols.map((c) => <span key={c} className="border border-line px-1.5 py-0.5 text-[10px]">{collections.find((x) => x.id === c)?.name}</span>)}
      </p>
      {open && (
        <div className="mt-1 flex flex-col gap-2 border-l-2 border-line pl-3">
          <p className="text-[11px] tracking-[0.08em] text-muted uppercase">What the source says · {CONTENT_STATUS[item.content_status]}</p>
          {item.content ? <p className="max-h-64 overflow-y-auto whitespace-pre-wrap">{item.content}</p> : <p className="text-muted">Only the title and details were saved.</p>}
          {(item.url || source.url) && <a className="truncate text-xs text-accent underline" href={item.url ?? source.url ?? "#"} target="_blank" rel="noopener noreferrer nofollow">{item.url ?? source.url}</a>}
          {source.asset_id && <a className="text-xs text-accent underline" href={`/api/assets/${source.asset_id}`} target="_blank" rel="noopener noreferrer">Open the original file</a>}
          {canEdit ? (
            <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); s.run(() => kbAnnotateItem({ projectId, itemId: item.id, data: { director_note: note, verification: ver, verification_note: verNote, published_at: date ? `${date}T12:00:00Z` : "" } })); }}>
              <label className="text-xs text-muted">Your interpretation (kept separate from the source)
                <textarea className="field mt-1 min-h-14" value={note} maxLength={4000} onChange={(e) => setNote(e.target.value)} />
              </label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <label className="text-xs text-muted">Checked?
                  <select className="field mt-1" value={ver} onChange={(e) => setVer(e.target.value)}>
                    {Object.entries(VERIFICATION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label className="text-xs text-muted sm:col-span-2">What&apos;s uncertain or how you checked
                  <input className="field mt-1" value={verNote} maxLength={2000} onChange={(e) => setVerNote(e.target.value)} />
                </label>
              </div>
              <label className="text-xs text-muted">Publication or event date (leave empty if unknown)
                <input type="date" className="field mt-1 w-auto" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <fieldset className="flex flex-wrap gap-1.5">
                <legend className="mb-1 text-xs text-muted">In collections</legend>
                {collections.map((c) => {
                  const direct = members.some((m) => m.collection_id === c.id && m.item_id === item.id);
                  const viaSource = members.some((m) => m.collection_id === c.id && m.source_id === item.source_id);
                  return (
                    <button key={c.id} type="button" disabled={viaSource || s.pending} aria-pressed={direct || viaSource} title={viaSource ? "Through its source" : undefined}
                      onClick={() => s.run(() => kbCollectionMember({ projectId, collectionId: c.id, itemId: item.id, on: !direct }))}
                      className={`btn min-h-8 px-2 text-xs ${direct || viaSource ? "border-brand bg-brand/10" : ""}`}>{c.name}</button>
                  );
                })}
              </fieldset>
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary min-h-8 text-xs" disabled={s.pending}>{s.pending ? "Saving…" : "Save notes"}</button>
                {source.kind !== "feed" && <button type="button" className="btn min-h-8 text-xs" disabled={s.pending}
                  onClick={() => { if (window.confirm("Remove this from the library? Dialogue that already used it keeps its record.")) s.run(() => kbArchive({ projectId, sourceId: source.id }), "Removed from the library."); }}>Remove</button>}
              </div>
              <Status msg={s.msg} />
            </form>
          ) : (
            <>
              {item.director_note && <p className="whitespace-pre-wrap"><span className="text-xs text-muted">Director&apos;s note: </span>{item.director_note}</p>}
              {item.verification_note && <p className="text-xs text-muted">{item.verification_note}</p>}
            </>
          )}
        </div>
      )}
    </li>
  );
}

export function KnowledgeBase({ projectId, canEdit, sources, items, collections, members, references, used }: {
  projectId: string; canEdit: boolean; sources: KSource[]; items: KItem[]; collections: KCollection[]; members: KMember[];
  references: { id: string; title: string | null; source_url: string | null; source_domain: string | null }[]; used: Record<string, number>;
}) {
  const router = useRouter();
  const [active, setActive] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<string>("");
  const ran = useRef(false);
  // Opening the Knowledge Base refreshes this film's feeds that are due (bounded, server side).
  useEffect(() => {
    if (ran.current || !sources.some((s) => s.kind === "feed")) return;
    ran.current = true;
    kbRefreshDueOnOpen({ projectId }).then((r) => { if (r.checked) router.refresh(); }).catch(() => {});
  }, [projectId, sources, router]);

  const byId = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const it of items) for (const c of collectionsOf(it, members)) m[c] = (m[c] ?? 0) + 1;
    return m;
  }, [items, members]);
  const itemCounts = useMemo(() => items.reduce<Record<string, number>>((m, i) => ({ ...m, [i.source_id]: (m[i.source_id] ?? 0) + 1 }), {}), [items]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((i) => {
      const src = byId.get(i.source_id);
      if (!src) return false;
      if (kind && src.kind !== kind) return false;
      if (active && !collectionsOf(i, members).includes(active)) return false;
      if (needle && !`${i.title}\n${i.content}\n${i.director_note ?? ""}\n${src.title}`.toLowerCase().includes(needle)) return false;
      return true;
    }).slice(0, 200);
  }, [items, byId, kind, active, members, q]);
  const preset = useMemo(() => (active ? [active] : []), [active]);

  return (
    <div className="flex flex-col gap-6">
      {canEdit && <AddResearch projectId={projectId} collections={collections} references={references} preset={preset} />}
      {(canEdit || collections.length > 0) && <Collections projectId={projectId} collections={collections} counts={counts} used={used} active={active} onActive={setActive} />}
      <Feeds projectId={projectId} feeds={sources.filter((s) => s.kind === "feed")} collections={collections} members={members} itemCounts={itemCounts} />
      <section className="panel flex flex-col gap-3 p-4" aria-labelledby="lib-h">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="lib-h" className="display text-lg">Library {active ? `· ${collections.find((c) => c.id === active)?.name}` : ""}</h2>
          <div className="flex flex-wrap gap-2">
            <input className="field min-h-9 w-56 text-sm" placeholder="Search your research" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
            <select className="field min-h-9 w-auto text-sm" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
              <option value="">All kinds</option>
              {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}s</option>)}
            </select>
          </div>
        </div>
        {shown.length ? (
          <ul className="flex flex-col divide-y divide-line">
            {shown.map((i) => <ItemRow key={i.id} projectId={projectId} item={i} source={byId.get(i.source_id)!} collections={collections} members={members} canEdit={canEdit} />)}
          </ul>
        ) : <p className="text-sm text-muted">{items.length ? "Nothing matches." : "Nothing here yet. Add a note, a link, a document or an updating source."}</p>}
        {items.length > 200 && shown.length === 200 && <p className="text-xs text-muted">Showing the first 200. Search or pick a collection to narrow it down.</p>}
      </section>
    </div>
  );
}
