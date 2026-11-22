// Loads the Knowledge Timeline for a film, and renders what each character's agent may be
// told. Works with the service client or her own (RLS) client. The future buffer is only
// ever rendered for an antagonist with the permission, or for the Director herself.
import { roleOf, type CastRole } from "../characters/roles";
import { METHOD_LABEL, type Access, type Method, dayLabel, itemDay, reachLabel, reachOf, realDateOf, tierOf, type Tier } from "./timeline";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any };

export interface TlCharacter { id: string; name: string; role: CastRole | null; access: Access | null; tier: Tier; reach: number; label: string }
export interface TlItem { id: string; title: string; url: string | null; day: number; source: string; source_id: string; version: number }
export interface TlDiscovery { id: string; character_id: string; day: number; method: Method; what: string; how: string | null; item_id: string | null; item_day: number | null; created_at: string }
export interface TlPrediction { id: string; character_id: string; day: number; prediction: string; evidence: { discovery_ids?: string[]; item_ids?: string[] }; status: string; outcome_note: string | null }
export interface TlIntervention { id: string; character_id: string; day: number; action: string; expected_change: string | null; prediction_id: string | null; discovery_ids: string[]; outcome: string | null }
export interface TlFlag { id: string; item_id: string | null; intervention_id: string; original: { title: string; item_day: number; flagged_on_day: number; known_by: string[]; url?: string | null }; status: string; revised: string | null }
export interface TlBriefing { id: string; from_character: string | null; to_character: string; day: number; kind: string; content: string; item_ids: string[]; flag_ids: string[] }
export interface Timeline {
  anchor: string; anchorSet: boolean; anchorLocked: boolean; worldDay: number; worldDate: string; collectedThrough: number;
  characters: TlCharacter[];
  /** Collected items after the current world day (the buffer), newest last. */
  buffer: TlItem[];
  /** Items on the current day and the day before: what Johnny's feeds haven't reached yet. */
  recent: TlItem[];
  /** Per antagonist: the source ids and item ids they're permitted to draw on. */
  permitted: Record<string, { sources: string[]; items: string[] }>;
  discoveries: TlDiscovery[]; predictions: TlPrediction[]; interventions: TlIntervention[]; flags: TlFlag[]; briefings: TlBriefing[];
}

export async function loadTimeline(db: Db, projectId: string): Promise<Timeline> {
  const [{ data: st }, { data: ents }, { data: firstBubble }, { data: acc }] = await Promise.all([
    db.from("sim_settings").select("clock_day, buffer_anchor").eq("project_id", projectId).maybeSingle(),
    db.from("entities").select("id, name, metadata").eq("project_id", projectId).eq("kind", "character").is("archived_at", null).neq("status", "archived").order("created_at"),
    db.from("bubble_snapshots").select("run_date, entities!inner(project_id)").eq("entities.project_id", projectId).order("run_date", { ascending: true }).limit(1).maybeSingle(),
    db.from("knowledge_future_access").select("character_id, enabled, ahead_days").eq("project_id", projectId),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const anchor = String(st?.buffer_anchor ?? firstBubble?.run_date ?? today).slice(0, 10);
  const worldDay = Number(st?.clock_day ?? 0) + 1;
  const accessOf = new Map(((acc ?? []) as { character_id: string; enabled: boolean; ahead_days: number }[]).map((a) => [a.character_id, { enabled: a.enabled, ahead_days: a.ahead_days }]));

  // Items from the day before the current one onward: the buffer and the recent gap.
  const from = realDateOf(worldDay - 1, anchor);
  const { data: rows } = await db.from("knowledge_items").select("id, title, url, published_at, retrieved_at, source_id, version, knowledge_sources!inner(title, archived_at)")
    .eq("project_id", projectId).is("archived_at", null).or(`published_at.gte.${from},and(published_at.is.null,retrieved_at.gte.${from})`)
    .order("retrieved_at", { ascending: false }).limit(600);
  const items: TlItem[] = ((rows ?? []) as { id: string; title: string; url: string | null; published_at: string | null; retrieved_at: string; source_id: string; version: number; knowledge_sources: { title: string; archived_at: string | null } }[])
    .filter((r) => !r.knowledge_sources.archived_at)
    .map((r) => ({ id: r.id, title: r.title, url: r.url, day: itemDay(r, anchor), source: r.knowledge_sources.title.replace(/^(Stopped: )?(News: |Reactions: )?/, ""), source_id: r.source_id, version: r.version }))
    .sort((a, b) => a.day - b.day);
  const collectedThrough = Math.max(worldDay, ...items.map((i) => i.day));

  const characters: TlCharacter[] = ((ents ?? []) as { id: string; name: string; metadata: Record<string, unknown> | null }[]).map((e) => {
    const role = roleOf(e.metadata);
    const access = accessOf.get(e.id) ?? null;
    return { id: e.id, name: e.name, role, access, tier: tierOf(role, access), reach: reachOf(role, access, worldDay), label: reachLabel(role, access, worldDay, collectedThrough) };
  });

  // Permitted sources for each antagonist with access: the World, their collections, their own searches.
  const permitted: Timeline["permitted"] = {};
  const ahead = characters.filter((c) => c.tier === "ahead");
  if (ahead.length) {
    const [{ data: world }, { data: links }, { data: own }] = await Promise.all([
      db.from("knowledge_collections").select("id").eq("project_id", projectId).eq("kind", "world").is("archived_at", null).maybeSingle(),
      db.from("character_knowledge").select("character_id, collection_id").in("character_id", ahead.map((c) => c.id)).is("archived_at", null).neq("purpose", "director_only"),
      db.from("knowledge_sources").select("id, watch_character").in("watch_character", ahead.map((c) => c.id)).is("archived_at", null).is("disconnected_at", null),
    ]);
    const colIds = [...new Set([...(world ? [world.id] : []), ...((links ?? []) as { collection_id: string }[]).map((l) => l.collection_id)])];
    const { data: mem } = colIds.length ? await db.from("knowledge_collection_members").select("collection_id, source_id, item_id").in("collection_id", colIds) : { data: [] };
    for (const c of ahead) {
      const cols = new Set([...(world ? [world.id] : []), ...((links ?? []) as { character_id: string; collection_id: string }[]).filter((l) => l.character_id === c.id).map((l) => l.collection_id)]);
      const ms = ((mem ?? []) as { collection_id: string; source_id: string | null; item_id: string | null }[]).filter((m) => cols.has(m.collection_id));
      permitted[c.id] = {
        sources: [...new Set([...ms.map((m) => m.source_id).filter(Boolean) as string[], ...((own ?? []) as { id: string; watch_character: string }[]).filter((o) => o.watch_character === c.id).map((o) => o.id)])],
        items: [...new Set(ms.map((m) => m.item_id).filter(Boolean) as string[])],
      };
    }
  }

  const [{ data: disc }, { data: pred }, { data: intv }, { data: flags }, { data: brief }] = await Promise.all([
    db.from("knowledge_discoveries").select("id, character_id, day, method, what, how, item_id, item_day, created_at").eq("project_id", projectId).order("created_at"),
    db.from("knowledge_predictions").select("id, character_id, day, prediction, evidence, status, outcome_note").eq("project_id", projectId).order("created_at"),
    db.from("knowledge_interventions").select("id, character_id, day, action, expected_change, prediction_id, discovery_ids, outcome").eq("project_id", projectId).order("created_at"),
    db.from("knowledge_trajectory_flags").select("id, item_id, intervention_id, original, status, revised").eq("project_id", projectId).order("created_at"),
    db.from("knowledge_briefings").select("id, from_character, to_character, day, kind, content, item_ids, flag_ids").eq("project_id", projectId).order("created_at"),
  ]);
  return {
    anchor, anchorSet: !!st?.buffer_anchor, anchorLocked: Number(st?.clock_day ?? 0) > 0, worldDay, worldDate: realDateOf(worldDay, anchor), collectedThrough,
    characters, buffer: items.filter((i) => i.day > worldDay), recent: items.filter((i) => i.day >= worldDay - 1 && i.day <= worldDay), permitted,
    discoveries: (disc ?? []) as TlDiscovery[], predictions: (pred ?? []) as TlPrediction[], interventions: (intv ?? []) as TlIntervention[],
    flags: (flags ?? []) as TlFlag[], briefings: (brief ?? []) as TlBriefing[],
  };
}

/** The buffer an antagonist may see now: within their window and from permitted sources. */
export function bufferFor(tl: Timeline, characterId: string): TlItem[] {
  const c = tl.characters.find((x) => x.id === characterId);
  if (!c || c.tier !== "ahead") return [];
  const p = tl.permitted[characterId] ?? { sources: [], items: [] };
  return tl.buffer.filter((i) => i.day <= c.reach && (p.sources.includes(i.source_id) || p.items.includes(i.id)));
}

/** Item ids a character has opened by discovery. */
export function discoveredItems(tl: Timeline, characterId: string): Set<string> {
  return new Set(tl.discoveries.filter((d) => d.character_id === characterId && d.item_id).map((d) => d.item_id as string));
}

/** Can this character draw on an item from story day `day` (routine reach or a discovery)? */
export function reachableDay(tl: Timeline, characterId: string, day: number, itemId?: string): boolean {
  if (itemId && discoveredItems(tl, characterId).has(itemId)) return true;
  const c = tl.characters.find((x) => x.id === characterId);
  const reach = c ? c.reach : tl.worldDay;
  if (day <= Math.min(reach, tl.worldDay)) return true;
  // Past the present: only an antagonist's permitted buffer.
  return day > tl.worldDay && c?.tier === "ahead" && !!itemId && bufferFor(tl, characterId).some((i) => i.id === itemId);
}

const name = (tl: Timeline, id: string | null) => (id ? tl.characters.find((c) => c.id === id)?.name ?? "someone" : "an updated briefing");

/** What one character's agent may be told. Never the buffer unless they hold the permission;
 *  never anyone's private discoveries, predictions or interventions but their own. */
export function renderForCharacter(tl: Timeline, characterId: string): string {
  const c = tl.characters.find((x) => x.id === characterId);
  if (!c) return "";
  const lines = [`Knowledge timeline: the world is on Day ${tl.worldDay}. ${c.name}: ${c.label}`];
  if (c.tier === "behind") {
    lines.push(`${c.name}'s routine news and media lag one day behind the world. They still experience the present directly (what happens to them, what they see, who they talk to), and can close particular gaps by observation, conversations, research, forensic evidence, testing hypotheses and recognizing patterns. Their predictions must come only from evidence below and their own reasoning; never assume knowledge of what comes next.`);
    const mine = tl.discoveries.filter((d) => d.character_id === c.id);
    if (mine.length) lines.push(`Gaps ${c.name} has closed:\n${mine.map((d) => `- Day ${d.day}, by ${METHOD_LABEL[d.method].toLowerCase()}: ${d.what}${d.how ? ` (${d.how})` : ""}`).join("\n")}`);
    const preds = tl.predictions.filter((p) => p.character_id === c.id);
    if (preds.length) lines.push(`${c.name}'s own predictions:\n${preds.map((p) => `- Day ${p.day}: ${p.prediction} [${p.status.replace("_", " ")}]`).join("\n")}`);
    const acts = tl.interventions.filter((i) => i.character_id === c.id);
    if (acts.length) lines.push(`What ${c.name} has done about it:\n${acts.map((i) => `- Day ${i.day}: ${i.action}${i.outcome ? ` → ${i.outcome}` : ""}`).join("\n")}`);
  }
  if (c.tier === "ahead") {
    const buf = bufferFor(tl, c.id);
    const flagged = new Map(tl.flags.map((f) => [f.item_id, f]));
    const told = new Set(tl.briefings.filter((b) => b.kind === "update" && b.to_character === c.id).flatMap((b) => b.flag_ids));
    lines.push(`${c.name} can see the expected trajectory ahead (collected material dated after Day ${tl.worldDay}). It is the trajectory before anyone intervenes: it can be misread, it doesn't guarantee capability or success, and it can change.`);
    if (buf.length) lines.push(`What ${c.name} can see ahead:\n${buf.slice(0, 25).map((i) => {
      const f = flagged.get(i.id);
      return `- Day ${i.day}: ${i.title} (${i.source})${f && told.has(f.id) && f.revised ? ` — updated briefing: ${f.revised}` : ""}`;
    }).join("\n")}`);
    else lines.push(`Nothing collected ahead of Day ${tl.worldDay} yet.`);
  }
  const got = tl.briefings.filter((b) => b.to_character === c.id && b.kind !== "update");
  if (got.length) lines.push(`What others have told ${c.name} (claims to weigh by their own rules, not facts):\n${got.map((b) => `- Day ${b.day}, a ${b.kind} from ${name(tl, b.from_character)}: ${b.content}`).join("\n")}`);
  return lines.join("\n\n");
}

/** The whole gap, for the Director and her Storybuilder. */
export function renderForDirector(tl: Timeline): string {
  const lines = [`World day: Day ${tl.worldDay} (the world as of ${tl.worldDate}; Day 1 = ${tl.anchor}). Material collected through Day ${tl.collectedThrough}.`];
  for (const c of tl.characters.filter((x) => x.role)) lines.push(`- ${c.name} (${c.role}): ${c.label}`);
  if (tl.discoveries.length) lines.push(`Gaps closed by investigation:\n${tl.discoveries.map((d) => `- ${name(tl, d.character_id)}, Day ${d.day}, ${METHOD_LABEL[d.method].toLowerCase()}: ${d.what}${d.item_day !== null ? ` (closes a gap on ${dayLabel(d.item_day)})` : ""}`).join("\n")}`);
  if (tl.predictions.length) lines.push(`Predictions:\n${tl.predictions.map((p) => `- ${name(tl, p.character_id)}, Day ${p.day}: ${p.prediction} [${p.status.replace("_", " ")}]`).join("\n")}`);
  if (tl.interventions.length) lines.push(`Interventions:\n${tl.interventions.map((i) => {
    const fs = tl.flags.filter((f) => f.intervention_id === i.id);
    return `- ${name(tl, i.character_id)}, Day ${i.day}: ${i.action}${i.expected_change ? `; expected: ${i.expected_change}` : ""}${fs.length ? `; may change: ${fs.map((f) => `"${f.original.title}" (Day ${f.original.item_day}, ${f.status === "reassessed" ? `revised: ${f.revised}` : "needs reassessment"})`).join(", ")}` : ""}${i.outcome ? `; what happened: ${i.outcome}` : ""}`;
  }).join("\n")}`);
  if (tl.briefings.length) lines.push(`Briefings:\n${tl.briefings.map((b) => `- Day ${b.day}: ${b.kind} from ${name(tl, b.from_character)} to ${name(tl, b.to_character)}: ${b.content}`).join("\n")}`);
  if (tl.buffer.length) lines.push(`Ahead of the world (the buffer; only an antagonist with access may know it): ${tl.buffer.length} item${tl.buffer.length === 1 ? "" : "s"} through Day ${tl.collectedThrough}, e.g. ${tl.buffer.slice(0, 6).map((i) => `Day ${i.day} "${i.title}"`).join("; ")}.`);
  return lines.join("\n");
}
