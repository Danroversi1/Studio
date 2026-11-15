import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { Empty, Flash } from "@/components/flash";
import { SubmitButton } from "@/components/ui";
import { getAiBudget, getProjectShell, getSuggestions } from "@/lib/data";
import { acceptProposal, dismissProposal, mergeProposal, setAiBudget } from "../actions";

export const maxDuration = 300;

const RUN_LABEL: Record<string, string> = {
  queued: "Waiting to start…",
  running: "The Story Lead is reading your story…",
  succeeded: "Finished",
  failed: "Didn't finish",
  cancelled: "Cancelled",
};

export default async function SuggestionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { projectId } = await params;
  const { error, notice } = await searchParams;
  const shell = await getProjectShell(projectId);
  if (!shell || !shell.caps.member) notFound();
  const { caps, entities } = shell;
  if (!caps.can_review) {
    return <Empty title="Suggestions are for the creative team">You can read the approved versions of this film.</Empty>;
  }
  const [{ runs, proposals }, budget] = await Promise.all([getSuggestions(projectId), getAiBudget(projectId)]);
  const pending = proposals.filter((p) => p.status === "pending");
  const decided = proposals.filter((p) => p.status !== "pending").slice(-10).reverse();
  const inProgress = runs.some((r) => r.status === "queued" || r.status === "running");
  const latest = runs[0];
  const byId = new Map(entities.map((e) => [e.id, e]));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <AutoRefresh active={inProgress} />
      <header>
        <h2 className="display text-4xl leading-none">Suggestions</h2>
        <p className="help mt-1">
          Ideas from your team. Nothing joins your film until you accept it, and accepted items still need your approval.
        </p>
      </header>
      <Flash error={error} notice={notice} />

      {latest && (
        <div className={`panel px-4 py-3 text-sm ${latest.status === "failed" ? "border-danger/50" : ""}`} role="status">
          <strong>Story Lead:</strong> {RUN_LABEL[latest.status] ?? latest.status}
          {latest.status === "succeeded" && ` · ${latest.output_payload?.proposal_count ?? 0} suggestions`}
          {latest.status === "failed" && <span className="help"> · {latest.error_message} Your story was not changed; you can try again.</span>}
        </div>
      )}

      <section className="flex flex-col gap-4" aria-labelledby="pending-h">
        <h3 id="pending-h" className="text-lg font-medium">Waiting for you ({pending.length})</h3>
        {pending.length === 0 ? (
          <Empty title={inProgress ? "Suggestions will appear here in a moment" : "No suggestions waiting"}>
            {!inProgress && "Open your story and ask the Story Lead to suggest characters and locations."}
          </Empty>
        ) : (
          pending.map((p) => {
            const match = p.match_entity_id ? byId.get(p.match_entity_id) : undefined;
            const sameKind = entities.filter((e) => e.kind === p.entity_kind);
            return (
              <article key={p.id} className="panel flex flex-col gap-3 p-4">
                <p className="text-xs font-semibold tracking-wide text-muted uppercase">New {p.entity_kind} · from the Story Lead</p>
                {(p.evidence as string[]).length > 0 && (
                  <ul className="flex flex-col gap-1 border-l-2 border-accent/60 pl-3">
                    {(p.evidence as string[]).map((q, i) => (
                      <li key={i} className="font-serif text-sm italic">“{q}”</li>
                    ))}
                  </ul>
                )}
                {match && (
                  <p className="text-sm text-warn">
                    This looks like <Link className="underline" href={`/projects/${projectId}/items/${match.id}`}>{match.name}</Link>, who is already in your film.
                  </p>
                )}
                {caps.can_edit ? (
                  <>
                    <form action={acceptProposal} className="flex flex-col gap-2">
                      <input type="hidden" name="projectId" value={projectId} />
                      <input type="hidden" name="proposalId" value={p.id} />
                      <label className="label" htmlFor={`n-${p.id}`}>Name</label>
                      <input id={`n-${p.id}`} name="name" defaultValue={p.name} maxLength={120} className="field" />
                      <label className="label" htmlFor={`s-${p.id}`}>Description (edit it to make it yours)</label>
                      <textarea id={`s-${p.id}`} name="summary" defaultValue={p.summary ?? ""} rows={3} className="field" />
                      <div className="flex flex-wrap gap-2">
                        <SubmitButton variant={match ? "default" : "primary"} pendingText="Adding…">
                          Add as new {p.entity_kind}
                        </SubmitButton>
                      </div>
                    </form>
                    <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                      {sameKind.length > 0 && (
                        <form action={mergeProposal} className="flex flex-wrap gap-2">
                          <input type="hidden" name="projectId" value={projectId} />
                          <input type="hidden" name="proposalId" value={p.id} />
                          <label className="sr-only" htmlFor={`m-${p.id}`}>Same as</label>
                          <select id={`m-${p.id}`} name="targetId" defaultValue={match?.id ?? sameKind[0].id} className="field w-auto">
                            {sameKind.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                          </select>
                          <SubmitButton variant={match ? "primary" : "default"} pendingText="Linking…">It's the same as this one</SubmitButton>
                        </form>
                      )}
                      <form action={dismissProposal}>
                        <input type="hidden" name="projectId" value={projectId} />
                        <input type="hidden" name="proposalId" value={p.id} />
                        <SubmitButton pendingText="…">Not needed</SubmitButton>
                      </form>
                    </div>
                  </>
                ) : (
                  <div>
                    <p className="font-medium">{p.name}</p>
                    {p.summary && <p className="help">{p.summary}</p>}
                  </div>
                )}
              </article>
            );
          })
        )}
      </section>

      {decided.length > 0 && (
        <section className="panel flex flex-col gap-2 p-4" aria-labelledby="decided-h">
          <h3 id="decided-h" className="font-medium">Recently decided</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {decided.map((p) => (
              <li key={p.id} className="flex justify-between gap-2">
                {p.result_entity_id ? (
                  <Link href={`/projects/${projectId}/items/${p.result_entity_id}`} className="hover:text-accent">{p.name}</Link>
                ) : (
                  <span>{p.name}</span>
                )}
                <span className="text-muted">{p.status === "accepted" ? "added" : p.status === "merged" ? "linked" : "not needed"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {budget.can_manage && (
        <section className="panel flex flex-col gap-3 p-4" aria-labelledby="budget-h">
          <h3 id="budget-h" className="font-medium">AI budget (Executive Producer)</h3>
          <p className="text-sm">
            ${Number(budget.spent_usd ?? 0).toFixed(2)} used of ${Number(budget.budget_usd ?? 0).toFixed(2)} this month.
          </p>
          <div className="h-2 overflow-hidden rounded bg-panel-2" aria-hidden>
            <div className="h-full bg-accent"
              style={{ width: `${Math.min(100, (100 * Number(budget.spent_usd ?? 0)) / Math.max(Number(budget.budget_usd ?? 0), 0.01))}%` }} />
          </div>
          <form action={setAiBudget} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="projectId" value={projectId} />
            <div>
              <label className="label" htmlFor="budget">Monthly budget (USD)</label>
              <input id="budget" name="budget" type="number" min={0} max={100} step="0.5" defaultValue={budget.budget_usd} className="field w-32" />
            </div>
            <SubmitButton pendingText="Saving…">Save budget</SubmitButton>
          </form>
          <p className="help">When less than $0.25 is left, the team pauses until next month. Your director only sees that the team is resting.</p>
        </section>
      )}
    </div>
  );
}
