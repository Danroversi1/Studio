"use client";
// Connections desk: knowledge collection → character. Visible, editable and explained; a
// connection is a rule about what a character COULD draw on, never "knows everything".
// Disconnecting deletes neither the character nor the collection. No model calls.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { previewKnowledgeLink, removeKnowledgeLink, saveKnowledgeLink } from "@/app/projects/[projectId]/connect-actions";
import { PURPOSE_LABEL, TEMPORAL_LABEL, USE_LABEL, type Purpose, type Temporal, type Use } from "@/lib/knowledge/eligibility";
import type { Beat, KnowledgeLink, SceneContext } from "@/lib/knowledge/connect-data";
import type { PreviewItem } from "@/lib/knowledge/connect-data";

export interface KCDraft { id: string | null; character_id: string; collection_id: string; purpose: Purpose; temporal: Temporal; scope: string; from_beat: string; note: string }

const blank = (character_id = "", collection_id = ""): KCDraft => ({ id: null, character_id, collection_id, purpose: "profession", temporal: "background", scope: "", from_beat: "", note: "" });
const fromLink = (l: KnowledgeLink): KCDraft => ({ id: l.id, character_id: l.character_id, collection_id: l.collection_id, purpose: l.purpose, temporal: l.temporal, scope: l.scope_terms.join(", "), from_beat: l.from_beat ?? "", note: l.note ?? "" });
const USE_TONE: Record<Use, string> = { in_world: "border-ok text-ok", background: "border-line text-text", adaptation: "border-warn text-warn", excluded: "border-line text-muted" };
const short = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function KnowledgeConnections({ projectId, canEdit, characters, collections, links, beats, scenes, contexts, focus, onFocusDone }: {
  projectId: string; canEdit: boolean; characters: { id: string; name: string }[]; collections: { id: string; name: string; count: number }[];
  links: KnowledgeLink[]; beats: Beat[]; scenes: { key: string; heading: string }[]; contexts: SceneContext[];
  focus: { linkId?: string; characterId?: string; collectionId?: string } | null; onFocusDone: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<KCDraft | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState<{ draft: KCDraft; scene: string; items: PreviewItem[] | null; error?: string } | null>(null);

  useEffect(() => {
    if (!focus) return;
    const l = focus.linkId ? links.find((x) => x.id === focus.linkId) : links.find((x) => x.character_id === focus.characterId && x.collection_id === focus.collectionId);
    setDraft(l ? fromLink(l) : blank(focus.characterId, focus.collectionId));
    onFocusDone();
    requestAnimationFrame(() => document.getElementById("kc-form")?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }, [focus, links, onFocusDone]);

  const nameOf = (id: string, list: { id: string; name: string }[]) => list.find((x) => x.id === id)?.name ?? "—";
  const dateOf = (key: string) => contexts.find((c) => c.scene_key === key)?.story_date ?? null;
  const beatLabel = (id: string) => { const i = beats.findIndex((b) => b.id === id); return i < 0 ? "an outline beat" : `beat ${i + 1}: ${short(beats[i].text, 50)}`; };

  function save(d: KCDraft) {
    setMsg(null);
    start(async () => {
      const data = { character_id: d.character_id, collection_id: d.collection_id, purpose: d.purpose, temporal: d.temporal,
        scope_terms: d.scope.split(",").map((x) => x.trim()).filter(Boolean), from_beat: d.temporal === "story_dated" ? d.from_beat : "", note: d.note };
      const r = await saveKnowledgeLink({ projectId, linkId: d.id, data }).catch(() => ({ ok: false as const, error: "That didn't save." }));
      if (r.ok) { setMsg({ kind: "ok", text: d.id ? "Connection updated." : "Connected." }); setDraft(null); router.refresh(); }
      else setMsg({ kind: "error", text: r.error });
    });
  }
  function remove(l: KnowledgeLink) {
    if (!window.confirm(`Disconnect ${nameOf(l.collection_id, collections)} from ${nameOf(l.character_id, characters)}? Both stay as they are.`)) return;
    start(async () => {
      const r = await removeKnowledgeLink({ projectId, linkId: l.id }).catch(() => ({ ok: false as const, error: "That didn't save." }));
      if (r.ok) { setMsg({ kind: "ok", text: "Disconnected. The character and the collection are unchanged." }); router.refresh(); }
      else setMsg({ kind: "error", text: r.error });
    });
  }
  async function runPreview(d: KCDraft, scene: string) {
    setPreview({ draft: d, scene, items: null });
    const rule = { collection_id: d.collection_id, purpose: d.purpose, temporal: d.temporal, scope_terms: d.scope.split(",").map((x) => x.trim()).filter(Boolean), from_beat: d.temporal === "story_dated" && d.from_beat ? d.from_beat : null };
    const r = await previewKnowledgeLink({ projectId, rule, sceneKey: scene || null }).catch(() => ({ ok: false as const, error: "The preview didn't load." }));
    setPreview({ draft: d, scene, items: r.ok ? r.items : [], error: r.ok ? undefined : r.error });
  }

  const byChar = useMemo(() => characters.map((c) => ({ c, ls: links.filter((l) => l.character_id === c.id) })).filter((x) => x.ls.length), [characters, links]);

  return (
    <section className="panel flex flex-col gap-4 p-5" aria-labelledby="kc-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="kc-h" className="display text-[22px]">Knowledge → characters</h2>
        <Link href={`/projects/${projectId}/knowledge`} className="text-xs text-accent">Open the Knowledge Base →</Link>
      </div>
      <p className="max-w-3xl text-sm text-muted">
        Connecting a collection lets a character draw on it, within the purpose and time you set. It doesn&apos;t make them know everything in it.
        What they actually know stays in their profile.
      </p>

      {byChar.length ? (
        <ul className="flex flex-col gap-3">
          {byChar.map(({ c, ls }) => (
            <li key={c.id} className="flex flex-col gap-1.5">
              <p className="text-sm font-semibold">{c.name}</p>
              <ul className="flex flex-col divide-y divide-line border-y border-line">
                {ls.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span className="min-w-0">
                      <b>{nameOf(l.collection_id, collections)}</b>
                      <span className="text-muted"> · {PURPOSE_LABEL[l.purpose]} · {TEMPORAL_LABEL[l.temporal].split(":")[0]}</span>
                      {l.scope_terms.length > 0 && <span className="text-muted"> · only about {l.scope_terms.join(", ")}</span>}
                      {l.from_beat && <span className="text-muted"> · from {beatLabel(l.from_beat)}</span>}
                      {l.note && <span className="block text-xs text-muted">{l.note}</span>}
                    </span>
                    <span className="flex shrink-0 gap-1.5">
                      <button type="button" className="btn min-h-8 text-xs" onClick={() => void runPreview(fromLink(l), "")}>What could {c.name} draw from this?</button>
                      {canEdit && <button type="button" className="btn min-h-8 text-xs" onClick={() => setDraft(fromLink(l))}>Edit</button>}
                      {canEdit && <button type="button" className="btn min-h-8 text-xs" disabled={pending} onClick={() => remove(l)}>Disconnect</button>}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted">No collections are connected to characters yet.</p>}

      {canEdit && !draft && (
        <div>
          <button type="button" className="btn min-h-9 text-xs" disabled={!characters.length || !collections.length} onClick={() => setDraft(blank(characters[0]?.id, collections[0]?.id))}>
            + Connect a collection to a character</button>
          {(!characters.length || !collections.length) && <p className="mt-1 text-xs text-muted">{!collections.length ? "Make a collection in the Knowledge Base first." : "Add a character to your story first."}</p>}
          {characters.length > 0 && collections.length > 0 && <p className="mt-1 text-xs text-muted">Or drag from a character&apos;s pin to a collection card on the board.</p>}
        </div>
      )}

      {draft && (
        <form id="kc-form" className="flex flex-col gap-3 border border-line bg-panel-2 p-4" onSubmit={(e) => { e.preventDefault(); save(draft); }}>
          <p className="text-sm font-semibold">{draft.id ? "Edit connection" : "New connection"}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="text-xs text-muted">Character
              <select className="field mt-1" value={draft.character_id} disabled={!!draft.id} onChange={(e) => setDraft({ ...draft, character_id: e.target.value })}>
                {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="text-xs text-muted">Collection
              <select className="field mt-1" value={draft.collection_id} disabled={!!draft.id} onChange={(e) => setDraft({ ...draft, collection_id: e.target.value })}>
                {collections.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.count})</option>)}
              </select>
            </label>
          </div>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-xs text-muted">What is it to them?</legend>
            {(Object.keys(PURPOSE_LABEL) as Purpose[]).map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm">
                <input type="radio" name="purpose" checked={draft.purpose === p}
                  onChange={() => setDraft({ ...draft, purpose: p, temporal: p === "story_info" ? "story_dated" : p === "profession" || p === "interests" || p === "belief" ? (draft.temporal === "story_dated" ? "background" : draft.temporal) : draft.temporal })} />
                {PURPOSE_LABEL[p]}
              </label>
            ))}
          </fieldset>
          {draft.purpose !== "director_only" && (
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 text-xs text-muted">How does time work?</legend>
              {(Object.keys(TEMPORAL_LABEL) as Temporal[]).map((t) => (
                <label key={t} className="flex items-start gap-2 text-sm"><input type="radio" name="temporal" className="mt-1" checked={draft.temporal === t} onChange={() => setDraft({ ...draft, temporal: t })} />{TEMPORAL_LABEL[t]}</label>
              ))}
            </fieldset>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="text-xs text-muted">Only about… (optional, comma-separated words)
              <input className="field mt-1" value={draft.scope} maxLength={600} placeholder="chips, export, Taiwan" onChange={(e) => setDraft({ ...draft, scope: e.target.value })} />
            </label>
            {draft.temporal === "story_dated" && draft.purpose !== "director_only" && (
              <label className="text-xs text-muted">They learn it from… (optional)
                <select className="field mt-1" value={draft.from_beat} onChange={(e) => setDraft({ ...draft, from_beat: e.target.value })}>
                  <option value="">From the start of the story</option>
                  {beats.map((b, i) => <option key={b.id} value={b.id}>{`Beat ${i + 1}: ${short(b.text, 60)}`}</option>)}
                </select>
              </label>
            )}
          </div>
          <label className="text-xs text-muted">Note (optional)
            <input className="field mt-1" value={draft.note} maxLength={1000} placeholder="Why this matters to them" onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary min-h-9 text-xs" disabled={pending}>{pending ? "Saving…" : draft.id ? "Save" : "Connect"}</button>
            <button type="button" className="btn min-h-9 text-xs" onClick={() => void runPreview(draft, "")}>Preview first</button>
            <button type="button" className="btn min-h-9 text-xs" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </form>
      )}
      {msg && <p role={msg.kind === "error" ? "alert" : "status"} className={`text-xs ${msg.kind === "error" ? "text-danger" : "text-muted"}`}>{msg.text}</p>}

      {preview && (
        <div className="flex flex-col gap-2 border border-line p-4" aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold">What could {nameOf(preview.draft.character_id, characters)} draw from {nameOf(preview.draft.collection_id, collections)}?</p>
            <button type="button" className="text-xs text-muted underline" onClick={() => setPreview(null)}>Close</button>
          </div>
          <label className="text-xs text-muted">In which scene?
            <select className="field mt-1" value={preview.scene} onChange={(e) => void runPreview(preview.draft, e.target.value)}>
              <option value="">No particular scene</option>
              {scenes.map((s, i) => <option key={s.key} value={s.key}>{`${i + 1}. ${s.heading}${dateOf(s.key) ? ` (${dateOf(s.key)})` : " (no story date)"}`}</option>)}
            </select>
          </label>
          {preview.draft.temporal === "story_dated" && !preview.scene && <p className="text-xs text-muted">Story-dated research depends on a scene&apos;s story date. Pick a scene; set dates on the Script desk.</p>}
          {preview.items === null ? <p className="text-sm text-muted">Looking…</p> : preview.error ? <p className="text-sm text-danger">{preview.error}</p> : (
            <>
              <p className="text-xs text-muted">
                {(["in_world", "background", "adaptation", "excluded"] as Use[]).map((u) => `${preview.items!.filter((i) => i.use === u).length} ${USE_LABEL[u].toLowerCase()}`).join(" · ")}
              </p>
              <p className="text-xs text-muted">Even when material is available, whether {nameOf(preview.draft.character_id, characters)} has actually seen it is your call. Add it to their profile under &ldquo;What they know&rdquo; to make it certain.</p>
              <ul className="flex max-h-80 flex-col divide-y divide-line overflow-y-auto">
                {preview.items.map((i) => (
                  <li key={i.id} className="flex flex-col gap-0.5 py-2 text-sm">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={`border px-1.5 py-0.5 text-[10px] font-semibold ${USE_TONE[i.use]}`}>{USE_LABEL[i.use]}</span>
                      <span className={i.use === "excluded" ? "text-muted" : ""}>{i.title}</span>
                    </span>
                    <span className="text-xs text-muted">{i.source}{i.published_at ? ` · ${i.published_at.slice(0, 10)}` : " · date unknown"} · {i.reason}</span>
                  </li>
                ))}
                {!preview.items.length && <li className="py-2 text-sm text-muted">This collection is empty.</li>}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
