// The World simulation desk's data (read with her own access). No model calls.
import { supabaseServer } from "@/lib/supabase/server";
import { getCast } from "@/lib/data";
import { latestScript } from "@/lib/knowledge/connect-data";
import { splitScenes } from "@/lib/dialogue/scenes";
import { bound, fictionalDate, nextScheduled, type EventData, type SimRule, type SimSettings } from "./rules";

export interface SimEvent {
  id: string; day: number; status: "proposed" | "blocked" | "approved" | "rejected" | "deferred"; current_version: number; approved_version: number | null;
  depends_on: Record<string, number>; target_scene_key: string | null; origin: "simulation" | "director"; revises_event: string | null;
  created_at: string; decided_at: string | null;
  current: EventData; fresh: boolean; author: "simulation" | "director"; versions: number;
  dialogue: { id: string; status: string; scene_key: string } | null;
}
export interface SimRun { id: string; day: number; trigger: string; status: string; proposed: number; note: string | null; error: string | null; started_at: string; finished_at: string | null; stale: boolean }

const DEFAULTS: SimSettings = { max_events: 3, intensity: 2, flexibility: 2, paused: false, auto_daily: false, auto_dialogue: false, start_date: null, clock_day: 0, version: 0 };

export async function getSimulation(projectId: string) {
  const sb = await supabaseServer();
  const [cast, { data: s }, { data: rules }, { data: starts }, { data: changes }, { data: evs }, { data: runs }, script] = await Promise.all([
    getCast(projectId),
    sb.from("sim_settings").select("*").eq("project_id", projectId).maybeSingle(),
    sb.from("sim_rules").select("*").eq("project_id", projectId).is("archived_at", null).order("created_at"),
    sb.from("sim_char_states").select("character_id, start_stress, start_happiness").eq("project_id", projectId),
    sb.from("sim_state_changes").select("character_id, d_stress, d_happiness, day, kind, event_id, note, created_at").eq("project_id", projectId).order("created_at"),
    sb.from("sim_events").select("*").eq("project_id", projectId).order("day", { ascending: false }).order("created_at").limit(80),
    sb.from("sim_runs").select("id, day, trigger, status, proposed, note, error, started_at, finished_at, inputs").eq("project_id", projectId).order("started_at", { ascending: false }).limit(6),
    latestScript(sb, projectId),
  ]);
  const settings: SimSettings = s ? (s as SimSettings) : DEFAULTS;
  const eventRows = (evs ?? []) as Omit<SimEvent, "current" | "fresh" | "author" | "versions" | "dialogue">[];
  const ids = eventRows.map((e) => e.id);
  const [{ data: vers }, { data: drafts }] = ids.length ? await Promise.all([
    sb.from("sim_event_versions").select("event_id, version, data, consequences_fresh, author").in("event_id", ids),
    sb.from("dialogue_proposals").select("id, status, scene_key, event_refs, created_at").eq("project_id", projectId).neq("event_refs", "[]").order("created_at", { ascending: false }).limit(40),
  ]) : [{ data: [] }, { data: [] }];
  const vs = (vers ?? []) as { event_id: string; version: number; data: EventData; consequences_fresh: boolean; author: "simulation" | "director" }[];
  const dr = (drafts ?? []) as { id: string; status: string; scene_key: string; event_refs: { id: string }[] }[];
  const events: SimEvent[] = eventRows.map((e) => {
    const mine = vs.filter((v) => v.event_id === e.id);
    const cur = mine.find((v) => v.version === e.current_version)!;
    const d = dr.find((x) => x.event_refs.some((r) => r.id === e.id));
    return { ...e, current: cur?.data, fresh: !!cur?.consequences_fresh, author: cur?.author ?? "simulation", versions: mine.length,
      dialogue: d ? { id: d.id, status: d.status, scene_key: d.scene_key } : null };
  }).filter((e) => e.current);

  const start = new Map(((starts ?? []) as { character_id: string; start_stress: number; start_happiness: number }[]).map((x) => [x.character_id, x]));
  const ch = (changes ?? []) as { character_id: string; d_stress: number; d_happiness: number; day: number; kind: string; event_id: string | null; note: string | null; created_at: string }[];
  const characters = cast.map((c) => {
    const mine = ch.filter((x) => x.character_id === c.id);
    const s0 = start.get(c.id);
    return {
      id: c.id, name: c.name, role: c.role,
      start: { stress: s0?.start_stress ?? 0, happiness: s0?.start_happiness ?? 0 },
      now: { stress: bound((s0?.start_stress ?? 0) + mine.reduce((a, x) => a + x.d_stress, 0)), happiness: bound((s0?.start_happiness ?? 0) + mine.reduce((a, x) => a + x.d_happiness, 0)) },
      changes: mine.slice(-6).reverse(), hasHistory: mine.length > 0,
    };
  });
  const runList: SimRun[] = ((runs ?? []) as (SimRun & { inputs: { stale_sources?: boolean } })[]).map((r) => ({ ...r, stale: !!r.inputs?.stale_sources }));
  const openDay = settings.clock_day + 1;
  const lastOk = runList.find((r) => r.status === "succeeded") ?? null;
  return {
    settings, rules: (rules ?? []) as SimRule[], characters, events, runs: runList,
    openDay, openDate: fictionalDate(settings.start_date, openDay), closedDate: fictionalDate(settings.start_date, settings.clock_day),
    lastSuccess: lastOk?.finished_at ?? null,
    nextRun: settings.auto_daily && !settings.paused ? nextScheduled(new Date()).toISOString() : null,
    scenes: splitScenes(script.body).map((x, i) => ({ key: x.key, label: `${i + 1}. ${x.heading}` })),
  };
}
export type Simulation = Awaited<ReturnType<typeof getSimulation>>;
