// Film length: a creative constraint, not a quality ranking. Pure (unit-tested).
export const RUNTIMES = [
  { value: "1", label: "About 1 minute", short: "~1 min", pages: 1, focus: "One situation, a clear action or discovery, and a meaningful turn or final image." },
  { value: "3-5", label: "About 3–5 minutes", short: "3–5 min", pages: 5, focus: "A central desire, an obstacle, a few consequential beats, and a choice or change." },
  { value: "10-15", label: "About 10–15 minutes", short: "10–15 min", pages: 15, focus: "A sustained central conflict, escalating attempts, relationship development, and an earned ending." },
  { value: "longer", label: "Something longer", short: "Longer", pages: 90, focus: "A scoped first milestone, then broader development if you choose." },
] as const;

export type Runtime = (typeof RUNTIMES)[number]["value"];

export function isRuntime(x: unknown): x is Runtime {
  return RUNTIMES.some((r) => r.value === x);
}

export function runtimeInfo(x: unknown) {
  return RUNTIMES.find((r) => r.value === x) ?? null;
}

/** Script-page target for the timeline (1 page ≈ 1 minute). Undecided → 90, labelled as such. */
export function targetPages(x: unknown): number {
  return runtimeInfo(x)?.pages ?? 90;
}
