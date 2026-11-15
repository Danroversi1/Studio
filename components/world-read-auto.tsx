"use client";
// First visit with an empty World & Time: read her story once for places and times she
// already wrote down, and show them as suggestions to review.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function WorldReadAuto({ projectId }: { projectId: string }) {
  const router = useRouter();
  const started = useRef(false);
  const [state, setState] = useState<"reading" | "done">("reading");
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    fetch(`/api/projects/${projectId}/world-read`, { method: "POST" }).then((r) => r.json() as Promise<{ suggested: boolean }>)
      .then((r) => { setState("done"); if (r.suggested) router.refresh(); })
      .catch(() => setState("done"));
  }, [projectId, router]);
  if (state !== "reading") return null;
  return <p className="text-sm text-muted" role="status">Looking through your story for places and times you&apos;ve already written…</p>;
}
