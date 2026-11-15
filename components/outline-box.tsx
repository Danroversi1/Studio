// Outline: beginning, middle and ending, built a step at a time. Each part shows a guiding
// question (fitted to the film length), her beats, and any beats the Storybuilder
// suggested (marked, until she keeps them). Stored in the story notebook, separate from
// her synopsis, so nothing here rewrites her text.
import Link from "next/link";
import { addNote, updateNote } from "@/app/projects/[projectId]/actions";
import type { NotebookItem } from "@/lib/data";
import { SubmitButton } from "./ui";

const PARTS = [
  {
    kind: "beginning", title: "Beginning",
    ask: "What situation are we entering, and what sets something in motion?",
    short: "One moment that shows who we're with and what's about to change.",
  },
  {
    kind: "middle", title: "Middle",
    ask: "What develops through actions, obstacles or discoveries?",
    short: "What they try, and what gets in the way. One or two beats is plenty.",
  },
  {
    kind: "ending", title: "Ending",
    ask: "What is decided, revealed or changed?",
    short: "The turn or final image we're left with.",
  },
] as const;

function hint(runtime: string | null) {
  switch (runtime) {
    case "1": return "For a one-minute film, each part can be a single moment.";
    case "3-5": return "For 3–5 minutes: a desire, an obstacle, a few beats that matter, and a choice or change.";
    case "10-15": return "For 10–15 minutes: a conflict that keeps building, with attempts that escalate toward an earned ending.";
    case "longer": return "For a longer film, outline a first chapter or proof of concept you can finish, and keep the rest for later.";
    default: return "Write a sentence or two for each part. They don't have to be finished, and you can change them any time.";
  }
}

export function OutlineBox({ projectId, items, runtime, canEdit, back }: {
  projectId: string; items: NotebookItem[]; runtime: string | null; canEdit: boolean; back: string;
}) {
  const beats = items.filter((n) => n.status !== "archived" && n.status !== "done");
  const filled = PARTS.filter((p) => beats.some((b) => b.kind === p.kind && b.status === "confirmed")).length;
  // Guide one part at a time: the first part without a kept beat is the one we ask about.
  const focus = PARTS.find((p) => !beats.some((b) => b.kind === p.kind && b.status === "confirmed"))?.kind;
  const short = runtime === "1" || runtime === "3-5";

  return (
    <section className="panel flex flex-col gap-4 p-5" aria-labelledby="outline-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="outline-h" className="display text-xl">Outline</h2>
        <span className="text-xs tracking-[0.08em] text-muted uppercase">{filled} of 3 parts</span>
      </div>
      <p className="text-sm text-muted">{hint(runtime)}</p>

      <ol className="flex flex-col gap-4">
        {PARTS.map((p, i) => {
          const list = beats.filter((b) => b.kind === p.kind);
          const isFocus = p.kind === focus;
          return (
            <li key={p.kind} className={`flex flex-col gap-2 border-l-2 pl-4 ${isFocus ? "border-brand" : "border-line"}`}>
              <p className="flex items-baseline gap-2">
                <span className="display text-lg text-accent">{i + 1}</span>
                <span className="font-semibold">{p.title}</span>
              </p>
              {(isFocus || list.length === 0) && <p className="text-sm">{short ? p.short : p.ask}</p>}
              {list.length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {list.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-start justify-between gap-2 text-sm">
                      <span className="whitespace-pre-wrap">
                        {b.status === "proposed" && <span className="badge mr-1.5 align-middle">Suggested</span>}
                        {b.body}
                      </span>
                      {canEdit && (
                        <span className="flex shrink-0 gap-3 text-[11px] tracking-[0.08em] text-muted uppercase">
                          {b.status === "proposed" && (
                            <form action={updateNote}>
                              <input type="hidden" name="projectId" value={projectId} />
                              <input type="hidden" name="back" value={back} />
                              <input type="hidden" name="itemId" value={b.id} />
                              <input type="hidden" name="status" value="confirmed" />
                              <button type="submit" className="uppercase hover:text-accent">Keep</button>
                            </form>
                          )}
                          <form action={updateNote}>
                            <input type="hidden" name="projectId" value={projectId} />
                            <input type="hidden" name="back" value={back} />
                            <input type="hidden" name="itemId" value={b.id} />
                            <input type="hidden" name="status" value="archived" />
                            <button type="submit" className="uppercase hover:text-accent">Remove</button>
                          </form>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {canEdit && (isFocus || list.length > 0) && (
                <form action={addNote} className="flex flex-col gap-2">
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="back" value={back} />
                  <input type="hidden" name="kind" value={p.kind} />
                  <label className="sr-only" htmlFor={`outline-${p.kind}`}>{p.title}</label>
                  <textarea id={`outline-${p.kind}`} name="body" rows={isFocus ? 3 : 2} required maxLength={2000}
                    placeholder={list.length ? "Add another beat…" : "In your words…"} className="field font-serif text-sm" />
                  <span><SubmitButton variant={isFocus ? "primary" : "default"} pendingText="Adding…">Add to {p.title.toLowerCase()}</SubmitButton></span>
                </form>
              )}
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-muted">
        Stuck? <Link href={`/projects/${projectId}/partners/story`} className="link-accent">Talk it through with your Storybuilder</Link>.
      </p>
    </section>
  );
}
