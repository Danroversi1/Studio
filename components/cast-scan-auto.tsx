"use client";
// After the script changes, quietly read it for characters it calls out who aren't in the
// cast yet ("the president", "a kid on the plane") and add them to Characters.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function CastScanAuto({ projectId }: { projectId: string }) {
  const router = useRouter();
  const started = useRef(false);
  const [added, setAdded] = useState<string[]>([]);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    fetch(`/api/projects/${projectId}/cast-scan`, { method: "POST" }).then((r) => r.json() as Promise<{ added: string[] }>).then(({ added }) => {
      if (!added?.length) return;
      setAdded(added);
      if (!document.querySelector('textarea[data-dirty="1"]')) router.refresh();
    }).catch(() => {});
  }, [projectId, router]);
  if (!added.length) return null;
  const names = added.length === 1 ? added[0] : `${added.slice(0, -1).join(", ")} and ${added[added.length - 1]}`;
  return (
    <p className="panel px-4 py-3 text-sm" role="status">
      Your script calls out {names}, so {added.length === 1 ? "they're" : "they're"} now in your <Link href={`/projects/${projectId}#characters`} className="text-accent underline">characters</Link>. Open each one to describe them.
    </p>
  );
}
