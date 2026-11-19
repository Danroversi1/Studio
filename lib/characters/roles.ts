// A character's place in the film, set by the Director. Used to order character menus:
// World first (in the Knowledge Base), then protagonists, antagonists, supporting, featured, then any
// character whose role isn't set yet. Within a role, most scene appearances first, then
// alphabetical. Pure (unit-tested).
export const ROLES = ["protagonist", "antagonist", "supporting", "featured"] as const;
export type CastRole = (typeof ROLES)[number];
export const ROLE_LABEL: Record<CastRole, string> = { protagonist: "Protagonist", antagonist: "Antagonist", supporting: "Supporting", featured: "Featured" };

export function roleOf(metadata: Record<string, unknown> | null | undefined): CastRole | null {
  const r = metadata?.cast_role;
  return typeof r === "string" && (ROLES as readonly string[]).includes(r) ? (r as CastRole) : null;
}

/** Role order; within a role, the characters who appear in more scenes come first
 *  (pass appearances keyed by lowercase name); then alphabetical. */
export function byRole<T extends { name: string; role: CastRole | null }>(list: T[], appearances: Record<string, number> = {}): T[] {
  const rank = (r: CastRole | null) => (r ? ROLES.indexOf(r) : ROLES.length);
  const seen = (x: T) => appearances[x.name.trim().toLowerCase()] ?? 0;
  return [...list].sort((a, b) => rank(a.role) - rank(b.role) || seen(b) - seen(a) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export const ROLE_HINT: Record<CastRole, string> = {
  protagonist: "The story follows them",
  antagonist: "Stands in their way",
  supporting: "Close to the story",
  featured: "Has a moment",
};
