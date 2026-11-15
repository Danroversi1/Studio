"use client";
// "Break down my treatment": read the treatment's text from Google (in this browser, with
// her own permission) and hand it to the Story Lead. Suggestions appear in Your agents;
// nothing joins the film until she accepts it.
import { useState, useTransition } from "react";
import { requestTreatmentBreakdown } from "@/app/projects/[projectId]/actions";
import { DOC_MIME, SLIDES_MIME, exportText, googleConfig, withFilePermission } from "@/lib/google/client";

export function TreatmentBreakdown({ projectId, storyId, referenceId, fileId, kind, primary = false }: {
  projectId: string; storyId: string; referenceId: string; fileId: string; kind: "doc" | "slides"; primary?: boolean;
}) {
  const cfg = googleConfig();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!cfg) return null;

  async function run() {
    setError(null);
    try {
      setStatus("Reading your treatment…");
      const text = await withFilePermission(cfg!, fileId, kind === "doc" ? DOC_MIME : SLIDES_MIME,
        "Select your treatment so the Story Lead can read it", (t) => exportText(t, fileId));
      const words = text.trim().split(/\s+/).filter(Boolean).length;
      if (words < 10) throw new Error("The treatment has almost no text for the Story Lead to read.");
      setStatus(`Sending ${words.toLocaleString()} words to the Story Lead…`);
      start(async () => {
        const res = await requestTreatmentBreakdown({ projectId, storyId, referenceId, text: text.slice(0, 150000) });
        if (res?.error) {
          setError(res.error);
          setStatus(null);
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read the treatment.");
      setStatus(null);
    }
  }

  const busy = pending || (status !== null && !error);
  return (
    <div className="flex flex-col gap-1.5">
      <button type="button" className={`btn ${primary ? "btn-primary" : ""} self-start`} disabled={busy} onClick={run}>
        {busy ? status ?? "Working…" : "Break down with Story Lead"}
      </button>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <p className="text-xs text-muted">
        The Story Lead reads the treatment&apos;s text (not its pictures) and suggests characters and locations for you to
        accept. The text is sent to Anthropic&apos;s Claude AI.
      </p>
    </div>
  );
}
