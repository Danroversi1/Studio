"use client";
// One way to run a server action from a button: pending state, a short success or error
// line, and a refresh of the page's server data. Shared by every desk.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export type ActionResult = { ok: true; note?: string } | { ok: false; error: string };
export type ActionMsg = { kind: "ok" | "error"; text: string } | null;

export function useAction() {
  const router = useRouter();
  const [msg, setMsg] = useState<ActionMsg>(null);
  const [pending, start] = useTransition();
  function run<R extends ActionResult>(fn: () => Promise<R>, okText?: string, after?: (r: Extract<R, { ok: true }>) => void) {
    setMsg(null);
    start(async () => {
      let r: ActionResult;
      try { r = await fn(); } catch { r = { ok: false, error: "That didn't go through. Check your connection and try again." }; }
      if (r.ok) { setMsg({ kind: "ok", text: r.note ?? okText ?? "Saved." }); after?.(r as Extract<R, { ok: true }>); router.refresh(); }
      else setMsg({ kind: "error", text: r.error });
    });
  }
  const line = <ActionStatus msg={msg} />;
  return { run, msg, setMsg, pending, line };
}

export function ActionStatus({ msg }: { msg: ActionMsg }) {
  if (!msg) return null;
  return <p role={msg.kind === "error" ? "alert" : "status"} className={`text-xs ${msg.kind === "error" ? "text-danger" : "text-muted"}`}>{msg.text}</p>;
}
