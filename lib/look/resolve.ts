// Which Look & Feel applies to a storyboard frame. Pure; unit-tested.
// Order: the frame's own choice → the storyboard's direction → approved directions scoped to
// this frame's scene, characters or location → the film's default. If two different scoped
// directions match, nothing is combined: the director is asked to choose.
import type { Applies, FrameLook, LookDirection, LookRef } from "./types";

export interface FrameContext { scene?: number; entityIds: string[] }
export type LookResolution =
  | { kind: "references"; refs: LookRef[]; why: string }
  | { kind: "direction"; direction: LookDirection; why: string; outdated: boolean }
  | { kind: "conflict"; options: LookDirection[]; why: string }
  | { kind: "none"; why: string };

export function appliesTo(a: Applies, ctx: FrameContext): boolean {
  if (a.film) return true;
  return (ctx.scene != null && (a.scenes ?? []).includes(ctx.scene)) || (a.entities ?? []).some((e) => ctx.entityIds.includes(e));
}

export function resolveFrameLook(look: FrameLook | null, sequenceDirection: string | null, directions: LookDirection[], refs: LookRef[], ctx: FrameContext): LookResolution {
  const live = directions.filter((d) => d.status !== "archived");
  const byId = new Map(live.map((d) => [d.id, d]));
  if (look?.mode === "references") {
    const chosen = (look.reference_ids ?? []).map((id) => refs.find((r) => r.id === id)).filter((r): r is LookRef => !!r);
    return { kind: "references", refs: chosen, why: "References chosen for this frame" };
  }
  if (look?.mode === "direction" && look.direction_id && byId.has(look.direction_id)) {
    const d = byId.get(look.direction_id)!;
    return { kind: "direction", direction: d, why: "Chosen for this frame", outdated: look.version != null && look.version !== d.version };
  }
  if (sequenceDirection && byId.has(sequenceDirection)) {
    return { kind: "direction", direction: byId.get(sequenceDirection)!, why: "Chosen for this storyboard", outdated: false };
  }
  const scoped = live.filter((d) => d.status === "approved" && !d.scope.film && appliesTo(d.scope, ctx));
  if (scoped.length > 1) return { kind: "conflict", options: scoped, why: "More than one approved direction is set for this scene, character or location" };
  if (scoped.length === 1) return { kind: "direction", direction: scoped[0], why: "Set for this scene, character or location", outdated: false };
  const def = live.find((d) => d.isDefault);
  if (def) return { kind: "direction", direction: def, why: "The film's default", outdated: false };
  return { kind: "none", why: "No approved default direction yet" };
}
