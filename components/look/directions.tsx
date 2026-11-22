"use client";
// Visual directions: named groups of Look & Feel references with an intention, palette and
// scope. Every save keeps a version; approved storyboard frames that follow a changed
// direction are flagged for review (never redrawn). No model calls.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { moveDirection, saveDirection, setDefaultDirection } from "@/app/projects/[projectId]/look-actions";
import type { FilmEntity } from "@/lib/look/data";
import { inkOn } from "@/lib/look/palette";
import type { Applies, LookDirection, LookRef, PaletteColor } from "@/lib/look/types";
import { AppliesPicker, PaletteEditor, RefVisual, StatusBadge, scopeLabel } from "./parts";

type Msg = { kind: "error" | "notice"; text: string } | null;
interface Props {
  projectId: string; canEdit: boolean; refs: LookRef[]; directions: LookDirection[]; entities: FilmEntity[];
  scenes: { number: number; heading: string }[]; onMessage: (m: Msg) => void; onOpenRef: (id: string) => void;
}

/** Approved, scoped directions that cover the same scene, character or location. */
export function overlaps(ds: LookDirection[]): [LookDirection, LookDirection, string[]][] {
  const s = ds.filter((d) => d.status === "approved" && !d.scope.film);
  const out: [LookDirection, LookDirection, string[]][] = [];
  for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) {
    const a = s[i].scope, b = s[j].scope;
    const both = [...(a.entities ?? []).filter((e) => (b.entities ?? []).includes(e)), ...(a.scenes ?? []).filter((n) => (b.scenes ?? []).includes(n)).map((n) => `scene:${n}`)];
    if (both.length) out.push([s[i], s[j], both]);
  }
  return out;
}

export function Swatches({ colors, size = "h-4 w-6" }: { colors: PaletteColor[]; size?: string }) {
  if (!colors.length) return null;
  return <span className="flex flex-wrap" aria-label={`Palette: ${colors.map((c) => c.hex).join(", ")}`}>{colors.slice(0, 12).map((c, i) => <span key={i} className={size} style={{ background: c.hex }} title={c.hex} />)}</span>;
}

export function Directions({ projectId, canEdit, refs, directions, entities, scenes, onMessage, onOpenRef }: Props) {
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const list = directions.filter((d) => showArchived || d.status !== "archived");
  const byId = new Map(refs.map((r) => [r.id, r]));
  const clash = overlaps(directions);
  const def = directions.find((d) => d.isDefault);
  const name = (k: string) => (k.startsWith("scene:") ? `scene ${k.slice(6)}` : entities.find((e) => e.id === k)?.name ?? "?");

  async function makeDefault(d: LookDirection | null) {
    const r = await setDefaultDirection({ projectId, directionId: d?.id ?? null });
    if (!r.ok) { onMessage({ kind: "error", text: r.error }); return; }
    onMessage({ kind: "notice", text: `${d ? `“${d.name}” is now the film's default look.` : "No default look now."}${r.n ? ` ${r.n} approved storyboard frame${r.n > 1 ? "s were" : " was"} flagged for review (nothing was redrawn).` : ""}` });
    refresh();
  }
  async function move(d: LookDirection, delta: -1 | 1) {
    const i = list.findIndex((x) => x.id === d.id), j = i + delta;
    if (j < 0 || j >= list.length) return;
    const before = delta < 0 ? list[j - 1]?.position : list[j].position;
    const after = delta < 0 ? list[j].position : list[j + 1]?.position;
    const pos = before == null ? after! - 1000 : after == null ? before + 1000 : (before + after) / 2;
    const r = await moveDirection({ projectId, directionId: d.id, position: pos });
    if (!r.ok) onMessage({ kind: "error", text: r.error }); else refresh();
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="display text-[22px]">Visual directions</h3>
          <p className="text-xs text-muted">Group references into a named look, like a feeling for part of the film. One approved direction can be the film&apos;s default; others can be set for scenes, characters or places, or kept to compare.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {directions.some((d) => d.status === "archived") && <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived</label>}
          {canEdit && <button type="button" className="btn" onClick={() => setEditing("new")} disabled={editing === "new"}>+ New direction</button>}
        </div>
      </div>
      {def ? <p className="text-sm">Film default: <b>{def.name}</b></p> : directions.length > 0 && <p className="text-xs text-muted">No default yet. Approve a direction, then make it the film&apos;s default.</p>}
      {clash.map(([a, b, both]) => (
        <p key={`${a.id}-${b.id}`} role="note" className="border-l-2 border-brand pl-2 text-xs">
          “{a.name}” and “{b.name}” are both approved for {both.map(name).join(", ")}. STUDIO won&apos;t mix them: in those storyboard frames you&apos;ll be asked which one to use.
        </p>
      ))}

      {editing === "new" && (
        <DirectionEditor projectId={projectId} d={null} refs={refs} entities={entities} scenes={scenes} onMessage={onMessage} onOpenRef={onOpenRef}
          onDone={(saved) => { setEditing(null); if (saved) refresh(); }} />
      )}

      {list.length === 0 && editing !== "new" ? <p className="help">No directions yet. A direction might be a feeling like “everyday warmth” or “cold and controlled”.</p> : (
        <ul className="flex flex-col gap-2">
          {list.map((d, i) => editing === d.id ? (
            <li key={d.id}><DirectionEditor projectId={projectId} d={d} refs={refs} entities={entities} scenes={scenes} onMessage={onMessage} onOpenRef={onOpenRef}
              onDone={(saved) => { setEditing(null); if (saved) refresh(); }} /></li>
          ) : (
            <li key={d.id} className={`flex flex-col gap-2 border p-3 ${d.isDefault ? "border-brand" : "border-line"} ${d.status === "archived" ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{d.name}</span>
                <StatusBadge status={d.status} />
                {d.isDefault && <span className="border border-brand px-1.5 py-0.5 text-[10px] font-semibold text-brand">Film default</span>}
                <span className="text-xs text-muted">{scopeLabel(d.scope, entities)} · version {d.version}</span>
                <label className="ml-auto flex items-center gap-1 text-xs"><input type="checkbox" checked={compare.includes(d.id)}
                  onChange={(e) => setCompare((c) => (e.target.checked ? [...c, d.id].slice(-3) : c.filter((x) => x !== d.id)))} /> Compare</label>
              </div>
              {d.intention && <p className="text-sm">{d.intention}</p>}
              <div className="flex flex-wrap items-center gap-2">
                {d.referenceIds.slice(0, 8).map((id) => byId.get(id)).filter(Boolean).map((r) => (
                  <button key={r!.id} type="button" className="size-14 overflow-hidden border border-line focus-visible:outline-2 focus-visible:outline-brand" onClick={() => onOpenRef(r!.id)} aria-label={`Open ${r!.title}`}>
                    <RefVisual r={r!} />
                  </button>
                ))}
                {d.referenceIds.length === 0 && <span className="text-xs text-muted">No references yet.</span>}
                <Swatches colors={d.palette} />
              </div>
              {canEdit && (
                <div className="flex flex-wrap gap-1 text-xs">
                  <button type="button" className="btn min-h-8 px-2 text-xs" onClick={() => setEditing(d.id)}>Edit</button>
                  {d.status === "approved" && !d.isDefault && <button type="button" className="btn min-h-8 px-2 text-xs" onClick={() => makeDefault(d)}>Make the film&apos;s default</button>}
                  {d.isDefault && <button type="button" className="btn min-h-8 px-2 text-xs" onClick={() => makeDefault(null)}>Stop being the default</button>}
                  <button type="button" className="btn min-h-8 px-2 text-xs" disabled={i === 0} onClick={() => move(d, -1)} aria-label={`Move ${d.name} up`}>↑</button>
                  <button type="button" className="btn min-h-8 px-2 text-xs" disabled={i === list.length - 1} onClick={() => move(d, 1)} aria-label={`Move ${d.name} down`}>↓</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {compare.length >= 2 && (
        <section aria-label="Compare directions" className="flex flex-col gap-2 border border-line p-3">
          <div className="flex items-center justify-between"><h4 className="font-semibold">Compare</h4><button type="button" className="text-xs underline" onClick={() => setCompare([])}>Close</button></div>
          <div className={`grid gap-3 ${compare.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
            {compare.map((id) => directions.find((d) => d.id === id)).filter(Boolean).map((d) => (
              <div key={d!.id} className="flex flex-col gap-2">
                <p className="font-semibold">{d!.name} <StatusBadge status={d!.status} /></p>
                {d!.intention && <p className="text-sm">{d!.intention}</p>}
                <div className="grid grid-cols-3 gap-1">{d!.referenceIds.map((rid) => byId.get(rid)).filter(Boolean).slice(0, 9).map((r) => <div key={r!.id} className="aspect-square overflow-hidden"><RefVisual r={r!} /></div>)}</div>
                {d!.palette.length > 0 && <div className="flex flex-wrap">{d!.palette.map((c, i) => <span key={i} className="px-1 py-2 font-mono text-[10px]" style={{ background: c.hex, color: inkOn(c.hex) }}>{c.hex}</span>)}</div>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function DirectionEditor({ projectId, d, refs, entities, scenes, onDone, onMessage, onOpenRef }: {
  projectId: string; d: LookDirection | null; refs: LookRef[]; entities: FilmEntity[]; scenes: { number: number; heading: string }[];
  onDone: (saved: boolean) => void; onMessage: (m: Msg) => void; onOpenRef: (id: string) => void;
}) {
  const [v, setV] = useState({ name: d?.name ?? "", intention: d?.intention ?? "", notes: d?.notes ?? "", status: d?.status ?? "draft",
    scope: (d?.scope ?? { film: true }) as Applies, palette: d?.palette ?? [], referenceIds: d?.referenceIds ?? [] });
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }));
  const chosen = v.referenceIds.map((id) => refs.find((r) => r.id === id)).filter((r): r is LookRef => !!r);
  const others = refs.filter((r) => !v.referenceIds.includes(r.id));
  const moveRef = (i: number, dlt: number) => { const n = [...v.referenceIds]; const j = i + dlt; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; set({ referenceIds: n }); };
  const fromRefs = () => {
    const add = chosen.flatMap((r) => r.palette).filter((c, i, a) => a.findIndex((x) => x.hex === c.hex) === i && !v.palette.some((p) => p.hex === c.hex));
    if (!add.length) { onMessage({ kind: "notice", text: "Its references have no colors yet. Open a reference to suggest or pick colors from it." }); return; }
    set({ palette: [...v.palette, ...add].slice(0, 24) });
  };

  async function save() {
    if (!v.name.trim()) { onMessage({ kind: "error", text: "Give the direction a name." }); return; }
    setBusy(true);
    const r = await saveDirection({ projectId, directionId: d?.id ?? null, expectedVersion: d?.version ?? null, data: {
      name: v.name.trim(), intention: v.intention, notes: v.notes, status: v.status, scope: v.scope, palette: v.palette, reference_ids: v.referenceIds } });
    setBusy(false);
    if (!r.ok) { onMessage({ kind: "error", text: r.conflict ? "This direction was changed somewhere else. Close it and open it again to see the latest." : r.error }); return; }
    onMessage({ kind: "notice", text: `Saved “${v.name.trim()}”${d && r.version !== d.version ? ` as version ${r.version}` : ""}.${r.n ? ` ${r.n} approved storyboard frame${r.n > 1 ? "s use" : " uses"} it and ${r.n > 1 ? "were" : "was"} flagged for review. Nothing was redrawn.` : ""}` });
    onDone(true);
  }

  return (
    <div className="flex flex-col gap-3 border border-brand p-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_12rem]">
        <label className="flex flex-col gap-1"><span className="label">Name</span>
          <input className="field" maxLength={80} value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Everyday warmth" autoFocus /></label>
        <label className="flex flex-col gap-1"><span className="label">Status</span>
          <select className="field" value={v.status} onChange={(e) => set({ status: e.target.value as typeof v.status })}>
            <option value="draft">Draft</option><option value="approved">Approved</option><option value="archived">Archived</option></select></label>
      </div>
      <label className="flex flex-col gap-1"><span className="label">What should this feel like?</span>
        <input className="field" maxLength={600} value={v.intention} onChange={(e) => set({ intention: e.target.value })} placeholder="One short sentence" /></label>
      <AppliesPicker value={v.scope} onChange={(s) => set({ scope: s })} entities={entities} scenes={scenes} />

      <div className="flex flex-col gap-2">
        <span className="label">References in this direction ({chosen.length})</span>
        {chosen.length > 0 && (
          <ol className="flex flex-col gap-1">
            {chosen.map((r, i) => (
              <li key={r.id} className="flex items-center gap-2 border border-line p-1 text-xs">
                <button type="button" className="size-10 shrink-0 overflow-hidden" onClick={() => onOpenRef(r.id)} aria-label={`Open ${r.title}`}><RefVisual r={r} /></button>
                <span className="min-w-0 flex-1 truncate">{i + 1}. {r.title}{r.useFor ? ` · use: ${r.useFor}` : ""}</span>
                <button type="button" className="px-1" onClick={() => moveRef(i, -1)} disabled={i === 0} aria-label={`Move ${r.title} up`}>↑</button>
                <button type="button" className="px-1" onClick={() => moveRef(i, 1)} disabled={i === chosen.length - 1} aria-label={`Move ${r.title} down`}>↓</button>
                <button type="button" className="px-1 text-danger" onClick={() => set({ referenceIds: v.referenceIds.filter((x) => x !== r.id) })} aria-label={`Take ${r.title} out of this direction`}>×</button>
              </li>
            ))}
          </ol>
        )}
        {others.length > 0 && (
          <div className="flex flex-wrap gap-1" role="group" aria-label="Add references">
            {others.map((r) => (
              <button key={r.id} type="button" className="flex items-center gap-1 border border-line p-0.5 pr-2 text-xs hover:border-brand" onClick={() => set({ referenceIds: [...v.referenceIds, r.id] })}>
                <span className="size-8 overflow-hidden"><RefVisual r={r} /></span>+ {r.title.slice(0, 24)}
              </button>
            ))}
          </div>
        )}
        {refs.length === 0 && <p className="text-xs text-muted">Add references above first.</p>}
      </div>

      <div className="flex flex-col gap-1">
        <span className="label">Palette (optional)</span>
        <PaletteEditor colors={v.palette} onChange={(p) => set({ palette: p })}
          extra={chosen.length > 0 ? <button type="button" className="btn min-h-8 px-2 text-xs" onClick={fromRefs}>Take colors from its references</button> : null} />
      </div>
      <label className="flex flex-col gap-1"><span className="label">Notes (optional)</span>
        <textarea className="field min-h-16" maxLength={2000} value={v.notes} onChange={(e) => set({ notes: e.target.value })} /></label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : d ? "Save direction" : "Create direction"}</button>
        <button type="button" className="btn" onClick={() => onDone(false)} disabled={busy}>Cancel</button>
        {d && <span className="text-xs text-muted">Saving keeps the earlier version. Approved storyboard frames that use it get a review note; nothing is redrawn.</span>}
      </div>
    </div>
  );
}
