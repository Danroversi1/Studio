"use client";
// Length: pick one (it stays highlighted), then Submit. Once set, the box folds to
// "Length = …" with a Change button. The outline and timelines follow the length.
import Link from "next/link";
import { useState } from "react";
import { setRuntime } from "@/app/projects/[projectId]/actions";
import { RUNTIMES, runtimeInfo } from "@/lib/runtime";
import { SubmitButton } from "./ui";

export function LengthPicker({ projectId, back, runtime, canEdit, helpHref }: {
  projectId: string; back: string; runtime: string | null; canEdit: boolean; helpHref: string;
}) {
  const [open, setOpen] = useState(!runtime);
  const [choice, setChoice] = useState<string | null>(runtime);
  const current = runtimeInfo(runtime);

  if (!open || !canEdit) {
    return (
      <section className="panel flex flex-wrap items-center justify-between gap-3 px-5 py-3" aria-label="Length">
        <p><span className="eyebrow mr-2">Length</span><span className="font-semibold">= {current?.label ?? "Not decided yet"}</span></p>
        {canEdit && <button type="button" className="btn min-h-9" onClick={() => { setChoice(runtime); setOpen(true); }}>Change</button>}
      </section>
    );
  }
  return (
    <form action={setRuntime} className="panel flex flex-col gap-3 p-5" aria-labelledby="length-h">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="runtime" value={choice ?? ""} />
      <h2 id="length-h" className="display text-xl">Length</h2>
      <p className="text-sm">How long are you imagining your film?</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Film length">
        {RUNTIMES.map((r) => (
          <button key={r.value} type="button" role="radio" aria-checked={choice === r.value} onClick={() => setChoice(r.value)}
            className={`btn ${choice === r.value ? "btn-primary" : ""}`}>{r.label}</button>
        ))}
        <Link href={helpHref} className="btn">Help me choose</Link>
      </div>
      <p className="text-xs text-muted">
        {runtimeInfo(choice)?.focus ?? "Length is a creative choice, not a measure of how good a film is. A complete one-minute film is a real achievement."}
      </p>
      <div className="flex flex-wrap gap-2">
        <SubmitButton variant="primary" disabled={!choice} pendingText="Saving…">Submit</SubmitButton>
        {runtime && <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>}
      </div>
    </form>
  );
}
