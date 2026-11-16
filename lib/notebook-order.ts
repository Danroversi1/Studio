// Order for notebook items and outline beats. Pure (unit-tested).
// A beat without its own position keeps its creation order (seconds since 1970), so older
// films need nothing changed; inserting between two beats takes the midpoint.
export interface Orderable { position?: number | null; created_at: string }

export const orderKey = (n: Orderable) => (n.position ?? Date.parse(n.created_at) / 1000);
export function sortByOrder<T extends Orderable>(items: T[]): T[] {
  return [...items].sort((a, b) => orderKey(a) - orderKey(b));
}
/** A position between two neighbours (either may be missing at the ends). */
export function between(before: Orderable | null | undefined, after: Orderable | null | undefined): number {
  if (before && after) return (orderKey(before) + orderKey(after)) / 2;
  if (before) return orderKey(before) + 1;
  if (after) return orderKey(after) - 1;
  return Date.now() / 1000;
}
