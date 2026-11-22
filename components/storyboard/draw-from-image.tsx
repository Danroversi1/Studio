"use client";
// "Draw a Frame From Image": choose a picture (a window on a treatment slide, or an upload)
// and STUDIO places it as the reference and traces it into editable lines, in her browser.
// No AI. The picture is kept, linked to where it came from, so the trace can be redone.
import { useRef, useState } from "react";
import { TreatmentCropPicker } from "@/components/treatment-crop-picker";
import type { SlideInfo } from "@/lib/slide-match";
import type { ThumbCrop } from "@/lib/thumb";
import type { Treatment } from "@/lib/storyboard/compose";

export interface PickedImage { blob: Blob; name: string; from: "treatment" | "upload"; crop?: ThumbCrop }

export function DrawFromImage({ projectId, deck, treatment, onTreatment, onPicked, onClose }: {
  projectId: string; deck: { fileId: string; slides: SlideInfo[] | null } | null;
  treatment: Treatment; onTreatment: (t: Treatment) => void;
  onPicked: (img: PickedImage) => Promise<void>; onClose: () => void;
}) {
  const [way, setWay] = useState<null | "treatment">(deck ? "treatment" : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  async function go(make: () => Promise<PickedImage>, label: string): Promise<string | null> {
    setBusy(label); setError(null);
    try { await onPicked(await make()); onClose(); return null; }
    catch (e) { const m = e instanceof Error ? e.message : "That picture couldn't be used."; setError(m); return m; }
    finally { setBusy(null); }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Draw a frame from an image" className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-3 sm:p-8"
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div className="panel flex w-full max-w-4xl flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="display text-2xl leading-none">Draw a Frame From Image</h2>
            <p className="help mt-1">Choose a picture. It becomes the reference for a frame and is traced into lines you can edit, right here in your browser.</p>
          </div>
          <button type="button" className="btn min-h-9 px-3 text-xs" onClick={onClose}>Close</button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="label">Draw it as</span>
          {(["outline", "ink", "three_tone"] as const).map((t) => (
            <button key={t} type="button" aria-pressed={treatment === t} onClick={() => onTreatment(t)} className={`btn min-h-8 px-2 text-xs ${treatment === t ? "btn-primary" : ""}`}>
              {{ outline: "Outline", ink: "Ink", three_tone: "Three-tone" }[t]}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Where the picture comes from">
          <button type="button" role="tab" aria-selected={way === "treatment"} disabled={!deck} className={`btn min-h-9 px-3 text-sm ${way === "treatment" ? "btn-primary" : ""}`} onClick={() => setWay("treatment")}>Select from Treatment</button>
          <button type="button" className="btn min-h-9 px-3 text-sm" disabled={!!busy} onClick={() => file.current?.click()}>Upload a picture</button>
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void go(async () => ({ blob: f, name: f.name.replace(/\.[^.]+$/, "") || "Picture", from: "upload" }), "upload"); }} />
        </div>
        {!deck && <p className="help">No treatment deck is linked to this film yet. Link your Google Slides treatment on the Treatment page, or upload a picture.</p>}
        {busy && <p role="status" className="text-sm">{busy === "upload" ? "Drawing the frame from your picture…" : "Getting the picture from your treatment and drawing the frame…"} (the tracing tools load the first time)</p>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {way === "treatment" && deck && (
          <div className={`flex flex-col gap-1 ${busy ? "pointer-events-none opacity-50" : ""}`}>
            <p className="text-xs text-muted">Pick a slide, then move and resize the window over the part you want. Google may ask you to select the treatment once.</p>
            <TreatmentCropPicker projectId={projectId} entityId="" entityName="Storyboard" entityKind="look" fileId={deck.fileId} initial={null} slides={deck.slides}
              pickLabel="Draw this frame" note="STUDIO makes a copy of this part of the slide for the frame (kept in your library, noting which slide it came from), then traces it here in your browser."
              onDone={onClose}
              onPick={async (crop) => {
                const err = await go(async () => {
                  const { treatmentCropPicture } = await import("@/lib/thumb-picture");
                  return { blob: await treatmentCropPicture(crop), name: `Treatment slide ${crop.slide}`, from: "treatment", crop };
                }, "treatment");
                return err ? { ok: false, error: err } : { ok: true };
              }} />
          </div>
        )}
      </div>
    </div>
  );
}
