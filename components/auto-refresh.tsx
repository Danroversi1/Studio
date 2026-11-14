"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-fetches server data every few seconds while an agent run is in progress. */
export function AutoRefresh({ active, everyMs = 4000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [active, everyMs, router]);
  return null;
}
