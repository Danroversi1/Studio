// Reads for the media-bubble screens (as the signed-in user; RLS applies).
import { supabaseServer } from "../supabase/server";
import { DAILY_UTC, DEFAULT_ATTENTION, DEFAULT_TZ, eligible, localTime, nextDaily, preferredSupported, type BubbleEntry } from "./select";

export interface BubbleSnapshot { run_date: string; items: BubbleEntry[]; summary: string; updated_at: string; version: number }

export async function getBubbleDesk(projectId: string) {
  const sb = await supabaseServer();
  const [{ data: set }, { data: runs }, { data: srcs }, { data: snaps }] = await Promise.all([
    sb.from("bubble_settings").select("paused, timezone, preferred_time").eq("project_id", projectId).maybeSingle(),
    sb.from("bubble_runs").select("id, run_date, trigger, status, sources, selected, note, error, started_at, finished_at").eq("project_id", projectId).order("started_at", { ascending: false }).limit(12),
    sb.from("knowledge_sources").select("id, title, status, last_attempt_at, last_success_at, last_error, paused, watch_query").eq("project_id", projectId).eq("kind", "feed").is("archived_at", null).is("disconnected_at", null).order("title"),
    sb.from("bubble_snapshots").select("character_id, run_date").eq("project_id", projectId).order("run_date", { ascending: false }).limit(200),
  ]);
  const tz = set?.timezone ?? DEFAULT_TZ;
  type Run = { id: string; run_date: string; trigger: string; status: string; sources: Record<string, { ok: boolean; error: string | null; stale: boolean }>; selected: number; note: string | null; error: string | null; started_at: string; finished_at: string | null };
  const list = (runs ?? []) as Run[];
  const attempted = list.find((r) => r.status !== "skipped");
  const success = list.find((r) => r.status === "succeeded" || r.status === "partial");
  const next = nextDaily(new Date());
  const preferred = set?.preferred_time ?? "04:17";
  return {
    paused: !!set?.paused, timezone: tz, preferred, preferredSupported: preferredSupported(preferred, tz),
    schedule: `Every day at ${localTime(next, tz)} (${String(DAILY_UTC.hour).padStart(2, "0")}:${String(DAILY_UTC.minute).padStart(2, "0")} UTC)`,
    next: set?.paused ? null : next.toISOString(), nextLabel: set?.paused ? "Paused" : localTime(next, tz, true),
    lastAttempt: attempted ? { at: attempted.started_at, label: localTime(new Date(attempted.started_at), tz, true), status: attempted.status, trigger: attempted.trigger } : null,
    lastSuccess: success ? { at: success.finished_at ?? success.started_at, label: localTime(new Date(success.finished_at ?? success.started_at), tz, true) } : null,
    runs: list.map((r) => ({ ...r, label: localTime(new Date(r.started_at), tz, true) })),
    sources: ((srcs ?? []) as { id: string; title: string; status: string; last_attempt_at: string | null; last_success_at: string | null; last_error: string | null; paused: boolean; watch_query: string | null }[]).map((s) => {
      const fresh = s.last_success_at ? Date.now() - Date.parse(s.last_success_at) < 36 * 3600_000 : false;
      return { ...s, world: !!s.watch_query, fresh, stale: !fresh || s.status === "error", successLabel: s.last_success_at ? localTime(new Date(s.last_success_at), tz, true) : "Never" };
    }),
    days: [...new Set(((snaps ?? []) as { run_date: string }[]).map((s) => s.run_date))].slice(0, 30),
  };
}
export type BubbleDesk = Awaited<ReturnType<typeof getBubbleDesk>>;

export async function getCharacterBubble(projectId: string, characterId: string, role: string | null, day?: string) {
  if (!eligible(role)) {
    const sb = await supabaseServer();
    const { count } = await sb.from("bubble_snapshots").select("id", { count: "exact", head: true }).eq("character_id", characterId);
    return { eligible: false as const, history: count ?? 0 };
  }
  const sb = await supabaseServer();
  const [{ data: b }, { data: dates }, { data: set }] = await Promise.all([
    sb.from("character_bubbles").select("topics, avoid, attention, active, inactive_reason, version").eq("character_id", characterId).maybeSingle(),
    sb.from("bubble_snapshots").select("run_date").eq("character_id", characterId).order("run_date", { ascending: false }).limit(60),
    sb.from("bubble_settings").select("paused, timezone").eq("project_id", projectId).maybeSingle(),
  ]);
  const days = ((dates ?? []) as { run_date: string }[]).map((d) => d.run_date);
  // Their own sources: interest searches, and feeds they follow (their collection).
  const [{ data: watches }, { data: coll }] = await Promise.all([
    sb.from("knowledge_sources").select("id, watch_query, status, last_success_at").eq("watch_character", characterId).is("archived_at", null).is("disconnected_at", null),
    sb.from("knowledge_collections").select("id").eq("project_id", projectId).eq("character_id", characterId).is("archived_at", null).maybeSingle(),
  ]);
  const { data: mem } = coll ? await sb.from("knowledge_collection_members").select("source_id").eq("collection_id", coll.id).not("source_id", "is", null) : { data: [] };
  const memIds = ((mem ?? []) as { source_id: string }[]).map((m) => m.source_id);
  const { data: feeds } = memIds.length ? await sb.from("knowledge_sources").select("id, title, url, status, last_error, last_success_at").in("id", memIds)
    .eq("kind", "feed").is("watch_query", null).is("archived_at", null).is("disconnected_at", null) : { data: [] };
  const searched = new Set(((watches ?? []) as { watch_query: string }[]).map((w) => w.watch_query.toLowerCase()));
  const pick = day && days.includes(day) ? day : days[0];
  const { data: snap } = pick ? await sb.from("bubble_snapshots").select("run_date, items, summary, updated_at, version").eq("character_id", characterId).eq("run_date", pick).maybeSingle() : { data: null };
  return {
    eligible: true as const,
    topics: (b?.topics ?? []) as string[], avoid: (b?.avoid ?? []) as string[], attention: b?.attention ?? DEFAULT_ATTENTION,
    active: b?.active ?? true, inactiveReason: (b?.inactive_reason ?? null) as "role" | "director" | null,
    filmPaused: !!set?.paused, timezone: set?.timezone ?? DEFAULT_TZ,
    days, snapshot: (snap ?? null) as BubbleSnapshot | null,
    searched: [...searched],
    followed: ((feeds ?? []) as { id: string; title: string; url: string | null; status: string; last_error: string | null; last_success_at: string | null }[]),
  };
}
export type CharacterBubble = Awaited<ReturnType<typeof getCharacterBubble>>;
