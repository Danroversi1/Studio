// Camera geometry for storyboards: field of view from capture area + focal length (+ squeeze),
// cropped to the delivery aspect; how far the camera is for a framing; depth of field.
// These are thin-lens / pinhole approximations, good for planning. The image model only
// interprets them loosely, so the app labels them as creative guidance. Pure (unit-tested).

export interface CaptureFormat {
  id: string;
  name: string;
  /** Capture (gate / sensor) area in mm, as used for these calculations. */
  widthMm: number;
  heightMm: number;
  /** Circle of confusion used for depth of field (mm); a common convention, not a standard. */
  cocMm: number;
  note: string;
}

// Common reference dimensions. Real cameras vary by model and recording mode; choose
// "Custom" in the app to enter exact numbers from a camera's own documentation.
export const FORMATS: CaptureFormat[] = [
  { id: "s35", name: "Super 35 (film, full aperture)", widthMm: 24.89, heightMm: 18.66, cocMm: 0.025, note: "35 mm film full aperture." },
  { id: "academy35", name: "35 mm Academy", widthMm: 21.95, heightMm: 16.0, cocMm: 0.025, note: "Academy camera aperture." },
  { id: "ana35", name: "35 mm anamorphic (4-perf, 2× squeeze)", widthMm: 21.95, heightMm: 18.6, cocMm: 0.025, note: "Anamorphic camera aperture; use with a 2× lens." },
  { id: "ff", name: "Full frame (36 × 24)", widthMm: 36, heightMm: 24, cocMm: 0.03, note: "Still-photo full frame; many digital cinema cameras are close." },
  { id: "s16", name: "Super 16", widthMm: 12.52, heightMm: 7.41, cocMm: 0.015, note: "Super 16 mm film." },
  { id: "16", name: "Standard 16", widthMm: 10.26, heightMm: 7.49, cocMm: 0.015, note: "Standard 16 mm film." },
  { id: "65", name: "65 mm (5-perf)", widthMm: 52.48, heightMm: 23.01, cocMm: 0.05, note: "65 mm 5-perf camera aperture." },
];

export const ASPECTS: { id: string; label: string; ratio: number }[] = [
  { id: "1.33", label: "1.33:1 (4:3)", ratio: 4 / 3 },
  { id: "1.78", label: "1.78:1 (16:9)", ratio: 16 / 9 },
  { id: "1.85", label: "1.85:1", ratio: 1.85 },
  { id: "2.00", label: "2.00:1", ratio: 2 },
  { id: "2.39", label: "2.39:1 (scope)", ratio: 2.39 },
];

export interface CameraSetup {
  formatId?: string;            // one of FORMATS, or "custom"
  widthMm?: number;             // custom capture area
  heightMm?: number;
  focalMm?: number;
  anamorphic?: boolean;
  squeeze?: number;             // e.g. 2 or 1.5 (anamorphic only)
  aspect?: number;              // delivery aspect ratio (width / height)
  apertureKind?: "f" | "T";     // f-number or T-stop, as she entered it
  aperture?: number;
  focusM?: number;
  cameraHeightM?: number;
  tiltDeg?: number;
  panDeg?: number;
}

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function formatOf(c: CameraSetup): CaptureFormat | null {
  if (c.formatId === "custom") {
    if (!(c.widthMm! > 0 && c.heightMm! > 0)) return null;
    return { id: "custom", name: "Custom", widthMm: c.widthMm!, heightMm: c.heightMm!, cocMm: Math.hypot(c.widthMm!, c.heightMm!) / 1500, note: "Entered by hand." };
  }
  return FORMATS.find((f) => f.id === (c.formatId ?? "s35")) ?? null;
}

/** The part of the capture area that ends up in the delivery frame, in mm, after de-squeeze.
 *  widthMm is in de-squeezed (scene) terms: an anamorphic lens fits squeeze× more scene
 *  across the same physical width. */
export function usedArea(c: CameraSetup): { widthMm: number; heightMm: number; aspect: number } | null {
  const f = formatOf(c);
  if (!f) return null;
  const squeeze = c.anamorphic ? Math.max(1, c.squeeze ?? 2) : 1;
  let w = f.widthMm * squeeze;   // de-squeezed width
  let h = f.heightMm;
  const native = w / h;
  const aspect = c.aspect && c.aspect > 0 ? c.aspect : native;
  if (aspect > native) h = w / aspect; else w = h * aspect;  // crop to the delivery aspect
  return { widthMm: w, heightMm: h, aspect };
}

/** Horizontal, vertical and diagonal field of view in degrees (rectilinear lens). */
export function fieldOfView(c: CameraSetup): { h: number; v: number; d: number } | null {
  const a = usedArea(c);
  if (!a || !(c.focalMm! > 0)) return null;
  const fl = c.focalMm!;
  // For an anamorphic lens, the horizontal scene angle comes from the de-squeezed width.
  return {
    h: deg(2 * Math.atan(a.widthMm / (2 * fl))),
    v: deg(2 * Math.atan(a.heightMm / (2 * fl))),
    d: deg(2 * Math.atan(Math.hypot(a.widthMm, a.heightMm) / (2 * fl))),
  };
}

/** How wide and tall the frame is (in metres) at a distance, e.g. at the subject. */
export function frameSizeAt(c: CameraSetup, distanceM: number): { widthM: number; heightM: number } | null {
  const fov = fieldOfView(c);
  if (!fov || !(distanceM > 0)) return null;
  return { widthM: 2 * distanceM * Math.tan(rad(fov.h) / 2), heightM: 2 * distanceM * Math.tan(rad(fov.v) / 2) };
}

/** Roughly how much of a standing person fills the frame height for each shot size (m). */
export const FRAMING_HEIGHT_M: Record<string, number> = {
  extreme_wide: 12, wide: 3, full: 2.1, medium_wide: 1.5, medium: 0.95, medium_close: 0.6, close: 0.35, extreme_close: 0.12,
};

/** Camera-to-subject distance (m) that gives a framing with this lens and format. */
export function distanceForFraming(c: CameraSetup, size: string): number | null {
  const fov = fieldOfView(c);
  const want = FRAMING_HEIGHT_M[size];
  if (!fov || !want) return null;
  return want / 2 / Math.tan(rad(fov.v) / 2);
}

/** The focal length that gives the same horizontal angle on another format. */
export function equivalentFocal(c: CameraSetup, target: CameraSetup): number | null {
  const fov = fieldOfView(c);
  const a = usedArea({ ...target, focalMm: 1 });
  if (!fov || !a) return null;
  return a.widthMm / (2 * Math.tan(rad(fov.h) / 2));
}

/** Depth of field (thin lens). T-stops measure light, not geometry: a T-stop is treated as
 *  the same f-number, which slightly overstates depth of field (approximate). */
export function depthOfField(c: CameraSetup): { nearM: number; farM: number | null; hyperfocalM: number; approximate: boolean } | null {
  const f = formatOf(c);
  if (!f || !(c.focalMm! > 0) || !(c.aperture! > 0) || !(c.focusM! > 0)) return null;
  const fl = c.focalMm! / 1000;           // m
  const N = c.aperture!;
  const coc = f.cocMm / 1000;            // m
  const s = c.focusM!;
  const H = (fl * fl) / (N * coc) + fl;
  const near = (s * (H - fl)) / (H + s - 2 * fl);
  const far = s >= H ? null : (s * (H - fl)) / (H - s);
  return { nearM: near, farM: far, hyperfocalM: H, approximate: c.apertureKind === "T" || !!c.anamorphic };
}

export const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
