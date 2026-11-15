"use client";
// Developer comments layer: drop numbered pins on any page of the live site and leave a note.
// Only rendered for developers (checked on the server, enforced by the database).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { type DevComment, addDevComment, deleteDevComment, editDevComment, listDevComments, setDevCommentStatus } from "@/app/dev-actions";

function selectorFor(el: Element | null): string {
  const parts: string[] = [];
  for (let n = el; n && n !== document.body && parts.length < 5; n = n.parentElement) {
    if (n.id) { parts.unshift(`#${n.id}`); break; }
    const cls = [...n.classList].filter((c) => /^[a-z][\w-]*$/i.test(c) && !c.includes(":")).slice(0, 2);
    parts.unshift(n.tagName.toLowerCase() + (cls.length ? `.${cls.join(".")}` : ""));
  }
  return parts.join(" > ");
}

type Draft = { x: number; y: number; anchor: DevComment["anchor"] };

export function DevComments() {
  const path = usePathname() || "/";
  const [comments, setComments] = useState<DevComment[]>([]);
  const [panel, setPanel] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [showPins, setShowPins] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [text, setText] = useState("");
  const [openPin, setOpenPin] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  async function saveEdit() {
    if (!editing || !editing.text.trim()) return;
    setBusy(true);
    const res = await editDevComment({ id: editing.id, body: editing.text });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    setEditing(null);
    setError(null);
    reload();
  }

  const editor = (
    <div className="flex flex-col gap-2">
      <textarea autoFocus rows={4} maxLength={4000} value={editing?.text ?? ""} aria-label="Edit comment"
        onChange={(e) => setEditing((x) => (x ? { ...x, text: e.target.value } : x))}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveEdit(); }}
        className="field text-sm" />
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn btn-primary min-h-8 px-2 text-[11px]" disabled={busy || !editing?.text.trim()} onClick={saveEdit}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" className="btn min-h-8 px-2 text-[11px]" onClick={() => setEditing(null)}>Cancel</button>
      </div>
    </div>
  );

  const reload = useCallback(async () => setComments(await listDevComments()), []);
  useEffect(() => { setMounted(true); reload(); }, [reload]);
  useEffect(() => { setDraft(null); setOpenPin(null); setPlacing(false); }, [path]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setPlacing(false); setDraft(null); setOpenPin(null); setEditing(null); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const here = comments.filter((c) => c.path === path && (showResolved || c.status === "open"));
  const openCount = comments.filter((c) => c.status === "open").length;

  function place(e: React.MouseEvent) {
    e.preventDefault();
    const under = document.elementsFromPoint(e.clientX, e.clientY).find((n) => !(n as HTMLElement).closest("[data-dev-layer]")) ?? null;
    const anchor: DevComment["anchor"] = {
      x_pct: Math.round((e.pageX / document.documentElement.clientWidth) * 1000) / 10,
      y_px: Math.round(e.pageY),
      selector: selectorFor(under),
      snippet: ((under as HTMLElement | null)?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
      vw: window.innerWidth, vh: window.innerHeight,
    };
    setDraft({ x: e.pageX, y: e.pageY, anchor });
    setPlacing(false);
    setText("");
    setError(null);
  }

  async function save() {
    if (!draft || !text.trim()) return;
    setBusy(true);
    const res = await addDevComment({ path, anchor: draft.anchor, body: text });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    setDraft(null);
    reload();
  }

  async function remove(id: string) {
    if (confirmDelete !== id) { setConfirmDelete(id); return; }
    await deleteDevComment({ id });
    setConfirmDelete(null);
    setOpenPin(null);
    reload();
  }

  const deleteButton = (id: string, small = false) => (
    <button type="button" onClick={() => remove(id)}
      className={small ? `hover:text-danger ${confirmDelete === id ? "font-semibold text-danger" : ""}`
        : `btn min-h-8 px-2 text-[11px] ${confirmDelete === id ? "border-danger text-danger" : ""}`}>
      {confirmDelete === id ? "Confirm delete" : "Delete"}
    </button>
  );

  async function setStatus(id: string, status: "open" | "resolved") {
    await setDevCommentStatus({ id, status });
    setOpenPin(null);
    reload();
  }

  if (!mounted) return null;
  return createPortal(
    <div data-dev-layer className="font-sans">
      {placing && (
        <div className="fixed inset-0 z-[9998] cursor-crosshair bg-brand/5" onClick={place} role="presentation">
          <p className="pointer-events-none fixed top-3 left-1/2 -translate-x-1/2 bg-text px-3 py-1.5 text-xs text-panel-2">
            Click where your comment goes · Esc to cancel
          </p>
        </div>
      )}

      {showPins && here.map((c, i) => {
        const left = `${c.anchor.x_pct ?? 50}%`;
        const top = c.anchor.y_px ?? 100;
        const n = here.length - i;
        return (
          <div key={c.id} className="absolute z-[9997]" style={{ left, top }}>
            <button type="button" onClick={() => setOpenPin(openPin === c.id ? null : c.id)}
              className={`-translate-x-1/2 -translate-y-1/2 flex size-7 items-center justify-center rounded-full border-2 border-white text-xs font-bold shadow ${c.status === "open" ? "bg-brand text-text" : "bg-muted text-white"}`}
              aria-label={`Developer comment ${n}`}>{n}</button>
            {openPin === c.id && (
              <div className="absolute top-5 left-0 w-72 border border-line bg-panel-2 p-3 text-sm shadow-lg">
                {editing?.id === c.id ? editor : <p className="whitespace-pre-wrap">{c.body}</p>}
                {c.resolution_note && <p className="mt-2 text-xs text-ok">Resolved: {c.resolution_note}</p>}
                <p className="mt-2 text-[11px] text-muted">{new Date(c.created_at).toLocaleString()} · {c.anchor.selector}</p>
                {editing?.id !== c.id && <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className="btn min-h-8 px-2 text-[11px]" onClick={() => { setEditing({ id: c.id, text: c.body }); setError(null); }}>Edit</button>
                  {c.status === "open"
                    ? <button type="button" className="btn min-h-8 px-2 text-[11px]" onClick={() => setStatus(c.id, "resolved")}>Resolve</button>
                    : <button type="button" className="btn min-h-8 px-2 text-[11px]" onClick={() => setStatus(c.id, "open")}>Reopen</button>}
                  {deleteButton(c.id)}
                  <button type="button" className="btn min-h-8 px-2 text-[11px]" onClick={() => { setOpenPin(null); setConfirmDelete(null); }}>Close</button>
                </div>}
              </div>
            )}
          </div>
        );
      })}

      {draft && (
        <div className="absolute z-[9999] w-72 border-2 border-brand bg-panel-2 p-3 shadow-xl" style={{ left: Math.min(draft.x, document.documentElement.clientWidth - 300), top: draft.y + 8 }}>
          <p className="eyebrow mb-1">Developer comment</p>
          <textarea autoFocus rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save(); }}
            className="field text-sm" placeholder="What should change here?" />
          {draft.anchor.snippet && <p className="mt-1 line-clamp-2 text-[11px] text-muted">On: “{draft.anchor.snippet}”</p>}
          {error && <p className="mt-1 text-xs text-danger">{error}</p>}
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn btn-primary min-h-9" disabled={busy || !text.trim()} onClick={save}>{busy ? "Saving…" : "Save"}</button>
            <button type="button" className="btn min-h-9" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="fixed right-4 bottom-4 z-[9999] flex flex-col items-end gap-2">
        {panel && (
          <div className="flex max-h-[60vh] w-80 flex-col border border-line bg-panel-2 shadow-xl">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <p className="eyebrow">Dev comments · {openCount} open</p>
              <label className="flex items-center gap-1 text-[11px] text-muted">
                <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> resolved
              </label>
            </div>
            <ul className="overflow-y-auto">
              {comments.filter((c) => showResolved || c.status === "open").map((c) => (
                <li key={c.id} className={`border-b border-line px-3 py-2 text-sm ${c.path === path ? "bg-accent-soft/40" : ""}`}>
                  {editing?.id === c.id ? editor : (
                    <p className={`line-clamp-3 ${c.status === "resolved" ? "text-muted line-through" : ""}`}>{c.body}</p>
                  )}
                  <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted">
                    {c.path === path ? <span>This page</span> : <Link href={c.path} className="link-accent truncate">{c.path}</Link>}
                    <span className="flex shrink-0 gap-3">
                      <button type="button" className="hover:text-accent" onClick={() => { setEditing({ id: c.id, text: c.body }); setError(null); }}>Edit</button>
                      {c.status === "open"
                        ? <button type="button" className="hover:text-accent" onClick={() => setStatus(c.id, "resolved")}>Resolve</button>
                        : <button type="button" className="hover:text-accent" onClick={() => setStatus(c.id, "open")}>Reopen</button>}
                      {deleteButton(c.id, true)}
                    </span>
                  </div>
                </li>
              ))}
              {!comments.some((c) => showResolved || c.status === "open") && <li className="px-3 py-3 text-sm text-muted">No comments yet.</li>}
            </ul>
            <div className="flex gap-2 border-t border-line px-3 py-2">
              <button type="button" className="btn min-h-8 px-2 text-[11px]" onClick={() => setShowPins((v) => !v)}>{showPins ? "Hide pins" : "Show pins"}</button>
              <button type="button" className="btn min-h-8 px-2 text-[11px]" onClick={reload}>Refresh</button>
            </div>
          </div>
        )}
        <div className="flex gap-2">
          <a href="/changes" className="btn min-h-10 bg-panel-2 shadow">What changed</a>
          <button type="button" onClick={() => { setPlacing((v) => !v); setDraft(null); }}
            className={`btn min-h-10 shadow ${placing ? "btn-primary" : "bg-panel-2"}`}>{placing ? "Cancel" : "+ Comment"}</button>
          <button type="button" onClick={() => setPanel((v) => !v)} className="btn min-h-10 bg-text text-panel-2 shadow">
            Dev {openCount > 0 ? `(${openCount})` : ""}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
