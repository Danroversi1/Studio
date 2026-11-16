"use client";
// Shows a thumbnail: a live crop of the treatment slide (nothing stored), or a stored picture.
import { useEffect, useRef, useState } from "react";
import { cropPlacement, slideEmbedUrl, type ThumbSource } from "@/lib/thumb";

export function ThumbView({ source, alt, className = "" }: { source: ThumbSource; alt: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || source?.kind !== "crop") return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [source?.kind]);
  if (!source) return null;
  if (source.kind === "asset") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`/api/assets/${source.assetId}`} alt={alt} className={`object-cover ${className}`} draggable={false} loading="lazy" />;
  }
  const p = size && size.w > 0 && size.h > 0 ? cropPlacement(source.crop, size.w, size.h) : null;
  return (
    <div ref={box} className={`relative overflow-hidden bg-line/40 ${className}`} role="img" aria-label={alt}>
      {p && (
        <iframe title={alt} src={slideEmbedUrl(source.crop.file_id, source.crop.slide, source.crop.slide_id)} tabIndex={-1} aria-hidden loading="lazy"
          className="pointer-events-none absolute max-w-none border-0"
          style={{ width: p.width, height: p.height, left: p.left, top: p.top }} />
      )}
    </div>
  );
}
