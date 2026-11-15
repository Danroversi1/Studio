// One cast, shown on every desk (Story, Script, Overview). Each character is the same
// STUDIO item everywhere: editing it here saves a new revision of that character, so
// every desk shows the change.
import Link from "next/link";
import { addCharacter, saveCharacter } from "@/app/projects/[projectId]/actions";
import { SubmitButton } from "./ui";

export interface CastMemberRow { id: string; name: string; summary: string; notes: string; latestId: string | null; approved: boolean }

export function CastBox({ projectId, back, cast, canEdit, children }: {
  projectId: string; back: string; cast: CastMemberRow[]; canEdit: boolean;
  /** Optional editor shown above the list (the Story desk's written cast answer). */
  children?: React.ReactNode;
}) {
  return (
    <section id="cast" className="panel flex scroll-mt-6 flex-col gap-3 p-4" aria-labelledby="cast-h">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="cast-h" className="font-semibold">Cast</h2>
        <Link href={`/projects/${projectId}#characters`} className="text-xs text-accent">All characters</Link>
      </div>
      {children}
      {cast.length === 0 && <p className="text-sm text-muted">No characters yet.</p>}
      <ul className="flex flex-col gap-2">
        {cast.map((c) => (
          <li key={c.id} className="border-b border-line pb-2 last:border-0">
            <details>
              <summary className="cursor-pointer list-none">
                <span className="flex items-center gap-2 font-semibold">
                  {c.name}{!c.approved && <span className="size-1.5 bg-brand" title="Not approved yet" />}
                </span>
                <span className="mt-0.5 line-clamp-3 block text-sm text-muted">{c.summary || "No description yet."}</span>
                {canEdit && <span className="mt-1 block text-xs text-accent">Edit</span>}
              </summary>
              {canEdit && (
                <form action={saveCharacter} className="mt-2 flex flex-col gap-2">
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="entityId" value={c.id} />
                  <input type="hidden" name="parentVersionId" value={c.latestId ?? ""} />
                  <input type="hidden" name="notes" value={c.notes} />
                  <input type="hidden" name="back" value={back} />
                  <textarea name="summary" defaultValue={c.summary} rows={4} className="field font-serif" aria-label={`${c.name} description`} />
                  <span className="flex flex-wrap items-center gap-3">
                    <SubmitButton pendingText="Saving…">Save</SubmitButton>
                    <Link href={`/projects/${projectId}/items/${c.id}`} className="text-xs text-accent">Open {c.name}</Link>
                  </span>
                </form>
              )}
            </details>
          </li>
        ))}
      </ul>
      {canEdit && (
        <details>
          <summary className="cursor-pointer list-none text-sm text-accent">+ Add a character</summary>
          <form action={addCharacter} className="mt-2 flex flex-col gap-2">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="back" value={back} />
            <input name="name" required maxLength={120} placeholder="Name" className="field" aria-label="Character name" />
            <textarea name="summary" rows={3} placeholder="Who are they? What do they want?" className="field font-serif" aria-label="Character description" />
            <span><SubmitButton pendingText="Adding…">Add character</SubmitButton></span>
          </form>
        </details>
      )}
    </section>
  );
}
