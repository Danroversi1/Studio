// Local rendering: what the companion on her computer reports, and what a job carries.
// Pure types and cleaners. Nothing here calls a model or reaches her computer.

/** What one installed, allowlisted workflow can do, as verified by the companion against
 *  the running renderer (nodes present, model files present). Never assumed by Studio. */
export interface WorkflowReport {
  id: string; version: string; title: string; model: string; license: string; licenseUrl?: string;
  ready: boolean; problems: string[];
  /** Total input images the workflow takes (the composition/start image counts as one). */
  maxImages: number;
  /** Ways the workflow uses images. All false/absent unless the workflow really does it. */
  conditioning: { editInput: boolean; referenceImages: boolean; sketchControl: boolean; depthControl: boolean; poseControl: boolean; masks: boolean; characterAdapter: boolean; distinctRoles: boolean };
  sizes: { min: number; max: number; multiple: number };
  presets: { draft: { longSide: number; steps?: number }; refine: { longSide: number; steps?: number } };
  params: { seed: boolean; steps: boolean; strength: boolean };
  /** Free text from the workflow manifest, e.g. "settings from the model's documentation; not yet tested on this computer". */
  settingsNote?: string;
}
export interface RendererReport {
  companionVersion?: string; os?: string; python?: string; rendererKind?: string; rendererVersion?: string;
  rendererReachable?: boolean; rendererError?: string | null; backend?: string;
  gpus?: { name: string; vramTotalMb?: number; vramFreeMb?: number }[]; ramTotalMb?: number;
  workflows?: WorkflowReport[];
  /** What she typed herself when the companion couldn't tell. */
  manual?: { gpu?: string; vramGb?: number; notes?: string };
}
export interface DeviceRow { id: string; name: string; report: RendererReport; lastSeenAt: string | null; createdAt: string; revokedAt: string | null }

export const ONLINE_MS = 90_000;
export const isOnline = (d: Pick<DeviceRow, "lastSeenAt" | "revokedAt">, now = Date.now()) =>
  !d.revokedAt && !!d.lastSeenAt && now - new Date(d.lastSeenAt).getTime() < ONLINE_MS;

export type InputRole = "composition" | "start_frame" | "cast" | "location" | "look";
export const ROLE_LABEL: Record<InputRole, string> = {
  composition: "Composition (placement, framing, poses)", start_frame: "Earlier frame to start from",
  cast: "Cast (appearance and identity)", location: "Location (environment and space)", look: "Look & Feel (illustration, palette, light, texture)",
};
export interface BundleInput {
  role: InputRole; asset_id: string; label: string;
  entity_id?: string; look_reference_id?: string;
  use_for?: string; leave_out?: string; attribution?: string; permission?: string;
}
export interface BundleOmission { role: InputRole; label: string; reason: string }
