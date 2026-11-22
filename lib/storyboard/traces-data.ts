// SERVER. Load the saved traces that frames point at (vector layers), for drawing them.
import type { Composition } from "./compose";
import { traceFromRow, type TraceData } from "./trace-store";

type Sb = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

export const traceIdsOf = (comps: Composition[]) => [...new Set(comps.flatMap((c) => c.layers.map((l) => l.traceId).filter((x): x is string => !!x)))];

export async function loadTraces(sb: Sb, comps: Composition[]): Promise<TraceData[]> {
  const ids = traceIdsOf(comps);
  const out: TraceData[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const { data } = await sb.from("storyboard_traces").select("id, treatment, settings, source, width, height, paths, created_at").in("id", ids.slice(i, i + 50));
    for (const r of data ?? []) out.push(traceFromRow(r));
  }
  return out;
}

export async function loadTreatmentPreset(sb: Sb, projectId: string): Promise<{ settings: Record<string, unknown>; version: number } | null> {
  const { data } = await sb.from("storyboard_treatment_presets").select("settings, version").eq("project_id", projectId).maybeSingle();
  return data ? { settings: data.settings ?? {}, version: data.version } : null;
}
