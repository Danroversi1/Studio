"use client";
// Look Preview finishing in the browser: shows the underlying generated image or the same
// image with a stock-inspired finish, without regenerating. Approximate by design.
import { useEffect, useRef, useState } from "react";
import { applyFinish, type FinishParams } from "@/lib/storyboard/finish";

export function FinishPreview({ assetId, params, captureWidthMm, alt, presetLabel }: {
  assetId: string; params: FinishParams | null; captureWidthMm: number; alt: string; presetLabel: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<"finished" | "underlying">("finished");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const hasFinish = !!params && JSON.stringify(params) !== "{}";

  useEffect(() => {
    let live = true;
    setState("loading");
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (!live || !canvas.current) return;
      const c = canvas.current;
      const scale = Math.min(1, 1600 / img.naturalWidth);
      c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) { setState("error"); return; }
      ctx.drawImage(img, 0, 0, c.width, c.height);
      if (view === "finished" && hasFinish) {
        try {
          const data = ctx.getImageData(0, 0, c.width, c.height);
          const out = applyFinish(data.data, c.width, c.height, params!, { captureWidthMm, seed: 1 });
          ctx.putImageData(new ImageData(new Uint8ClampedArray(out), c.width, c.height), 0, 0);
        } catch { setState("error"); return; }
      }
      setState("ready");
    };
    img.onerror = () => live && setState("error");
    img.src = `/api/assets/${assetId}`;
    return () => { live = false; };
  }, [assetId, view, params, captureWidthMm, hasFinish]);

  function download() {
    const c = canvas.current;
    if (!c) return;
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = `look-preview-${view}.png`;
    a.click();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative bg-black">
        <canvas ref={canvas} role="img" aria-label={`${alt} (${view === "finished" && hasFinish ? `finished: ${presetLabel}` : "underlying image"})`} className="block h-auto w-full" />
        {state === "loading" && <p className="absolute inset-0 flex items-center justify-center text-sm text-white/80">Preparing preview…</p>}
        {state === "error" && <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-white/80">This browser couldn&apos;t apply the finish here. The underlying image is unchanged.</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <div role="group" aria-label="Compare" className="flex">
          <button type="button" className={`btn min-h-9 px-3 text-xs ${view === "underlying" ? "btn-primary" : ""}`} aria-pressed={view === "underlying"} onClick={() => setView("underlying")}>Underlying image</button>
          <button type="button" className={`btn min-h-9 px-3 text-xs ${view === "finished" ? "btn-primary" : ""}`} aria-pressed={view === "finished"} onClick={() => setView("finished")} disabled={!hasFinish}>Finished preview</button>
        </div>
        <button type="button" className="btn min-h-9 px-3 text-xs" onClick={download} disabled={state !== "ready"}>Download this view</button>
        <span className="text-muted">{hasFinish ? `${presetLabel}: stock-inspired approximation, not a film emulation.` : "No finish applied."}</span>
      </div>
    </div>
  );
}
