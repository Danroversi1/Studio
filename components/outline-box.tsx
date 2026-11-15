// Outline: beginning, middle and ending, built a step at a time. Each part shows a guiding
// question (fitted to the film length), her beats, and any beats the Storybuilder
// suggested (marked, until she keeps them). Stored in the story notebook, separate from
// her synopsis, so nothing here rewrites her text.
import Link from "next/link";
import { addNote, updateNote } from "@/app/projects/[projectId]/actions";
import type { NotebookItem } from "@/lib/data";
import { runtimeInfo, targetPages } from "@/lib/runtime";
import { SubmitButton } from "./ui";

const PARTS = [
  {
    kind: "beginning", title: "Beginning",
    ask: "What situation are we entering, and what sets something in motion?",
    short: "One moment that shows who we're with and what's about to change.",
    examples: ["A girl finds a strange key sewn into her grandmother's coat.", "The last bus leaves without him, and the town goes dark.", "A robot wakes up alone in an empty classroom."],
  },
  {
    kind: "middle", title: "Middle",
    ask: "What are the events that set up the climax?",
    short: "The events that set up the climax: what they try, and what gets in the way.",
    examples: ["She tries the key in every lock; one door won't open.", "A friend offers to help, but wants something in return.", "The plan works, until the storm cuts the power."],
  },
  {
    kind: "ending", title: "Ending",
    ask: "The climax unveils: all the events collide, setting up the resolution. What happens?",
    short: "The climax unveils: all the events collide, setting up the resolution.",
    examples: ["The storm hits as she reaches the door; she has to choose who to save.", "Everyone he lied to is in the same room, and the truth comes out.", "The robot's battery is dying; it uses the last charge to dance."],
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

const BANDS = [
  { kind: "beginning", label: "Beginning", from: 0, to: 0.25 },
  { kind: "middle", label: "Middle", from: 0.25, to: 0.75 },
  { kind: "ending", label: "Ending", from: 0.75, to: 1 },
] as const;

function fmt(minutes: number, total: number) {
  if (total <= 15) {
    const sec = Math.round(minutes * 60);
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  }
  return `${Math.round(minutes)} min`;
}

/** A linear view of the story: beginning, middle and ending across the film's length,
 * with each beat placed in order. Suggested beats are drawn hollow. */
function OutlineGraph({ beats, runtime }: { beats: NotebookItem[]; runtime: string | null }) {
  const total = runtime ? targetPages(runtime) : null;
  const placed = BANDS.flatMap((b) => {
    const list = beats.filter((x) => x.kind === b.kind);
    return list.map((x, i) => ({ beat: x, at: b.from + ((i + 1) / (list.length + 1)) * (b.to - b.from) }));
  });
  return (
    <figure className="flex flex-col gap-2" aria-label="Story outline from beginning to end">
      <div className="relative h-10 border border-line bg-panel-2">
        {BANDS.map((b, i) => (
          <div key={b.kind} className={`absolute inset-y-0 border-r border-line ${i === 1 ? "bg-text/5" : "bg-brand/10"}`}
            style={{ left: `${b.from * 100}%`, width: `${(b.to - b.from) * 100}%` }}>
            <span className="absolute top-1 left-1.5 text-[10px] font-semibold tracking-[0.12em] uppercase">{b.label}</span>
          </div>
        ))}
        {placed.map((p, i) => (
          <span key={p.beat.id} title={p.beat.body}
            className={`absolute bottom-1 flex size-5 -translate-x-1/2 items-center justify-center rounded-full text-[10px] font-bold ${p.beat.status === "proposed" ? "border-2 border-brand bg-panel-2 text-text" : "bg-brand text-text"}`}
            style={{ left: `${p.at * 100}%` }}>{i + 1}</span>
        ))}
      </div>
      <div className="relative h-4 text-[10px] text-muted">
        {[0, 0.25, 0.75, 1].map((t) => (
          <span key={t} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${t * 100}%` }}>
            {total ? fmt(t * total, total) : t === 0 ? "start" : t === 1 ? "end" : ""}
          </span>
        ))}
      </div>
      {placed.length > 0 && (
        <ol className="flex flex-col gap-0.5 text-xs">
          {placed.map((p, i) => (
            <li key={p.beat.id} className="flex gap-2">
              <span className="w-4 shrink-0 text-right font-bold text-accent">{i + 1}</span>
              <span className={`line-clamp-1 ${p.beat.status === "proposed" ? "text-muted italic" : ""}`}>{p.beat.body}</span>
            </li>
          ))}
        </ol>
      )}
      <figcaption className="text-[11px] text-muted">
        {total ? `Across about ${runtimeInfo(runtime)?.short}. ` : "Set the film length to see minutes. "}
        The split is a common guide, not a rule; hollow dots are suggestions.
      </figcaption>
    </figure>
  );
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
      <OutlineGraph beats={beats} runtime={runtime} />

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
              {isFocus && (
                <div className="text-xs text-muted">
                  <p className="tracking-[0.08em] uppercase">For example</p>
                  <ul className="mt-1 list-disc pl-5">{p.examples.map((x) => <li key={x}>{x}</li>)}</ul>
                </div>
              )}
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
