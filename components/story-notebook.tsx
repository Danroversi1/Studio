// The story notebook: the developing story beside the conversation. Her own decisions,
// the partner's proposals (until she keeps them), open questions, beginning/middle/ending
// as they emerge, For later, and one next step. Separate from her draft; nothing here
// changes her synopsis or script. Empty sections stay hidden.
import { addNote, setRuntime, updateNote } from "@/app/projects/[projectId]/actions";
import type { NotebookItem } from "@/lib/data";
import { RUNTIMES, runtimeInfo } from "@/lib/runtime";
import { SubmitButton } from "./ui";

const SECTIONS: { title: string; kinds: string[]; note?: string }[] = [
  { title: "Next step", kinds: ["next_action"] },
  { title: "Beginning", kinds: ["beginning"], note: "What situation are we entering, and what sets something in motion?" },
  { title: "Middle", kinds: ["middle"], note: "What develops through actions, obstacles or discoveries?" },
  { title: "Ending", kinds: ["ending"], note: "What is decided, revealed or changed?" },
  { title: "Decided", kinds: ["decision"] },
  { title: "Ideas to consider", kinds: ["idea"] },
  { title: "Open questions", kinds: ["question"] },
  { title: "For later", kinds: ["for_later"], note: "Ideas parked for a later or bigger version. Nothing here is lost." },
];

const ADD_KINDS = [
  ["decision", "I decided…"], ["idea", "An idea"], ["question", "A question"], ["beginning", "Beginning"],
  ["middle", "Middle"], ["ending", "Ending"], ["for_later", "For later"], ["next_action", "My next step"],
] as const;

function Act({ projectId, back, itemId, status, kind, label }: {
  projectId: string; back: string; itemId: string; status?: string; kind?: string; label: string;
}) {
  return (
    <form action={updateNote}>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="itemId" value={itemId} />
      {status && <input type="hidden" name="status" value={status} />}
      {kind && <input type="hidden" name="kind" value={kind} />}
      <button type="submit" className="text-[11px] tracking-[0.08em] text-muted uppercase underline-offset-2 hover:text-accent hover:underline">{label}</button>
    </form>
  );
}

function Item({ n, projectId, back, canEdit }: { n: NotebookItem; projectId: string; back: string; canEdit: boolean }) {
  const proposed = n.status === "proposed";
  const done = n.status === "done";
  return (
    <li className={`flex flex-col gap-1 border-b border-line py-2 last:border-0 ${done ? "opacity-60" : ""}`}>
      <p className={`text-sm whitespace-pre-wrap ${done ? "line-through" : ""}`}>
        {proposed && <span className="badge mr-1.5 align-middle">Suggested</span>}
        {n.body}
      </p>
      {n.her_words && n.source === "agent" && (
        <p className="text-[11px] text-muted">From your words: “{n.her_words}”</p>
      )}
      {canEdit && !done && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {proposed && <Act projectId={projectId} back={back} itemId={n.id} status="confirmed" kind={n.kind === "idea" ? "decision" : undefined} label="Keep" />}
          {n.kind === "question" && <Act projectId={projectId} back={back} itemId={n.id} status="done" label="Answered" />}
          {n.kind === "next_action" && <Act projectId={projectId} back={back} itemId={n.id} status="done" label="Done" />}
          {n.kind === "for_later" && <Act projectId={projectId} back={back} itemId={n.id} kind="idea" status="proposed" label="Bring back" />}
          {n.kind !== "for_later" && n.kind !== "next_action" && <Act projectId={projectId} back={back} itemId={n.id} kind="for_later" status="confirmed" label="For later" />}
          <details className="group">
            <summary className="cursor-pointer list-none text-[11px] tracking-[0.08em] text-muted uppercase hover:text-accent">Edit</summary>
            <form action={updateNote} className="mt-1.5 flex flex-col gap-1.5">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name="itemId" value={n.id} />
              <textarea name="body" defaultValue={n.body} rows={3} maxLength={2000} className="field text-sm" aria-label="Edit note" />
              <SubmitButton pendingText="…">Save</SubmitButton>
            </form>
          </details>
          <Act projectId={projectId} back={back} itemId={n.id} status="archived" label="Remove" />
        </div>
      )}
    </li>
  );
}

export function StoryNotebook({ projectId, runtime, items, canEdit, back, storyHref }: {
  projectId: string; runtime: string | null; items: NotebookItem[]; canEdit: boolean; back: string; storyHref: string;
}) {
  const rt = runtimeInfo(runtime);
  const visible = items.filter((n) => n.status !== "archived");
  return (
    <section className="panel flex flex-col" aria-labelledby="nb-h">
      <div className="flex items-baseline justify-between gap-2 border-b border-line px-4 py-3">
        <h2 id="nb-h" className="display text-lg">Story notebook</h2>
        <a href={storyHref} className="link-accent text-xs">Your draft ↗</a>
      </div>

      <div className="flex flex-col gap-1 border-b border-line px-4 py-3">
        <p className="eyebrow">Film length</p>
        {canEdit ? (
          <form action={setRuntime} className="flex items-center gap-2">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="back" value={back} />
            <label className="sr-only" htmlFor="nb-runtime">Film length</label>
            <select id="nb-runtime" name="runtime" defaultValue={runtime ?? ""} className="field min-h-9 py-1 text-sm">
              <option value="">Not decided yet</option>
              {RUNTIMES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <SubmitButton pendingText="…">Set</SubmitButton>
          </form>
        ) : (
          <p className="text-sm">{rt?.label ?? "Not decided yet"}</p>
        )}
        <p className="text-xs text-muted">{rt ? rt.focus : "Your Story partner can help you choose. Any length is a real film."}</p>
      </div>

      {visible.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted">
          As you talk, your decisions, ideas, open questions and the beginning, middle and ending of your film collect here.
        </p>
      ) : (
        SECTIONS.map((sec) => {
          const list = visible.filter((n) => sec.kinds.includes(n.kind))
            .sort((a, b) => Number(a.status === "done") - Number(b.status === "done"));
          if (!list.length) return null;
          return (
            <div key={sec.title} className="border-b border-line px-4 py-3">
              <p className="eyebrow">{sec.title}</p>
              {sec.note && <p className="text-[11px] text-muted">{sec.note}</p>}
              <ul className="mt-1">{list.map((n) => <Item key={n.id} n={n} projectId={projectId} back={back} canEdit={canEdit} />)}</ul>
            </div>
          );
        })
      )}

      {canEdit && (
        <form action={addNote} className="flex flex-col gap-2 px-4 py-3">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="back" value={back} />
          <p className="eyebrow">Add a note</p>
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="nb-kind">Section</label>
            <select id="nb-kind" name="kind" className="field min-h-9 w-auto py-1 text-sm" defaultValue="decision">
              {ADD_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <label className="sr-only" htmlFor="nb-body">Note</label>
          <textarea id="nb-body" name="body" rows={2} maxLength={2000} required className="field text-sm" placeholder="In your words…" />
          <SubmitButton pendingText="Adding…">Add</SubmitButton>
        </form>
      )}
    </section>
  );
}
