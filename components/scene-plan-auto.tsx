"use client";
// When the outline has beats that aren't in the script yet, lay out their scenes
// automatically, then show them. If she's in the middle of typing, wait for her.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function ScenePlanAuto({ projectId, pending }: { projectId: string; pending: number }) {
  const router = useRouter();
  const started = useRef(false);
  const [state, setState] = useState<"idle" | "working" | "ready" | "done">(pending ? "working" : "idle");
  useEffect(() => {
    if (!pending || started.current) return;
    started.current = true;
    fetch(`/api/projects/${projectId}/plan-scenes`, { method: "POST" }).then((r) => r.json() as Promise<{ added: number }>).then(({ added }) => {
      if (!added) { setState("done"); return; }
      const typing = document.querySelector('textarea[data-dirty="1"]');
      if (typing) setState("ready"); else { setState("done"); router.refresh(); }
    }).catch(() => setState("done"));
  }, [pending, projectId, router]);
  if (state === "working") {
    return <p className="panel px-4 py-3 text-sm" role="status">Laying out scenes from your outline ({pending} new {pending === 1 ? "beat" : "beats"})…</p>;
  }
  if (state === "ready") {
    return (
      <p className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm" role="status">
        New scenes from your outline are ready. Save your changes first, then they&apos;ll appear.
      </p>
    );
  }
  return null;
}
