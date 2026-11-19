"use client";
// The Knowledge Base: her film's research library and updating sources. Plain data work
// (no model calls). Research here is research, not story fact.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  kbAddFeed, kbAddNote, kbAnnotateItem, kbArchive, kbCollectionArchive, kbCollectionMember, kbCollectionSave, kbDocumentOwner,
  kbCharacterCollection, kbFeedUpdate, kbImportReference, kbPreviewFeed, kbRefreshDueOnOpen, kbRefreshNow, kbSaveDocument, kbSaveLink, type FeedPreview,
} from "@/app/projects/[projectId]/knowledge-actions";
import { ADAPTERS } from "@/lib/knowledge/adapters";
import { collectionsOf, type KCharacter, type KCollection, type KItem, type KMember, type KSource } from "@/lib/knowledge/types";
import { saveKnowledgeLink } from "@/app/projects/[projectId]/connect-actions";
import { PURPOSE_LABEL, TEMPORAL_LABEL, type Purpose, type Temporal } from "@/lib/knowledge/eligibility";
import { ThumbView } from "@/components/thumb-view";
import { ItemImpressions, WorldPanel } from "./world";
import { worldSetUp } from "@/app/projects/[projectId]/knowledge-actions";
import { ROLE_LABEL } from "@/lib/characters/roles";
import { RoleButtons } from "@/components/characters/role-picker";
import type { Impression } from "@/lib/knowledge/types";
import { kbItemPin } from "@/app/projects/[projectId]/knowledge-actions";
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

// ---- Characters ----------------------------------------------------------------------------
function CharacterStrip({ projectId, canEdit, characters, collections, counts, selected, world, worldOpen }: {
  projectId: string; canEdit: boolean; characters: KCharacter[]; collections: KCollection[]; counts: Record<string, number>; selected: string | null;
  world: KCollection | null; worldOpen: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function open(c: KCharacter) {
    setErr(null);
    if (selected === c.id) { router.push("?", { scroll: false }); return; }
    if (canEdit && !collections.some((x) => x.character_id === c.id)) {
      setBusy(c.id);
      const r = await kbCharacterCollection({ projectId, characterId: c.id }).catch(() => ({ ok: false as const, error: "That didn't open. Try again." }));
      setBusy(null);
      if (!r.ok) { setErr(r.error); return; }
    }
    router.push(`?character=${c.id}`, { scroll: false });
    router.refresh();
  }
  async function openWorld() {
    setErr(null);
    if (worldOpen) { router.push("?", { scroll: false }); return; }
    if (!world && canEdit) {
      setBusy("world");
      const r = await worldSetUp({ projectId, connectAll: false }).catch(() => ({ ok: false as const, error: "That didn't open. Try again." }));
      setBusy(null);
      if (!r.ok) { setErr(r.error); return; }
    }
    router.push("?world=1", { scroll: false });
    router.refresh();
  }
  const tile = (on: boolean) => `flex h-full min-h-[4.75rem] w-full items-center gap-2 border p-2 text-left transition-colors ${on ? "border-text bg-text text-panel-2" : "border-line bg-panel-2 hover:border-text"}`;
  const sub = (on: boolean) => `block text-[11px] ${on ? "text-panel-2/80" : "text-muted"}`;
  const worldItems = world ? counts[world.id] ?? 0 : 0;
  const worldReach = world ? characters.filter((c) => c.links.some((l) => l.collection_id === world.id)).length : 0;
  return (
    <section className="panel flex flex-col gap-3 p-4" aria-labelledby="chars-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="chars-h" className="display text-lg">Knowledge for</h2>
        <p className="text-xs text-muted">The World everyone lives in, then each character. Open one to see and add what they can draw on.</p>
      </div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {(world || canEdit) && (
          <li>
            <button type="button" aria-pressed={worldOpen} disabled={busy === "world"} title={world ? `Connected to ${worldReach} of ${characters.length} characters` : undefined} onClick={() => void openWorld()} className={tile(worldOpen)}>
              <span className={`grid h-12 w-12 shrink-0 place-items-center ${worldOpen ? "bg-panel-2 text-text" : "bg-text text-panel-2"}`} aria-hidden>
                <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18" /></svg>
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold uppercase">{busy === "world" ? "Opening…" : "World"}</span>
                <span className={`${sub(worldOpen)} font-medium`}>For everyone</span>
                <span className={sub(worldOpen)}>{world ? `${worldItems} item${worldItems === 1 ? "" : "s"} · ${worldReach} of ${characters.length}` : "News and reactions"}</span>
              </span>
            </button>
          </li>
        )}
        {characters.map((c) => {
          const own = collections.find((x) => x.character_id === c.id);
          const n = new Set(c.links.map((l) => l.collection_id)).size;
          const items = c.links.reduce((sum, l) => sum + (counts[l.collection_id] ?? 0), 0);
          const on = selected === c.id;
          return (
            <li key={c.id}>
              <button type="button" aria-pressed={on} disabled={busy === c.id} onClick={() => void open(c)} className={tile(on)}>
                <span className="h-12 w-12 shrink-0 overflow-hidden bg-line/60">
                  {c.thumb ? <ThumbView source={c.thumb} alt="" className="size-full" />
                    : <svg viewBox="0 0 24 24" className="size-full p-2 text-muted" aria-hidden><circle cx="12" cy="8" r="4" fill="currentColor" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" fill="currentColor" /></svg>}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold uppercase">{busy === c.id ? "Opening…" : c.name}</span>
                  <span className={`${sub(on)} font-medium`}>{c.role ? ROLE_LABEL[c.role] : "Role not set"}</span>
                  <span className={sub(on)}>
                    {n ? `${items} item${items === 1 ? "" : "s"} · ${n} collection${n === 1 ? "" : "s"}` : own ? "Not connected" : "No research yet"}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {!characters.length && <p className="text-sm text-muted">No characters yet. Add them in your Story&apos;s Cast.</p>}
      {err && <p role="alert" className="text-xs text-danger">{err}</p>}
    </section>
  );
}

function CharacterPanel({ projectId, canEdit, character, collections, counts }: {
  projectId: string; canEdit: boolean; character: KCharacter; collections: KCollection[]; counts: Record<string, number>;
}) {
  const s = useRun();
  const own = collections.find((x) => x.character_id === character.id);
  const ownLinked = !!own && character.links.some((l) => l.collection_id === own.id);
  return (
    <section className="panel flex flex-col gap-3 border-text p-4" aria-labelledby="char-h">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="char-h" className="display text-2xl leading-none">{character.name}&apos;s knowledge</h2>
          <p className="max-w-2xl text-sm text-muted">
            Research you add here goes into {character.name}&apos;s own collection. It&apos;s what {character.name} could draw on in scenes,
            within the time rules. What {character.name} knows for certain lives on their character page.
          </p>
          {canEdit ? <RoleButtons key={character.id} projectId={projectId} entityId={character.id} name={character.name} role={character.role} /> : character.role && <p className="text-xs text-muted">Role: {ROLE_LABEL[character.role]}</p>}
        </div>
        <div className="flex flex-col items-end gap-1 text-xs">
          <Link href={`/projects/${projectId}/items/${character.id}`} className="text-accent">Open {character.name}&apos;s character page →</Link>
          <Link href={`/projects/${projectId}/connections`} className="text-accent">Change how {character.name} uses it (Connections) →</Link>
          <Link href="?" scroll={false} className="text-muted underline">← All research</Link>
        </div>
      </div>
      {own && !ownLinked && (
        <p className="flex flex-wrap items-center gap-2 border border-warn bg-warn-soft/50 p-2 text-xs">
          {own.name} isn&apos;t connected to {character.name} right now, so they won&apos;t draw on it.
          {canEdit && <button type="button" className="btn min-h-7 text-[11px]" disabled={s.pending}
            onClick={() => s.run(() => saveKnowledgeLink({ projectId, linkId: null, data: { character_id: character.id, collection_id: own.id, purpose: "profession", temporal: "background" } }), "Reconnected.")}>Reconnect</button>}
        </p>
      )}
      {character.links.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {character.links.map((l) => {
            const c = collections.find((x) => x.id === l.collection_id);
            return (
              <li key={l.collection_id}>
                <b>{c?.name ?? "Collection"}</b>{c?.character_id === character.id ? <span className="text-xs text-muted"> (their own)</span> : null}
                <span className="text-muted"> · {counts[l.collection_id] ?? 0} items · {PURPOSE_LABEL[l.purpose as Purpose]} · {TEMPORAL_LABEL[l.temporal as Temporal].split(":")[0]}</span>
              </li>
            );
          })}
        </ul>
      )}
      <Status msg={s.msg} />
    </section>
  );
}

// ---- Library ------------------------------------------------------------------------------
interface ImpCtx { characters: KCharacter[]; impressions: Impression[]; only: string | null; aiReady: boolean }
function ItemRow({ projectId, item, source, collections, members, canEdit, imp }: { projectId: string; item: KItem; source: KSource; collections: KCollection[]; members: KMember[]; canEdit: boolean; imp?: ImpCtx | null }) {
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
        {source.watch_query && (canEdit
          ? <button type="button" className={`border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${item.pinned ? "border-ok text-ok" : "border-line"}`} disabled={s.pending}
              title={item.pinned ? "Kept: never trimmed" : "Keep it so daily trimming never removes it"}
              onClick={() => s.run(() => kbItemPin({ projectId, itemId: item.id, pinned: !item.pinned }))}>{item.pinned ? "Kept" : "Keep"}</button>
          : item.pinned ? <Badge tone="ok">Kept</Badge> : null)}
        {inCols.map((c) => <span key={c} className="border border-line px-1.5 py-0.5 text-[10px]">{collections.find((x) => x.id === c)?.name}</span>)}
      </p>
      {imp && !open && imp.impressions.some((i) => i.item_id === item.id && (!imp.only || i.character_id === imp.only)) && (
        <p className="text-xs text-muted">{imp.impressions.filter((i) => i.item_id === item.id && (!imp.only || i.character_id === imp.only)).length} character impression(s). Open to see.</p>
      )}
      {open && (
        <div className="mt-1 flex flex-col gap-2 border-l-2 border-line pl-3">
          <p className="text-[11px] tracking-[0.08em] text-muted uppercase">What the source says · {CONTENT_STATUS[item.content_status]}</p>
          {item.content ? <p className="max-h-64 overflow-y-auto whitespace-pre-wrap">{item.content}</p> : <p className="text-muted">Only the title and details were saved.</p>}
          {(item.url || source.url) && <a className="truncate text-xs text-accent underline" href={item.url ?? source.url ?? "#"} target="_blank" rel="noopener noreferrer nofollow">{item.url ?? source.url}</a>}
          {source.asset_id && <a className="text-xs text-accent underline" href={`/api/assets/${source.asset_id}`} target="_blank" rel="noopener noreferrer">Open the original file</a>}
          {imp && <ItemImpressions projectId={projectId} canEdit={canEdit} aiReady={imp.aiReady} itemId={item.id} itemVersion={item.version}
            characters={imp.characters} impressions={imp.impressions} only={imp.only} />}
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

export function KnowledgeBase({ projectId, canEdit, sources, items, collections, members, references, used, characters, selectedCharacter, impressions, aiReady, worldOpen }: {
  projectId: string; canEdit: boolean; sources: KSource[]; items: KItem[]; collections: KCollection[]; members: KMember[];
  references: { id: string; title: string | null; source_url: string | null; source_domain: string | null }[]; used: Record<string, number>;
  characters: KCharacter[]; selectedCharacter: string | null;
  impressions: Impression[]; aiReady: boolean; worldOpen: boolean;
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
  const world = collections.find((c) => c.kind === "world") ?? null;
  const inWorld = worldOpen && !!world;
  const char = inWorld ? null : characters.find((c) => c.id === selectedCharacter) ?? null;
  const own = char ? collections.find((c) => c.character_id === char.id) ?? null : null;
  const charCols = useMemo(() => (inWorld && world ? [world.id] : char ? [...new Set([...char.links.map((l) => l.collection_id), ...(own ? [own.id] : [])])] : null), [char, own, inWorld, world]);
  const imp: ImpCtx | null = inWorld ? { characters, impressions, only: null, aiReady } : char ? { characters, impressions, only: char.id, aiReady } : null;
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((i) => {
      const src = byId.get(i.source_id);
      if (!src) return false;
      if (kind && src.kind !== kind) return false;
      if (charCols && !collectionsOf(i, members).some((c) => charCols.includes(c))) return false;
      if (!charCols && active && !collectionsOf(i, members).includes(active)) return false;
      if (needle && !`${i.title}\n${i.content}\n${i.director_note ?? ""}\n${src.title}`.toLowerCase().includes(needle)) return false;
      return true;
    }).slice(0, 200);
  }, [items, byId, kind, active, members, q, charCols]);
  const preset = useMemo(() => (inWorld && world ? [world.id] : own ? [own.id] : active ? [active] : []), [active, own, inWorld, world]);

  return (
    <div className="flex flex-col gap-6">
      <CharacterStrip projectId={projectId} canEdit={canEdit} characters={characters} collections={collections} counts={counts} selected={char?.id ?? null}
        world={world} worldOpen={inWorld} />
      {inWorld && world && <WorldPanel projectId={projectId} canEdit={canEdit} characters={characters} world={world} sources={sources} counts={itemCounts} />}
      {char && <CharacterPanel projectId={projectId} canEdit={canEdit} character={char} collections={collections} counts={counts} />}
      {canEdit && <AddResearch key={inWorld ? "world" : own?.id ?? "all"} projectId={projectId} collections={collections} references={references} preset={preset} />}
      {!char && !inWorld && (canEdit || collections.length > 0) && <Collections projectId={projectId} collections={collections} counts={counts} used={used} active={active} onActive={setActive} />}
      {!char && !inWorld && <Feeds projectId={projectId} feeds={sources.filter((s) => s.kind === "feed" && !s.watch_query)} collections={collections} members={members} itemCounts={itemCounts} />}
      <section className="panel flex flex-col gap-3 p-4" aria-labelledby="lib-h">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="lib-h" className="display text-lg">{inWorld ? "In the World" : char ? `What ${char.name} can draw on` : `Library ${active ? `· ${collections.find((c) => c.id === active)?.name}` : ""}`}</h2>
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
            {shown.map((i) => <ItemRow key={i.id} projectId={projectId} item={i} source={byId.get(i.source_id)!} collections={collections} members={members} canEdit={canEdit} imp={imp} />)}
          </ul>
        ) : <p className="text-sm text-muted">{inWorld ? "Nothing in the World yet. Search above, or add news and references by hand." : char ? `Nothing for ${char.name} yet. Add research above, or connect a collection on the Connections desk.` : items.length ? "Nothing matches." : "Nothing here yet. Add a note, a link, a document or an updating source."}</p>}
        {items.length > 200 && shown.length === 200 && <p className="text-xs text-muted">Showing the first 200. Search or pick a collection to narrow it down.</p>}
      </section>
    </div>
  );
}
