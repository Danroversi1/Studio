"use client";
// Coming back to a tab re-reads the project, so a change saved on another desk
// (or in another tab) shows up without reloading.
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function RefreshOnReturn() {
  const router = useRouter();
  useEffect(() => {
    let last = Date.now();
    const onShow = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 2000) return;
      last = Date.now();
      router.refresh();
    };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    return () => { document.removeEventListener("visibilitychange", onShow); window.removeEventListener("focus", onShow); };
  }, [router]);
  return null;
}
