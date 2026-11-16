"use client";
// The Connections board: every part of the story on one board. Drag cards to arrange
// them; drag from a card's pin to another card to tie a string and name it; add sticky
// notes. Grey strings are worked out from the script (who is in which scene, where scenes
// happen) and update themselves; orange strings are hers.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { boardLabel, boardLink, boardMove, boardNote, boardNoteDelete, boardUnlink } from "@/app/projects/[projectId]/board-actions";
import { CARD_H, CARD_W, autoEdges, buildNodes, stringPath, type BoardInput, type BoardLink, type BoardNode } from "@/lib/board";

type View = { x: number; y: number; k: number };
const NOTE_BG: Record<string, string> = { yellow: "#f6d867", green: "#9fd67a", pink: "#f4a9c0", blue: "#9cc7f0" };
const KIND_LABEL: Record<BoardNode["kind"], string> = { character: "Character", location: "Location", reference: "Reference", note: "Note", scene: "Scene" };

export function ConnectionsBoard({ projectId, input, links: initialLinks, canEdit }: {
  projectId: string; input: Omit<BoardInput, "showScenes">; links: BoardLink[]; canEdit: boolean;
}) {
  const router = useRouter();
  const [showScenes, setShowScenes] = useState(false);
  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>({});
  const [links, setLinks] = useState<BoardLink[]>(initialLinks);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 0.85 });
  const [pull, setPull] = useState<{ from: string; x: number; y: number } | null>(null);
  const [pending, setPending] = useState<{ from: string; to: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [noteEdit, setNoteEdit] = useState<{ id: string | null; body: string; color: string } | null>(null);
  const [labelText, setLabelText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<{ key: string; dx: number; dy: number; moved: boolean } | null>(null);
  const pan = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null);

  useEffect(() => { setLinks(initialLinks); }, [initialLinks]);

  const nodes = useMemo(() => buildNodes({ ...input, showScenes, positions: { ...input.positions, ...pos } }), [input, showScenes, pos]);
  const byKey = useMemo(() => new Map(nodes.map((n) => [n.key, n])), [nodes]);
  const auto = useMemo(() => autoEdges({ entities: input.entities, script: input.script, showScenes }), [input.entities, input.script, showScenes]);
  const pin = (n: BoardNode) => ({ x: n.x + CARD_W / 2, y: n.y + 6 });

  const toBoard = useCallback((cx: number, cy: number) => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k };
  }, [view]);

  const fit = useCallback(() => {
    const el = wrap.current;
    if (!el || !nodes.length) return;
    const minX = Math.min(...nodes.map((n) => n.x)) - 40, minY = Math.min(...nodes.map((n) => n.y)) - 40;
    const maxX = Math.max(...nodes.map((n) => n.x + CARD_W)) + 40, maxY = Math.max(...nodes.map((n) => n.y + CARD_H)) + 40;
    const k = Math.max(0.3, Math.min(1.2, Math.min(el.clientWidth / (maxX - minX), el.clientHeight / (maxY - minY))));
    setView({ k, x: -minX * k + (el.clientWidth - (maxX - minX) * k) / 2, y: -minY * k + 12 });
  }, [nodes]);
  const fitted = useRef(false);
  useEffect(() => { if (!fitted.current) { fitted.current = true; fit(); } }, [fit]);

  function run<T>(fn: () => Promise<{ ok: boolean; error?: string; data?: T }>, after?: (d?: T) => void) {
    setMsg(null);
    start(async () => {
      try {
        const r = await fn();
        if (r.ok) after?.(r.data); else setMsg(r.error ?? "That didn't save.");
      } catch { setMsg("That didn't save. Check your connection and try again."); }
    });
  }

  // ---- pointer handling --------------------------------------------------
  function onCardDown(e: React.PointerEvent, n: BoardNode) {
    if (!canEdit || e.button !== 0) return;
    e.stopPropagation();
    const p = toBoard(e.clientX, e.clientY);
    drag.current = { key: n.key, dx: p.x - n.x, dy: p.y - n.y, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPinDown(e: React.PointerEvent, n: BoardNode) {
    if (!canEdit || n.kind === "scene") return;
    e.stopPropagation();
    const p = toBoard(e.clientX, e.clientY);
    setPull({ from: n.key, ...p });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onMove(e: React.PointerEvent) {
    if (drag.current) {
      const p = toBoard(e.clientX, e.clientY);
      const d = drag.current;
      d.moved = true;
      setPos((m) => ({ ...m, [d.key]: { x: Math.round(p.x - d.dx), y: Math.round(p.y - d.dy) } }));
    } else if (pull) {
      setPull({ ...pull, ...toBoard(e.clientX, e.clientY) });
    } else if (pan.current) {
      const s = pan.current;
      setView((v) => ({ ...v, x: s.vx + e.clientX - s.sx, y: s.vy + e.clientY - s.sy }));
    }
  }
  function onUp(e: React.PointerEvent) {
    if (drag.current) {
      const d = drag.current;
      drag.current = null;
      const p = pos[d.key] ?? byKey.get(d.key);
      if (d.moved && p) run(() => boardMove({ projectId, moves: [{ key: d.key, x: p.x, y: p.y }] }));
    } else if (pull) {
      const target = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest("[data-key]")?.getAttribute("data-key");
      if (target && target !== pull.from && !target.startsWith("s:")) {
        setPending({ from: pull.from, to: target });
        setLabelText(links.find((l) => (l.from === pull.from && l.to === target) || (l.to === pull.from && l.from === target))?.label ?? "");
      }
      setPull(null);
    }
    pan.current = null;
  }
  function onBgDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    setSelected(null);
    pan.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
  }
  function zoom(f: number) {
    const el = wrap.current!;
    const cx = el.clientWidth / 2, cy = el.clientHeight / 2;
    setView((v) => {
      const k = Math.max(0.3, Math.min(1.8, v.k * f));
      return { k, x: cx - ((cx - v.x) / v.k) * k, y: cy - ((cy - v.y) / v.k) * k };
    });
  }
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ---- actions ------------------------------------------------------------
  function saveLink(from: string, to: string, label: string) {
    run(() => boardLink({ projectId, from, to, label }), (id) => {
      setLinks((ls) => [...ls.filter((l) => !((l.from === from && l.to === to) || (l.from === to && l.to === from))), { id: id as string, from, to, label: label.trim() || null }]);
      setPending(null);
    });
  }
  function center() {
    const el = wrap.current!;
    return { x: Math.round((el.clientWidth / 2 - view.x) / view.k - CARD_W / 2), y: Math.round((el.clientHeight / 2 - view.y) / view.k - CARD_H / 2) };
  }
  const selLink = links.find((l) => l.id === selected);
  const name = (k: string) => byKey.get(k)?.title || (k.startsWith("n:") ? "Note" : "Card");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {canEdit && <button type="button" className="btn min-h-9 text-xs" onClick={() => setNoteEdit({ id: null, body: "", color: "yellow" })}>+ Note</button>}
        <label className="btn min-h-9 cursor-pointer text-xs">
          <input type="checkbox" className="mr-1.5" checked={showScenes} onChange={(e) => setShowScenes(e.target.checked)} /> Show scenes
        </label>
        <span className="ml-auto flex items-center gap-1">
          <button type="button" className="btn min-h-9 px-3 text-xs" onClick={() => zoom(1 / 1.2)} aria-label="Zoom out">−</button>
          <button type="button" className="btn min-h-9 px-3 text-xs" onClick={() => zoom(1.2)} aria-label="Zoom in">+</button>
          <button type="button" className="btn min-h-9 text-xs" onClick={fit}>Fit</button>
        </span>
      </div>
      <p className="text-xs text-muted">
        <span className="mr-3"><span className="mr-1 inline-block h-0.5 w-6 bg-brand align-middle" /> your strings</span>
        <span className="mr-3"><span className="mr-1 inline-block h-0 w-6 border-t border-dashed border-muted align-middle" /> from the script</span>
        {canEdit && <>Drag a card to move it. Drag from a card&apos;s pin to another card to connect them. Ctrl + scroll to zoom.</>}
      </p>
      {msg && <p role="alert" className="text-sm text-danger">{msg}</p>}

      <div ref={wrap} className="panel grid-lines relative h-[70vh] min-h-96 touch-none overflow-hidden select-none"
        onPointerDown={onBgDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} role="application"
        aria-label="Connections board. A list of all connections follows below.">
        <div className="absolute top-0 left-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
          {nodes.map((n) => (
            <div key={n.key} data-key={n.key}
              className={`absolute flex flex-col overflow-hidden shadow-md ${n.kind === "note" ? "" : "border border-line bg-panel-2"} ${canEdit ? "cursor-grab active:cursor-grabbing" : ""}`}
              style={{ left: n.x, top: n.y, width: CARD_W, height: CARD_H, background: n.kind === "note" ? NOTE_BG[n.color ?? "yellow"] : undefined, transform: n.kind === "note" ? "rotate(-1.5deg)" : undefined }}
              onPointerDown={(e) => onCardDown(e, n)}
              onDoubleClick={() => { if (canEdit && n.kind === "note") setNoteEdit({ id: n.key.slice(2), body: n.body, color: n.color ?? "yellow" }); }}>
              {n.kind !== "scene" && (
                <span role="button" tabIndex={-1} aria-label={`Connect ${n.title || "note"}`} title="Drag to another card to connect"
                  onPointerDown={(e) => onPinDown(e, n)}
                  className={`absolute top-1 left-1/2 z-10 size-3.5 -translate-x-1/2 rounded-full border border-black/30 shadow ${canEdit ? "cursor-crosshair" : ""} ${n.kind === "location" ? "bg-sky-500" : "bg-brand"}`} />
              )}
              {n.kind === "note" ? (
                <p className="line-clamp-5 px-3 pt-5 font-serif text-sm leading-snug text-black">{n.body}</p>
              ) : (
                <div className="flex h-full gap-2 p-2 pt-5">
                  {(n.kind === "character" || n.kind === "reference" || (n.kind === "location" && n.imageAssetId)) && (
                    <div className="h-full w-16 shrink-0 bg-line/60">
                      {n.imageAssetId
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={`/api/assets/${n.imageAssetId}`} alt="" className="size-full object-cover" draggable={false} />
                        : <svg viewBox="0 0 24 24" className="size-full p-2 text-muted" aria-hidden><circle cx="12" cy="8" r="4" fill="currentColor" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" fill="currentColor" /></svg>}
                    </div>
                  )}
                  <div className="flex min-w-0 flex-1 flex-col">
                    <p className="text-[10px] tracking-[0.12em] text-muted uppercase">{KIND_LABEL[n.kind]}</p>
                    <p className="truncate text-sm font-semibold">{n.title}</p>
                    <p className="line-clamp-3 text-[11px] leading-tight text-muted">{n.body}</p>
                    {n.href && <Link href={n.href} className="mt-auto text-[10px] text-accent" onPointerDown={(e) => e.stopPropagation()}>Open</Link>}
                  </div>
                </div>
              )}
            </div>
          ))}

          <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width="1" height="1">
            {auto.map((e) => {
              const a = byKey.get(e.from), b = byKey.get(e.to);
              if (!a || !b) return null;
              const pa = pin(a), pb = pin(b);
              const { d } = stringPath(pa.x, pa.y, pb.x, pb.y);
              return <path key={`${e.from}-${e.to}-${e.label}`} d={d} fill="none" stroke="#8a8a8a" strokeWidth={1 + Math.min(2, e.weight * 0.4)} strokeDasharray="5 5" opacity={0.75}><title>{`${name(e.from)} — ${e.label} — ${name(e.to)}`}</title></path>;
            })}
            {links.map((l) => {
              const a = byKey.get(l.from), b = byKey.get(l.to);
              if (!a || !b) return null;
              const pa = pin(a), pb = pin(b);
              const { d, mid } = stringPath(pa.x, pa.y, pb.x, pb.y);
              return (
                <g key={l.id}>
                  <path d={d} fill="none" stroke="var(--color-brand, #ff5a1f)" strokeWidth={selected === l.id ? 4 : 2.5} />
                  <path d={d} fill="none" stroke="transparent" strokeWidth={14} className="pointer-events-auto cursor-pointer"
                    onPointerDown={(e) => { e.stopPropagation(); setSelected(l.id); setLabelText(l.label ?? ""); }} />
                  {l.label && (
                    <foreignObject x={mid.x - 80} y={mid.y - 12} width={160} height={26} className="overflow-visible">
                      <span className="pointer-events-auto block cursor-pointer truncate bg-panel-2 px-1.5 py-0.5 text-center text-[11px] shadow"
                        onPointerDown={(e) => { e.stopPropagation(); setSelected(l.id); setLabelText(l.label ?? ""); }}>{l.label}</span>
                    </foreignObject>
                  )}
                </g>
              );
            })}
            {pull && (() => { const a = byKey.get(pull.from); if (!a) return null; const pa = pin(a); return <path d={stringPath(pa.x, pa.y, pull.x, pull.y).d} fill="none" stroke="#ff5a1f" strokeWidth={2.5} strokeDasharray="6 4" />; })()}
          </svg>
        </div>

        {(pending || selLink || noteEdit) && (
          <div className="absolute top-3 left-1/2 z-20 w-[min(26rem,92%)] -translate-x-1/2 border border-line bg-panel-2 p-3 shadow-lg" onPointerDown={(e) => e.stopPropagation()}>
            {pending && (
              <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); saveLink(pending.from, pending.to, labelText); }}>
                <p className="text-sm"><b>{name(pending.from)}</b> ↔ <b>{name(pending.to)}</b></p>
                <label className="text-xs text-muted">What connects them? (optional, in your words)
                  <input autoFocus className="field mt-1" maxLength={200} value={labelText} onChange={(e) => setLabelText(e.target.value)} placeholder="his girlfriend · is watching her · lied to him" />
                </label>
                <div className="flex gap-2">
                  <button type="submit" className="btn-primary min-h-9 text-xs" disabled={busy}>{busy ? "Saving…" : "Connect"}</button>
                  <button type="button" className="btn min-h-9 text-xs" onClick={() => setPending(null)}>Cancel</button>
                </div>
              </form>
            )}
            {selLink && !pending && (
              <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); run(() => boardLabel({ projectId, id: selLink.id, label: labelText }), () => { setLinks((ls) => ls.map((l) => l.id === selLink.id ? { ...l, label: labelText.trim() || null } : l)); setSelected(null); }); }}>
                <p className="text-sm"><b>{name(selLink.from)}</b> ↔ <b>{name(selLink.to)}</b></p>
                {canEdit ? (
                  <>
                    <input autoFocus className="field" maxLength={200} value={labelText} onChange={(e) => setLabelText(e.target.value)} aria-label="Connection label" placeholder="What connects them?" />
                    <div className="flex flex-wrap gap-2">
                      <button type="submit" className="btn-primary min-h-9 text-xs" disabled={busy}>Save</button>
                      <button type="button" className="btn min-h-9 text-xs" disabled={busy}
                        onClick={() => run(() => boardUnlink({ projectId, id: selLink.id }), () => { setLinks((ls) => ls.filter((l) => l.id !== selLink.id)); setSelected(null); })}>Remove string</button>
                      <button type="button" className="btn min-h-9 text-xs" onClick={() => setSelected(null)}>Close</button>
                    </div>
                  </>
                ) : <p className="text-sm">{selLink.label ?? "No label"}</p>}
              </form>
            )}
            {noteEdit && !pending && !selLink && (
              <form className="flex flex-col gap-2" onSubmit={(e) => {
                e.preventDefault();
                if (!noteEdit.body.trim()) return;
                const c = center();
                run(() => boardNote({ projectId, id: noteEdit.id, body: noteEdit.body, color: noteEdit.color, ...(noteEdit.id ? {} : c) }), () => { setNoteEdit(null); router.refresh(); });
              }}>
                <label className="text-xs text-muted">{noteEdit.id ? "Edit note" : "New note"}
                  <textarea autoFocus className="field mt-1 font-serif" rows={3} maxLength={600} value={noteEdit.body} onChange={(e) => setNoteEdit({ ...noteEdit, body: e.target.value })} />
                </label>
                <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Note color">
                  {Object.entries(NOTE_BG).map(([c, bg]) => (
                    <button key={c} type="button" role="radio" aria-checked={noteEdit.color === c} aria-label={c}
                      className={`size-6 border ${noteEdit.color === c ? "border-text ring-2 ring-text" : "border-line"}`} style={{ background: bg }}
                      onClick={() => setNoteEdit({ ...noteEdit, color: c })} />
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="submit" className="btn-primary min-h-9 text-xs" disabled={busy}>{busy ? "Saving…" : noteEdit.id ? "Save" : "Add note"}</button>
                  {noteEdit.id && <button type="button" className="btn min-h-9 text-xs" disabled={busy}
                    onClick={() => run(() => boardNoteDelete({ projectId, id: noteEdit.id! }), () => { setNoteEdit(null); router.refresh(); })}>Remove note</button>}
                  <button type="button" className="btn min-h-9 text-xs" onClick={() => setNoteEdit(null)}>Cancel</button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>

      {/* The same connections as a list: readable and usable with a keyboard. */}
      <section className="panel flex flex-col gap-3 p-5" aria-labelledby="conn-list">
        <h2 id="conn-list" className="eyebrow text-text">All connections</h2>
        {links.length === 0 && auto.length === 0 && <p className="text-sm text-muted">Nothing connected yet.</p>}
        <ul className="flex flex-col">
          {links.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2 text-sm">
              <span><b>{name(l.from)}</b> — {l.label ?? <span className="text-muted">connected</span>} — <b>{name(l.to)}</b></span>
              {canEdit && <button type="button" className="text-xs text-accent" onClick={() => { setSelected(l.id); setLabelText(l.label ?? ""); wrap.current?.scrollIntoView({ block: "center" }); }}>Edit</button>}
            </li>
          ))}
          {auto.map((e) => (
            <li key={`${e.from}-${e.to}-${e.label}`} className="border-t border-line py-2 text-sm text-muted">
              {name(e.from)} — {e.label}{e.weight > 1 ? ` (${e.weight} scenes)` : ""} — {name(e.to)} <span className="text-xs">· from the script</span>
            </li>
          ))}
        </ul>
        {canEdit && (
          <form className="grid grid-cols-1 gap-2 border-t border-line pt-3 md:grid-cols-[1fr_1fr_1.4fr_auto]" onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const from = String(f.get("from")), to = String(f.get("to"));
            if (from === to) { setMsg("Pick two different cards."); return; }
            saveLink(from, to, String(f.get("label") ?? ""));
            e.currentTarget.reset();
          }}>
            {(["from", "to"] as const).map((k) => (
              <select key={k} name={k} className="field" aria-label={k === "from" ? "First card" : "Second card"} required>
                {nodes.filter((n) => n.kind !== "scene").map((n) => <option key={n.key} value={n.key}>{n.title || `Note: ${n.body.slice(0, 30)}`}</option>)}
              </select>
            ))}
            <input name="label" className="field" maxLength={200} placeholder="What connects them? (optional)" aria-label="Connection label" />
            <button type="submit" className="btn-primary" disabled={busy}>Connect</button>
          </form>
        )}
      </section>
    </div>
  );
}
