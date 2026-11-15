import Link from "next/link";
import { notFound } from "next/navigation";
import { Empty, Flash } from "@/components/flash";
import { SubmitButton } from "@/components/ui";
import { UploadArtwork } from "@/components/upload-artwork";
import { aiConfigured } from "@/lib/agents/run-story-breakdown";
import { currentUser, getAiBudget, getEntityWorkspace, getProjectShell, type VersionRow } from "@/lib/data";
import { addReference, approveRevision, linkEntities, renameEntity, requestBreakdown, saveRevision, unlinkEntities } from "../../actions";

export const maxDuration = 300;

const STATUS_LABEL: Record<VersionRow["status"], string> = {
  working: "Draft",
  submitted: "Proposed",
  approved: "Approved",
  rejected: "Not used",
  superseded: "Previously approved",
};

const KIND_HELP = {
  story: "Write or paste your story or treatment. It doesn't need to be a finished screenplay.",
  character: "Who is this character? Describe how they look, act and what they want.",
  location: "Describe the place: mood, light, era, what happens here.",
} as const;

const LINK_LABEL: Record<string, [string, string]> = {
  appears_in: ["appears in", "features"],
  set_in: ["is set in", "is the setting of"],
  related_to: ["is related to", "is related to"],
};

function when(iso: string) {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export default async function ItemWorkspace({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; entityId: string }>;
  searchParams: Promise<{ v?: string; error?: string; notice?: string }>;
}) {
  const { projectId, entityId } = await params;
  const { v, error, notice } = await searchParams;
  const [shell, ws, user, budget] = await Promise.all([
    getProjectShell(projectId), getEntityWorkspace(projectId, entityId), currentUser(), getAiBudget(projectId),
  ]);
  if (!shell || !ws) notFound();
  const { caps, entities } = shell;
  const { entity, versions, assets, artworkByVersion, relationships, references } = ws;
  const kind = entity.kind;

  const canonical = versions.find((x) => x.id === entity.current_version_id) ?? null;
  const selected = versions.find((x) => x.id === v) ?? canonical ?? versions[0] ?? null;
  const selectedArtwork = selected ? artworkByVersion.get(selected.id) ?? [] : [];
  const usedArtwork = new Set([...artworkByVersion.values()].flat());
  const assetName = new Map(assets.map((a) => [a.id, a.display_name]));
  const entityName = new Map(entities.map((e) => [e.id, `${e.name}`]));
  const isStale = !!selected && selected.base_version_id !== entity.current_version_id;
  const canApproveSelected =
    !!selected && caps.can_approve_canonical && (selected.status === "working" || selected.status === "submitted");

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">{kind}</p>
          {caps.can_edit ? (
            <form action={renameEntity} className="flex items-center gap-2">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="entityId" value={entityId} />
              <label className="sr-only" htmlFor="rename">Name</label>
              <input id="rename" name="name" defaultValue={entity.name} maxLength={120}
                className="min-h-11 rounded-lg border border-transparent bg-transparent text-3xl display hover:border-line focus:border-accent focus:outline-none" />
              <SubmitButton pendingText="…">Rename</SubmitButton>
            </form>
          ) : (
            <h2 className="display text-4xl leading-none">{entity.name}</h2>
          )}
        </div>
        <p className="help">{canonical ? `Approved: revision ${canonical.version_number}` : "No approved version yet"}</p>
      </header>

      <Flash error={error} notice={notice} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        {/* ------------------------------------------------ Editor / inspector */}
        <section className="flex flex-col gap-6">
          {selected && selected.id !== canonical?.id && (
            <div className="rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
              You're looking at <strong>revision {selected.version_number}</strong> ({STATUS_LABEL[selected.status]}).
              {canonical ? <> The approved version is revision {canonical.version_number}. </> : " "}
              {caps.can_edit && "Saving below creates a new revision starting from this one."}
            </div>
          )}

          {caps.can_edit ? (
            <form action={saveRevision} className="panel flex flex-col gap-4 p-5" key={selected?.id ?? "new"}>
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="entityId" value={entityId} />
              <input type="hidden" name="kind" value={kind} />
              <input type="hidden" name="parentVersionId" value={selected?.id ?? ""} />
              {/* The approved version this edit is based on; approval is refused if it has moved on. */}
              <input type="hidden" name="baseVersionId" value={entity.current_version_id ?? ""} />
              <p className="help">{KIND_HELP[kind]}</p>
              {kind === "story" ? (
                <div>
                  <label className="label" htmlFor="body">Story or treatment</label>
                  <textarea id="body" name="body" defaultValue={selected?.content.body ?? ""} rows={18}
                    className="field font-serif text-lg leading-relaxed" />
                </div>
              ) : (
                <>
                  <div>
                    <label className="label" htmlFor="summary">Description</label>
                    <textarea id="summary" name="summary" defaultValue={selected?.content.summary ?? ""} rows={5} className="field" />
                  </div>
                  <div>
                    <label className="label" htmlFor="notes">Development notes</label>
                    <textarea id="notes" name="notes" defaultValue={selected?.content.notes ?? ""} rows={6} className="field" />
                  </div>
                </>
              )}
              {kind !== "story" && assets.length > 0 && (
                <fieldset>
                  <legend className="label">Artwork in this revision</legend>
                  <div className="flex flex-wrap gap-3">
                    {assets.map((a) => (
                      <label key={a.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line px-2 py-1">
                        <input type="checkbox" name="assetIds" value={a.id} className="size-5"
                          defaultChecked={selectedArtwork.includes(a.id) || !usedArtwork.has(a.id)} />
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/assets/${a.id}`} alt="" className="size-10 rounded object-cover" />
                        <span className="max-w-40 truncate text-sm">{a.display_name}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              <div>
                <label className="label" htmlFor="changeSummary">What changed? (optional)</label>
                <input id="changeSummary" name="changeSummary" maxLength={500} className="field" />
              </div>
              <div className="flex flex-wrap gap-3">
                <SubmitButton variant="primary" name="intent" value="propose" pendingText="Saving…">Save revision</SubmitButton>
                <SubmitButton name="intent" value="draft" pendingText="Saving…">Save as draft</SubmitButton>
              </div>
              <p className="help">Saving never changes the approved version. Only the Director can approve.</p>
            </form>
          ) : selected ? (
            <article className="panel p-5">
              {kind === "story" ? (
                <div className="font-serif text-lg leading-relaxed whitespace-pre-wrap">{selected.content.body || "—"}</div>
              ) : (
                <div className="flex flex-col gap-4">
                  <p className="whitespace-pre-wrap">{selected.content.summary || "—"}</p>
                  {selected.content.notes && <p className="help whitespace-pre-wrap">{selected.content.notes}</p>}
                </div>
              )}
            </article>
          ) : (
            <Empty title="Nothing written yet" />
          )}

          {/* ------------------------------------------------ Artwork (large) */}
          {kind !== "story" && (
            <section className="panel flex flex-col gap-4 p-5" aria-labelledby="artwork-h">
              <h3 id="artwork-h" className="text-lg font-medium">
                Artwork {selected && <span className="help">· revision {selected.version_number}</span>}
              </h3>
              {selectedArtwork.length === 0 ? (
                <Empty title="No artwork in this revision">
                  {caps.can_edit ? "Upload a Procreate export, then save a revision that includes it." : null}
                </Empty>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {selectedArtwork.map((id) => (
                    <figure key={id} className="overflow-hidden rounded-lg border border-line bg-ink">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/assets/${id}`} alt={assetName.get(id) ?? "Artwork"} className="max-h-[70vh] w-full object-contain" />
                      <figcaption className="help px-3 py-2">{assetName.get(id) ?? "Artwork"}</figcaption>
                    </figure>
                  ))}
                </div>
              )}
              {caps.can_edit && <UploadArtwork entityId={entityId} />}
            </section>
          )}
        </section>

        {/* ------------------------------------------------ Side panels */}
        <aside className="flex flex-col gap-6">
          {kind === "story" && caps.can_edit && (
            <section className="panel flex flex-col gap-3 border-accent/40 p-4" aria-labelledby="lead-h">
              <h3 id="lead-h" className="font-medium">Story Lead</h3>
              <p className="help">Reads your latest saved story and suggests characters and locations. You decide what joins the film.</p>
              {!aiConfigured() ? (
                <p className="text-sm text-warn">The AI team isn&apos;t set up yet.</p>
              ) : !budget.available ? (
                <p className="text-sm text-warn">The team is resting until next month.</p>
              ) : versions.length === 0 ? (
                <p className="help">Save your story first.</p>
              ) : (
                <form action={requestBreakdown} className="flex flex-col gap-2">
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="entityId" value={entityId} />
                  <SubmitButton variant="primary" pendingText="Sending to the Story Lead…">Suggest characters &amp; locations</SubmitButton>
                  <p className="text-xs text-muted">Your saved story text is sent to Anthropic&apos;s Claude AI to make suggestions.</p>
                </form>
              )}
            </section>
          )}
          <section className="panel flex flex-col gap-3 p-4" aria-labelledby="history-h">
            <h3 id="history-h" className="font-medium">Revision history</h3>
            {versions.length === 0 ? (
              <Empty title="No revisions yet" />
            ) : (
              <ol className="flex flex-col gap-1">
                {versions.map((x) => (
                  <li key={x.id}>
                    <Link href={`?v=${x.id}`}
                      className={`flex min-h-11 flex-col justify-center rounded-lg px-3 py-2 hover:bg-panel-2 ${x.id === selected?.id ? "bg-panel-2 ring-1 ring-accent" : ""}`}>
                      <span className="flex items-center justify-between gap-2">
                        <span>Revision {x.version_number}</span>
                        <span className={`text-xs ${x.status === "approved" ? "text-ok" : x.status === "submitted" ? "text-warn" : "text-muted"}`}>
                          {STATUS_LABEL[x.status]}
                        </span>
                      </span>
                      <span className="text-xs text-muted">
                        {when(x.created_at)} · {x.created_by === user?.id ? "you" : "collaborator"}
                        {x.change_summary ? ` · ${x.change_summary}` : ""}
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
            {canApproveSelected && (
              <form action={approveRevision} className="flex flex-col gap-2 border-t border-line pt-3">
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="entityId" value={entityId} />
                <input type="hidden" name="versionId" value={selected!.id} />
                <input type="hidden" name="expectedCurrentId" value={entity.current_version_id ?? ""} />
                {isStale ? (
                  <p className="text-sm text-warn">
                    This revision was written before the current approved version. Open it, save a new revision, then approve that.
                  </p>
                ) : (
                  <p className="help">Approving makes revision {selected!.version_number} the version everyone sees. Earlier revisions stay in history.</p>
                )}
                <SubmitButton variant="primary" disabled={isStale} pendingText="Approving…">
                  Approve revision {selected!.version_number}
                </SubmitButton>
              </form>
            )}
          </section>

          <section className="panel flex flex-col gap-3 p-4" aria-labelledby="related-h">
            <h3 id="related-h" className="font-medium">Connected to</h3>
            {relationships.length === 0 ? (
              <Empty title="Not connected yet">Link characters to the story and the story to its locations.</Empty>
            ) : (
              <ul className="flex flex-col gap-1">
                {relationships.map((r) => {
                  const outgoing = r.source_entity_id === entityId;
                  const otherId = outgoing ? r.target_entity_id : r.source_entity_id;
                  const [outLabel, inLabel] = LINK_LABEL[r.relationship_type] ?? [r.relationship_type, r.relationship_type];
                  return (
                    <li key={r.id} className="flex items-center justify-between gap-2">
                      <Link href={`/projects/${projectId}/items/${otherId}`} className="flex min-h-11 items-center hover:text-accent">
                        <span className="help mr-1">{outgoing ? outLabel : inLabel}</span> {entityName.get(otherId) ?? "item"}
                      </Link>
                      {caps.can_edit && (
                        <form action={unlinkEntities}>
                          <input type="hidden" name="projectId" value={projectId} />
                          <input type="hidden" name="entityId" value={entityId} />
                          <input type="hidden" name="relationshipId" value={r.id} />
                          <button className="btn px-3" aria-label={`Remove link to ${entityName.get(otherId)}`}>×</button>
                        </form>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {caps.can_edit && entities.length > 1 && (
              <form action={linkEntities} className="flex flex-col gap-2 border-t border-line pt-3">
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="entityId" value={entityId} />
                <label className="label" htmlFor="link">Add a connection</label>
                <select id="link" name="link" className="field">
                  {kind === "character" && <option value="out:appears_in">appears in…</option>}
                  {kind === "story" && <option value="out:set_in">is set in…</option>}
                  {kind === "story" && <option value="in:appears_in">features…</option>}
                  {kind === "location" && <option value="in:set_in">is the setting of…</option>}
                  <option value="out:related_to">is related to…</option>
                </select>
                <select name="otherId" className="field" aria-label="Item to connect" required>
                  {entities.filter((e) => e.id !== entityId).map((e) => (
                    <option key={e.id} value={e.id}>{e.name} ({e.kind})</option>
                  ))}
                </select>
                <SubmitButton pendingText="Linking…">Connect</SubmitButton>
              </form>
            )}
          </section>

          <section className="panel flex flex-col gap-3 p-4" aria-labelledby="refs-h">
            <h3 id="refs-h" className="font-medium">References</h3>
            <p className="help">Inspiration from the web or your Drive. Always note who made it — references are for study, not for copying into the film.</p>
            {caps.can_edit && (
              <Link href={`/projects/${projectId}/import?to=${entityId}`} className="btn self-start">Add images from Google Drive</Link>
            )}
            {references.length === 0 ? (
              <Empty title="No references yet" />
            ) : (
              <ul className="flex flex-col gap-3">
                {references.map((r) => (
                  <li key={r.id} className="rounded-lg border border-line p-3">
                    {r.preview_asset_id && (
                      <a href={`/api/assets/${r.preview_asset_id}`} target="_blank" rel="noopener" className="mb-2 block bg-panel">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/assets/${r.preview_asset_id}`} alt={r.title ?? "Reference image"} loading="lazy" className="max-h-64 w-full object-contain" />
                      </a>
                    )}
                    <a href={r.source_url} target="_blank" rel="noopener noreferrer nofollow" className="font-medium hover:text-accent">
                      {r.title || r.source_domain}
                    </a>
                    <p className="text-xs text-muted">By {r.attribution} · {r.source_domain} · rights: {r.rights_status.replaceAll("_", " ")}</p>
                    {r.observations && <p className="help mt-1 whitespace-pre-wrap">{r.observations}</p>}
                  </li>
                ))}
              </ul>
            )}
            {caps.can_edit && (
              <form action={addReference} className="flex flex-col gap-2 border-t border-line pt-3">
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="entityId" value={entityId} />
                <input name="url" type="url" required placeholder="https://…" className="field" aria-label="Link" />
                <input name="title" placeholder="Title (optional)" className="field" aria-label="Title" />
                <input name="attribution" required placeholder="Who made it? (artist, museum, site)" className="field" aria-label="Attribution" />
                <textarea name="notes" rows={2} placeholder="What do you notice?" className="field" aria-label="Notes" />
                <select name="rights" className="field" aria-label="Rights" defaultValue="unknown">
                  <option value="unknown">Rights unknown</option>
                  <option value="public_domain">Public domain</option>
                  <option value="licensed">Licensed</option>
                  <option value="permission_granted">Permission granted</option>
                  <option value="not_for_reuse">Study only — not for reuse</option>
                </select>
                <SubmitButton pendingText="Adding…">Add reference</SubmitButton>
              </form>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
