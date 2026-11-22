// Saved traces (storyboard_traces) held for drawing: one shared store per page so the editor,
// thumbnails, print sheet and exports all draw the same paths. Pure data + Path2D caching.
export interface TracePath { d: string; f?: string; s?: string; w?: number }
export interface TraceData {
  id: string; treatment: "outline" | "ink" | "three_tone"; width: number; height: number; paths: TracePath[];
  settings: Record<string, unknown>; source: unknown[]; createdAt?: string;
}

const traces = new Map<string, TraceData>();
const path2d = new Map<string, Path2D[]>();

export function putTraces(list: TraceData[]) { for (const t of list) traces.set(t.id, t); }
export const getTrace = (id: string | undefined) => (id ? traces.get(id) : undefined);

/** Path2D objects for a trace (browser only), built once. */
export function pathsOf(t: TraceData): Path2D[] {
  let p = path2d.get(t.id);
  if (!p) { p = t.paths.map((x) => new Path2D(x.d)); path2d.set(t.id, p); }
  return p;
}

export function traceFromRow(r: Record<string, unknown>): TraceData {
  return {
    id: String(r.id), treatment: (r.treatment as TraceData["treatment"]) ?? "outline", width: Number(r.width), height: Number(r.height),
    paths: (r.paths as TracePath[]) ?? [], settings: (r.settings as Record<string, unknown>) ?? {}, source: (r.source as unknown[]) ?? [],
    createdAt: r.created_at as string | undefined,
  };
}

/** Forget a temporary trace (a preview) and its cached paths. */
export function dropTrace(id: string) { traces.delete(id); path2d.delete(id); }
