// SERVER ONLY. Daily 0–10 moods: queue a day per main character after the coverage refresh,
// and settle scores in date order. No model here (judging runs on her own computer), no
// events, no dialogue. Checked by tests/unit/no-model-calls.test.ts.
import { supabaseService } from "../supabase/server";
import { roleOf } from "../characters/roles";
import { isTracked, ruleSentence } from "../sim/rules";
import { DEFAULT_START, ruleWeight, settle, type DayRow, type MoodPayload } from "./score";

/** Queue (or refresh) today's mood day for each main character with an active bubble. */
export async function queueMoods(projectId: string, day: string): Promise<number> {
  const db = supabaseService();
  const { data: ents } = await db.from("entities").select("id, name, metadata").eq("project_id", projectId).eq("kind", "character").is("archived_at", null).neq("status", "archived");
  const chars = ((ents ?? []) as { id: string; name: string; metadata: Record<string, unknown> | null }[]).filter((c) => isTracked(roleOf(c.metadata)));
  if (!chars.length) return 0;
  const ids = chars.map((c) => c.id);
  const [{ data: off }, { data: snaps }, { data: rules }] = await Promise.all([
    db.from("character_bubbles").select("character_id").in("character_id", ids).eq("active", false),
    db.from("bubble_snapshots").select("character_id, items").in("character_id", ids).eq("run_date", day),
    db.from("sim_rules").select("*").eq("project_id", projectId).eq("family", "character").eq("enabled", true).is("archived_at", null).in("character_id", ids),
  ]);
  const paused = new Set(((off ?? []) as { character_id: string }[]).map((x) => x.character_id));
  let n = 0;
  for (const c of chars) {
    if (paused.has(c.id)) continue;
    const snap = ((snaps ?? []) as { character_id: string; items: { key: string; item_id: string; title: string; source: string }[] }[]).find((s) => s.character_id === c.id);
    const mine = ((rules ?? []) as Parameters<typeof ruleSentence>[0][] as (Parameters<typeof ruleSentence>[0] & { id: string; version: number; character_id: string })[]).filter((r) => r.character_id === c.id);
    const payload: MoodPayload = {
      character: c.name,
      rules: mine.map((r) => ({ id: r.id, version: r.version, text: ruleSentence(r, c.name), weight: ruleWeight(r.stress, r.happiness) })),
      items: (snap?.items ?? []).slice(0, 15).map((i) => ({ key: i.key, item_id: i.item_id, title: i.title.slice(0, 300), source: i.source })),
    };
    const needs = payload.rules.length > 0 && payload.items.length > 0;
    const { error } = await db.rpc("mood_queue", { p_project: projectId, p_character: c.id, p_day: day, p_payload: payload, p_needs_judging: needs });
    if (!error) { n++; await settleCharacter(c.id); }
  }
  return n;
}

/** Recompute a character's days in order from their stored judgments (overrides flow forward). */
export async function settleCharacter(characterId: string): Promise<void> {
  const db = supabaseService();
  const [{ data: days }, { data: st }] = await Promise.all([
    db.from("mood_days").select("id, day, status, needs_judging, judgments, payload, override, score, prev_score, target, harmony").eq("character_id", characterId).order("day"),
    db.from("sim_char_states").select("mood_start").eq("character_id", characterId).maybeSingle(),
  ]);
  const rows = (days ?? []) as (DayRow & { prev_score: number | null; target: number | null; harmony: number | null })[];
  const start = Number(st?.mood_start ?? DEFAULT_START);
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const r of settle(rows.map((d) => ({ ...d, override: d.override === null ? null : Number(d.override), score: d.score === null ? null : Number(d.score) })), start)) {
    const cur = byId.get(r.id)!;
    const same = cur.status !== "waiting" && cur.status !== "judged" && Number(cur.score) === r.score && Number(cur.prev_score) === r.prev && Number(cur.target) === r.target
      && (cur.harmony === null ? r.harmony === null : r.harmony !== null && Math.abs(Number(cur.harmony) - r.harmony) < 0.001);
    if (same) continue;
    await db.rpc("mood_put_score", { p_id: r.id, p_prev: r.prev, p_harmony: r.harmony === null ? null : Math.round(r.harmony * 1000) / 1000, p_target: r.target, p_score: r.score });
  }
}
