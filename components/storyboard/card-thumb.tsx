"use client";
import { useEffect, useRef } from "react";
import type { Composition } from "@/lib/storyboard/compose";
import { loadAll, renderComposition } from "@/lib/storyboard/render";

/** A storyboard's first frame, rendered locally. */
export function CardThumb({ comp }: { comp: Composition }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true;
    const ids = [...new Set(comp.layers.map((l) => l.assetId).filter((x): x is string => !!x))];
    loadAll(ids).then((m) => { if (live && ref.current) renderComposition(ref.current, comp, m, 480, { preview: true }); });
    return () => { live = false; };
  }, [comp]);
  return <canvas ref={ref} className="block h-auto w-full bg-white" aria-hidden />;
}
