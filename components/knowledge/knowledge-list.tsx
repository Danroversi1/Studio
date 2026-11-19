"use client";
// Connections desk: the Knowledge Base as a list. Connect a whole collection to a character
// (opens the connection editor with purpose and time rules), or give one piece of research
// to a character (it goes into their own "<Name>'s knowledge", shared, not copied, and
// shows as a string on the board). No model calls.
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { kbCharacterCollection, kbCollectionMember } from "@/app/projects/[projectId]/knowledge-actions";
import type { KnowledgeLink, LibraryItem } from "@/lib/knowledge/connect-data";

type Col = { id: string; name: string; count: number; kind?: string; character_id?: string | null };
const KIND_ORDER = (c: Col) => (c.kind === "world" ? 0 : c.kind === "character" ? 2 : 1);
const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function KnowledgeList({ projectId, canEdit, characters, collections, links, library, onConnect }: {
  projectId: string; canEdit: boolean; characters: { id: string; name: string }[]; collections: Col[]; links: KnowledgeLink[];
  library: LibraryItem[]; onConnect: (characterId: string, collectionId: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const ownOf = useMemo(() => new Map(collections.filter((c) => c.character_id).map((c) => [c.character_id!, c.id])), [collections]);
  const charOfCol = useMemo(() => new Map(collections.filter((c) => c.character_id).map((c) => [c.id, c.character_id!])), [collections]);
  const nameOf = (id: string) => characters.find((c) => c.id === id)?.name ?? "";
  const groups = useMemo(() => {
    const sorted = [...collections].sort((a, b) => KIND_ORDER(a) - KIND_ORDER(b) || a.name.localeCompare(b.name));
    const loose = library.filter((i) => !i.collections.length);
    return [...sorted.map((c) => ({ id: c.id, name: c.name, col: c as Col | null, items: library.filter((i) => i.collections.includes(c.id)) })),
      ...(loose.length ? [{ id: "none", name: "Not in a collection", col: null, items: loose }] : [])];
  }, [collections, library]);
  const needle = q.trim().toLowerCase();

  function give(itemId: string, characterId: string) {
    setMsg(null);
    start(async () => {
      try {
        let colId = ownOf.get(characterId);
        if (!colId) {
          const r = await kbCharacterCollection({ projectId, characterId });
          if (!r.ok || !r.id) throw new Error(r.ok ? "Couldn't open their knowledge." : r.error);
          colId = r.id;
        }
        const r = await kbCollectionMember({ projectId, collectionId: colId, itemId, on: true });
        if (!r.ok) throw new Error(r.error);
        setMsg({ kind: "ok", text: `Given to ${nameOf(characterId)}: it's now in ${nameOf(characterId)}'s knowledge.` });
        router.refresh();
      } catch (e) { setMsg({ kind: "error", text: e instanceof Error ? e.message : "That didn't save." }); }
    });
  }
  function take(itemId: string, colId: string) {
    start(async () => {
      const r = await kbCollectionMember({ projectId, collectionId: colId, itemId, on: false }).catch(() => ({ ok: false as const, error: "That didn't save." }));
      if (r.ok) { setMsg({ kind: "ok", text: `Taken back from ${nameOf(charOfCol.get(colId) ?? "")}. The research itself is unchanged.` }); router.refresh(); }
      else setMsg({ kind: "error", text: r.error });
    });
  }

  return (
    <section className="panel flex flex-col gap-3 p-5" aria-labelledby="kl-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="kl-h" className="display text-lg">Knowledge Base</h2>
        <input className="field min-h-9 w-60 text-sm" placeholder="Search research" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search research" />
      </div>
      <p className="max-w-3xl text-sm text-muted">
        Connect a whole collection to a character, or give one piece of research to a character: it goes into their own knowledge
        (shared, not copied) and shows as a string on the board.
      </p>
      {msg && <p role={msg.kind === "error" ? "alert" : "status"} className={`text-xs ${msg.kind === "error" ? "text-danger" : "text-muted"}`}>{msg.text}</p>}
      <ul className="flex flex-col divide-y divide-line border-y border-line">
        {groups.map((g) => {
          const items = needle ? g.items.filter((i) => i.title.toLowerCase().includes(needle)) : g.items;
          if (needle && !items.length) return null;
          const isOpen = open === g.id || !!needle;
          const connected = g.col ? links.filter((l) => l.collection_id === g.col!.id).map((l) => nameOf(l.character_id)).filter(Boolean) : [];
          const free = g.col ? characters.filter((c) => !links.some((l) => l.collection_id === g.col!.id && l.character_id === c.id)) : [];
          return (
            <li key={g.id} className="flex flex-col">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
                <button type="button" className="min-w-0 flex-1 text-left" aria-expanded={isOpen} onClick={() => setOpen(open === g.id ? null : g.id)}>
                  <span className="font-semibold">{g.name}</span>
                  <span className="ml-2 text-xs text-muted">{g.col?.kind === "world" ? "World · " : ""}{items.length} item{items.length === 1 ? "" : "s"}</span>
                  {g.col && <span className="block truncate text-xs text-muted">{connected.length ? `Connected to ${connected.join(", ")}` : "Not connected to anyone yet"}</span>}
                </button>
                {canEdit && g.col && free.length > 0 && (
                  <select className="field min-h-8 w-auto text-xs" value="" aria-label={`Connect ${g.name} to a character`}
                    onChange={(e) => { if (e.target.value) onConnect(e.target.value, g.col!.id); }}>
                    <option value="">Connect to…</option>
                    {free.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
              </div>
              {isOpen && (
                <ul className="mb-2 flex flex-col gap-1 border-l-2 border-line pl-3">
                  {items.slice(0, 60).map((i) => {
                    const holders = i.collections.filter((c) => charOfCol.has(c));
                    const others = characters.filter((c) => !holders.some((h) => charOfCol.get(h) === c.id));
                    return (
                      <li key={i.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1 text-sm">
                        {i.url ? <a href={i.url} target="_blank" rel="noopener noreferrer nofollow" className="min-w-0 flex-1 truncate hover:text-accent hover:underline">{i.title} <span aria-hidden className="text-accent">↗</span></a>
                          : <span className="min-w-0 flex-1 truncate">{i.title}</span>}
                        <span className="text-[11px] text-muted">{fmt(i.date)}</span>
                        {holders.map((h) => (
                          <span key={h} className="inline-flex items-center gap-1 border border-line px-1.5 py-0.5 text-[10px]">
                            {nameOf(charOfCol.get(h)!)}
                            {canEdit && <button type="button" className="text-muted hover:text-danger" disabled={pending} title="Take it back" onClick={() => take(i.id, h)} aria-label={`Take it back from ${nameOf(charOfCol.get(h)!)}`}>×</button>}
                          </span>
                        ))}
                        {canEdit && others.length > 0 && (
                          <select className="field min-h-7 w-auto py-0 text-[11px]" value="" disabled={pending} aria-label={`Give "${i.title}" to a character`}
                            onChange={(e) => { if (e.target.value) give(i.id, e.target.value); }}>
                            <option value="">Give to…</option>
                            {others.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        )}
                      </li>
                    );
                  })}
                  {items.length > 60 && <li className="text-xs text-muted">Showing the newest 60. Search to find others.</li>}
                  {!items.length && <li className="text-xs text-muted">Nothing in it yet.</li>}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
