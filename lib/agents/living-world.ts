// SERVER ONLY. "The living world" for the Storybuilder: the current state of every knowledge
// base and rule set, as compact text for its snapshot. Plain reads, no model. The renderer is
// pure (tested). It's live material, not canon: the partner grounds recommendations in it and
// says what it drew on; nothing here becomes story until she decides.
import type { SupabaseClient } from "@supabase/supabase-js";
import { roleOf, ROLE_LABEL } from "../characters/roles";
import { isTracked, ruleSentence, type SimRule } from "../sim/rules";
import { getSociety } from "../society/data";
import { forPrompt } from "../society/score";
import { moodLabel, showMood } from "../mood/score";

type Db = SupabaseClient;

export interface LivingCharacter {
  name: string; role: string | null; tracked: boolean;
  mood: { score: number; label: string; day: string; why: string[] } | null;
  rules: string[]; interests: string[]; avoid: string[]; follows: string[];
  coverage: { day: string; titles: string[] } | null;
  knows: Record<string, string>;
  collections: { name: string; purpose: string; items: number }[];
}
export interface LivingWorld {
  storyDay: number | null; storyDate: string | null;
  approved: { day: number; title: string; what: string }[]; openProposals: number;
  worldTopics: string[]; worldHeadlines: { title: string; outlet: string; date: string | null }[];
  worldRules: string[];
  society: ReturnType<typeof forPrompt>; polls: { title: string; publisher: string; date: string | null }[];
  characters: LivingCharacter[];
}

const KNOW_KEYS: [string, string][] = [["knows", "knows"], ["beliefs", "believes"], ["wants", "wants"], ["fears", "fears"], ["misbeliefs", "wrongly believes"], ["conceals", "hides"]];
const cut = (s: string, n: number) => { const t = (s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export async function loadLivingWorld(db: Db, projectId: string): Promise<LivingWorld> {
  const [{ data: st }, { data: evs }, { count: openCount }, { data: ents }, { data: rules }, { data: worldColl }, { data: watches }] = await Promise.all([
    db.from("sim_settings").select("clock_day, start_date").eq("project_id", projectId).maybeSingle(),
    db.from("sim_events").select("id, day, approved_version").eq("project_id", projectId).eq("status", "approved").order("day", { ascending: false }).order("decided_at", { ascending: false }).limit(10),
    db.from("sim_events").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("status", "proposed"),
    db.from("entities").select("id, name, metadata").eq("project_id", projectId).eq("kind", "character").is("archived_at", null).neq("status", "archived").order("created_at"),
    db.from("sim_rules").select("*").eq("project_id", projectId).eq("enabled", true).is("archived_at", null).order("created_at"),
    db.from("knowledge_collections").select("id").eq("project_id", projectId).eq("kind", "world").is("archived_at", null).maybeSingle(),
    db.from("knowledge_sources").select("watch_query").eq("project_id", projectId).is("archived_at", null).is("disconnected_at", null).not("watch_query", "is", null).is("watch_character", null),
  ]);
  // Story so far (approved events, their approved versions).
  const evList = (evs ?? []) as { id: string; day: number; approved_version: number }[];
  const { data: vers } = evList.length ? await db.from("sim_event_versions").select("event_id, version, data").in("event_id", evList.map((e) => e.id)) : { data: [] };
  const approved = evList.map((e) => {
    const d = ((vers ?? []) as { event_id: string; version: number; data: { title: string; description: string } }[]).find((v) => v.event_id === e.id && v.version === e.approved_version)?.data;
    return d ? { day: e.day, title: d.title, what: d.description } : null;
  }).filter(Boolean).reverse() as LivingWorld["approved"];

  // World headlines: the newest items in the World collection.
  let worldHeadlines: LivingWorld["worldHeadlines"] = [];
  if (worldColl?.id) {
    const { data: mem } = await db.from("knowledge_collection_members").select("source_id, item_id").eq("collection_id", worldColl.id);
    const srcIds = ((mem ?? []) as { source_id: string | null }[]).map((m) => m.source_id).filter(Boolean) as string[];
    if (srcIds.length) {
      const [{ data: items }, { data: srcs }] = await Promise.all([
        db.from("knowledge_items").select("title, source_id, published_at, retrieved_at").in("source_id", srcIds).is("archived_at", null).order("retrieved_at", { ascending: false }).limit(14),
        db.from("knowledge_sources").select("id, title").in("id", srcIds),
      ]);
      const t = new Map(((srcs ?? []) as { id: string; title: string }[]).map((s) => [s.id, s.title]));
      worldHeadlines = ((items ?? []) as { title: string; source_id: string; published_at: string | null }[]).map((i) => ({ title: i.title, outlet: t.get(i.source_id) ?? "", date: i.published_at?.slice(0, 10) ?? null }));
    }
  }

  const society = await getSociety(db, projectId).catch(() => null);
  const ruleList = (rules ?? []) as SimRule[];
  const chars = (ents ?? []) as { id: string; name: string; metadata: Record<string, unknown> | null }[];
  const ids = chars.map((c) => c.id);
  const [{ data: bubbles }, { data: snaps }, { data: moods }, { data: profs }, { data: links }, { data: ownFeeds }] = ids.length ? await Promise.all([
    db.from("character_bubbles").select("character_id, topics, avoid").in("character_id", ids),
    db.from("bubble_snapshots").select("character_id, run_date, items").in("character_id", ids).order("run_date", { ascending: false }).limit(ids.length * 2),
    db.from("mood_days").select("character_id, day, score, override, judgments, payload").in("character_id", ids).not("score", "is", null).order("day", { ascending: false }).limit(ids.length * 3),
    db.from("character_profiles").select("entity_id, confirmed").in("entity_id", ids),
    db.from("character_knowledge").select("character_id, collection_id, purpose").in("character_id", ids).is("archived_at", null),
    db.from("knowledge_sources").select("watch_character, title, watch_query").in("watch_character", ids).is("archived_at", null).is("disconnected_at", null),
  ]) : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }];
  const collIds = [...new Set(((links ?? []) as { collection_id: string }[]).map((l) => l.collection_id))];
  const [{ data: colls }, { data: cmem }] = collIds.length ? await Promise.all([
    db.from("knowledge_collections").select("id, name").in("id", collIds).is("archived_at", null),
    db.from("knowledge_collection_members").select("collection_id, source_id, item_id").in("collection_id", collIds),
  ]) : [{ data: [] }, { data: [] }];
  const memSrc = [...new Set(((cmem ?? []) as { source_id: string | null }[]).map((m) => m.source_id).filter(Boolean) as string[])];
  const { data: counts } = memSrc.length ? await db.from("knowledge_items").select("source_id").in("source_id", memSrc).is("archived_at", null).limit(5000) : { data: [] };
  const perSource = new Map<string, number>();
  for (const r of (counts ?? []) as { source_id: string }[]) perSource.set(r.source_id, (perSource.get(r.source_id) ?? 0) + 1);

  const characters: LivingCharacter[] = chars.map((c) => {
    const role = roleOf(c.metadata);
    const b = ((bubbles ?? []) as { character_id: string; topics: string[]; avoid: string[] }[]).find((x) => x.character_id === c.id);
    const snap = ((snaps ?? []) as { character_id: string; run_date: string; items: { title: string }[] }[]).find((x) => x.character_id === c.id);
    const m = ((moods ?? []) as { character_id: string; day: string; score: number; override: number | null; judgments: { rule_id: string; item_key: string; relation: number; reason: string }[]; payload: { items?: { key: string; title: string }[] } }[]).find((x) => x.character_id === c.id);
    const conf = (((profs ?? []) as { entity_id: string; confirmed: Record<string, string> }[]).find((p) => p.entity_id === c.id)?.confirmed) ?? {};
    const score = m ? Number(m.override ?? m.score) : null;
    return {
      name: c.name, role, tracked: isTracked(role),
      mood: m && score !== null ? { score, label: moodLabel(score), day: m.day, why: (m.judgments ?? []).slice(0, 4).map((j) => `${j.relation > 0 ? "in tune" : "at odds"}: “${cut((m.payload?.items ?? []).find((i) => i.key === j.item_key)?.title ?? "an item", 90)}” (${cut(j.reason, 100)})`) } : null,
      rules: ruleList.filter((r) => r.family === "character" && r.character_id === c.id).map((r) => ruleSentence(r, c.name)),
      interests: b?.topics ?? [], avoid: b?.avoid ?? [],
      follows: ((ownFeeds ?? []) as { watch_character: string; title: string; watch_query: string | null }[]).filter((f) => f.watch_character === c.id && !f.watch_query).map((f) => f.title),
      coverage: snap ? { day: snap.run_date, titles: (snap.items ?? []).slice(0, 6).map((i) => i.title) } : null,
      knows: Object.fromEntries(KNOW_KEYS.filter(([k]) => conf[k]?.trim()).map(([k, label]) => [label, cut(String(conf[k]), 300)])),
      collections: ((links ?? []) as { character_id: string; collection_id: string; purpose: string }[]).filter((l) => l.character_id === c.id).map((l) => {
        const name = ((colls ?? []) as { id: string; name: string }[]).find((x) => x.id === l.collection_id)?.name;
        const items = ((cmem ?? []) as { collection_id: string; source_id: string | null; item_id: string | null }[]).filter((x) => x.collection_id === l.collection_id)
          .reduce((a, x) => a + (x.source_id ? perSource.get(x.source_id) ?? 0 : x.item_id ? 1 : 0), 0);
        return name ? { name, purpose: l.purpose, items } : null;
      }).filter(Boolean) as LivingCharacter["collections"],
    };
  });

  return {
    storyDay: st?.clock_day ? Number(st.clock_day) : null, storyDate: (st?.start_date as string | null) ?? null,
    approved, openProposals: openCount ?? 0,
    worldTopics: [...new Set(((watches ?? []) as { watch_query: string }[]).map((w) => w.watch_query))],
    worldHeadlines, worldRules: ruleList.filter((r) => r.family === "periphery").map((r) => ruleSentence(r, null)),
    society: society ? forPrompt(society.moods).filter((x) => x.mood_0_10 !== null) : [],
    polls: (society?.reports ?? []).slice(0, 6).map((r) => ({ title: r.title, publisher: r.publisher, date: r.published_at?.slice(0, 10) ?? null })),
    characters,
  };
}

const PURPOSE: Record<string, string> = { profession: "their work", interests: "their interests", story_info: "story information", belief: "beliefs", director_only: "for you only (they don't know it)" };

/** The compact text block added to the Storybuilder's snapshot. */
export function renderLivingWorld(w: LivingWorld): string {
  const L: string[] = [];
  L.push(`Story time: ${w.storyDay ? `day ${w.storyDay}${w.storyDate ? ` (day 1 = ${w.storyDate})` : ""}` : "the day-by-day simulation hasn't started"}${w.openProposals ? `; ${w.openProposals} proposed event(s) waiting for her review` : ""}.`);
  L.push(`Story so far (events she approved, oldest first):${w.approved.length ? "" : " none yet"}`);
  for (const e of w.approved) L.push(`- Day ${e.day}: ${cut(e.title, 100)} — ${cut(e.what, 200)}`);
  L.push("", `How the world works (her world rules):${w.worldRules.length ? "" : " none yet"}`);
  for (const r of w.worldRules) L.push(`- ${cut(r, 220)}`);
  L.push("", `World knowledge base — topics she follows: ${w.worldTopics.length ? w.worldTopics.map((t) => cut(t, 60)).join("; ") : "none yet"}`);
  if (w.worldHeadlines.length) {
    L.push("Newest real-world headlines (outside sources, not story facts):");
    for (const h of w.worldHeadlines) L.push(`- “${cut(h.title, 140)}” (${cut(h.outlet, 50)}${h.date ? `, ${h.date}` : ""})`);
  }
  if (w.society.length) {
    L.push("", "Society's mood (public surveys; 0 = gloomiest in 10 years, 10 = most upbeat):");
    for (const s of w.society) L.push(`- ${s.region} ${s.theme}: ${s.mood_0_10}/10 ${s.mood}${s.trend ? `, ${s.trend} than last month` : ""} (as of ${s.as_of})`);
    if (w.polls.length) L.push(`Recent polls: ${w.polls.map((p) => `“${cut(p.title, 90)}” (${p.publisher})`).join("; ")}`);
  }
  L.push("", "Characters now:");
  for (const c of w.characters) {
    const role = c.role ? ROLE_LABEL[c.role as keyof typeof ROLE_LABEL] ?? c.role : "no role yet";
    if (!c.tracked) { L.push(`- ${c.name} [${role}; a voice of society, feelings not tracked]`); continue; }
    L.push(`- ${c.name} [${role}]`);
    L.push(`  how they're doing: ${c.mood ? `${showMood(c.mood.score)}/10 ${c.mood.label} (${c.mood.day})${c.mood.why.length ? ` — ${c.mood.why.join("; ")}` : ""}` : "not worked out yet"}`);
    if (c.rules.length) L.push(`  their rules: ${c.rules.map((r) => cut(r, 160)).join(" | ")}`);
    if (c.interests.length || c.avoid.length) L.push(`  into: ${c.interests.join(", ") || "—"}${c.avoid.length ? `; avoids: ${c.avoid.join(", ")}` : ""}`);
    if (c.follows.length) L.push(`  follows: ${c.follows.map((f) => cut(f, 60)).join(", ")}`);
    if (c.coverage?.titles.length) L.push(`  around them lately (${c.coverage.day}, not necessarily read): ${c.coverage.titles.map((t) => `“${cut(t, 90)}”`).join("; ")}`);
    for (const [k, v] of Object.entries(c.knows)) L.push(`  ${k}: ${v}`);
    if (c.collections.length) L.push(`  knowledge they draw on: ${c.collections.map((k) => `${k.name} (${PURPOSE[k.purpose] ?? k.purpose}, ${k.items} items)`).join("; ")}`);
  }
  return L.join("\n");
}
