// A character's place in the film, set by the Director. Used to order character menus:
// World first (in the Knowledge Base), then protagonists, supporting, featured, then any
// character whose role isn't set yet. Alphabetical only within a role. Pure (unit-tested).
export const ROLES = ["protagonist", "supporting", "featured"] as const;
export type CastRole = (typeof ROLES)[number];
export const ROLE_LABEL: Record<CastRole, string> = { protagonist: "Protagonist", supporting: "Supporting", featured: "Featured" };

export function roleOf(metadata: Record<string, unknown> | null | undefined): CastRole | null {
  const r = metadata?.cast_role;
  return typeof r === "string" && (ROLES as readonly string[]).includes(r) ? (r as CastRole) : null;
}

export function byRole<T extends { name: string; role: CastRole | null }>(list: T[]): T[] {
  const rank = (r: CastRole | null) => (r ? ROLES.indexOf(r) : ROLES.length);
  return [...list].sort((a, b) => rank(a.role) - rank(b.role) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
