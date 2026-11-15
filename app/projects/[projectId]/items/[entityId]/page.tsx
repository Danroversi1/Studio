import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Empty, Flash } from "@/components/flash";
import { SubmitButton } from "@/components/ui";
import { LengthPicker } from "@/components/length-picker";
import { OutlineBox } from "@/components/outline-box";
import { RUNTIMES, runtimeInfo } from "@/lib/runtime";
import { UploadArtwork } from "@/components/upload-artwork";
import { aiConfigured } from "@/lib/agents/run-story-breakdown";
import { parseGoogleLink, slidesEmbedUrl } from "@/lib/google/links";
import { INTAKE_QUESTIONS, TREATMENT_ATTRIBUTION, parseIntake, isTreatmentRef } from "@/lib/intake";
import { currentUser, getAiBudget, getNotebook, getEntityWorkspace, getProjectShell, type VersionRow } from "@/lib/data";
import { addReference, approveRevision, linkEntities, renameEntity, requestBreakdown, saveRevision, saveSynopsis, setThumbnail, unlinkEntities } from "../../actions";

export const maxDuration = 300;

const STATUS_LABEL: Record<VersionRow["status"], string> = {
  working: "Draft",
  submitted: "Proposed",
  approved: "Approved",
  rejected: "Not used",
  superseded: "Previously approved",
};

const KIND_HELP = {
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
  const [shell, ws, user, budget, notebook] = await Promise.all([
    getProjectShell(projectId), getEntityWorkspace(projectId, entityId), currentUser(), getAiBudget(projectId),
    getNotebook(projectId),
  ]);
  if (!shell || !ws) notFound();
  const { caps, entities } = shell;
  const { entity, versions, assets, artworkByVersion, relationships, references } = ws;
  const kind = entity.kind;
  const runtime = (shell.project as { runtime?: string | null }).runtime ?? null;
  if ((kind as string) === "screenplay") redirect(`/projects/${projectId}/script`);

  const canonical = versions.find((x) => x.id === entity.current_version_id) ?? null;
  const selected = versions.find((x) => x.id === v) ?? canonical ?? versions[0] ?? null;
  const selectedArtwork = selected ? artworkByVersion.get(selected.id) ?? [] : [];
  const usedArtwork = new Set([...artworkByVersion.values()].flat());
  const assetName = new Map(assets.map((a) => [a.id, a.display_name]));
  const entityName = new Map(entities.map((e) => [e.id, `${e.name}`]));
  const isStale = !!selected && selected.base_version_id !== entity.current_version_id;
  const canApproveSelected =
    !!selected && caps.can_approve_canonical && (selected.status === "working" || selected.status === "submitted");

  const base = `/projects/${projectId}`;
  const isStory = kind === "story";
  const latest = versions[0] ?? null;
  const answers = parseIntake(selected?.content.body ?? "");
  const treatments = isStory ? references.filter((r) => isTreatmentRef(r)) : [];
  const otherRefs = isStory ? references.filter((r) => !isTreatmentRef(r)) : references;
  const canConnect = caps.can_edit && entities.length > 1;

  /* ---------------------------------------------------------------- pieces */
  const versionTag = selected ? (
    <span className="flex items-center gap-2">
      <span className="badge">v.{selected.version_number}</span>
      <span className={`text-xs ${selected.status === "approved" ? "text-ok" : "text-muted"}`}>
        {selected.id === canonical?.id ? "Approved" : STATUS_LABEL[selected.status]}
        {latest && selected.id !== latest.id ? ` · newest is v.${latest.version_number}` : ""}
      </span>
    </span>
  ) : <span className="text-xs text-muted">Nothing saved yet</span>;

  const revisionsLayer = versions.length > 0 && (
    <details className="group relative">
      <summary className="btn cursor-pointer list-none">Revisions ({versions.length})</summary>
      <div className="absolute right-0 z-20 mt-2 flex w-80 flex-col gap-3 border border-line bg-panel-2 p-4 shadow-lg">
        <ol className="flex max-h-80 flex-col gap-1 overflow-y-auto">
          {versions.map((x) => (
            <li key={x.id}>
              <Link href={`?v=${x.id}`}
                className={`flex min-h-11 flex-col justify-center px-3 py-2 hover:bg-panel ${x.id === selected?.id ? "bg-panel ring-1 ring-accent" : ""}`}>
                <span className="flex items-center justify-between gap-2">
                  <span>v.{x.version_number}</span>
                  <span className={`text-xs ${x.status === "approved" ? "text-ok" : x.status === "submitted" ? "text-warn" : "text-muted"}`}>
                    {STATUS_LABEL[x.status]}
                  </span>
                </span>
                <span className="text-xs text-muted">
                  {when(x.created_at)} · {x.created_by === user?.id ? "you" : "collaborator"}{x.change_summary ? ` · ${x.change_summary}` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ol>
        {canApproveSelected && (
          <form action={approveRevision} className="flex flex-col gap-2 border-t border-line pt-3">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="entityId" value={entityId} />
            <input type="hidden" name="versionId" value={selected!.id} />
            <input type="hidden" name="expectedCurrentId" value={entity.current_version_id ?? ""} />
            {isStale ? (
              <p className="text-sm text-warn">v.{selected!.version_number} was written before the approved version. Save a new version from it, then approve that.</p>
            ) : (
              <p className="help">Approving makes v.{selected!.version_number} the version everyone sees. Earlier versions stay here.</p>
            )}
            <SubmitButton variant="primary" disabled={isStale} pendingText="Approving…">Approve v.{selected!.version_number}</SubmitButton>
          </form>
        )}
      </div>
    </details>
  );

  const refList = (list: typeof references) => (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {list.map((r) => (
        <li key={r.id} className="border border-line p-3">
          {r.preview_asset_id && (
            <a href={`/api/assets/${r.preview_asset_id}`} target="_blank" rel="noopener" className="mb-2 block bg-panel">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/assets/${r.preview_asset_id}`} alt={r.title ?? "Reference image"} loading="lazy" className="max-h-56 w-full object-contain" />
            </a>
          )}
          <a href={r.source_url} target="_blank" rel="noopener noreferrer nofollow" className="font-medium hover:text-accent">{r.title || r.source_domain}</a>
          <p className="text-xs text-muted">By {r.attribution} · {r.source_domain} · rights: {r.rights_status.replaceAll("_", " ")}</p>
          {r.observations && <p className="help mt-1 whitespace-pre-wrap">{r.observations}</p>}
        </li>
      ))}
    </ul>
  );

  const addRefForm = caps.can_edit && (
    <details className="border-t border-line pt-3">
      <summary className="cursor-pointer list-none text-sm text-accent">+ Add a reference link</summary>
      <form action={addReference} className="mt-3 flex flex-col gap-2">
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
    </details>
  );

  // Connections appear once there is something to connect; until then, a quiet link.
  const connected = (relationships.length > 0 || canConnect) && (
    relationships.length === 0 ? (
      <details className="panel p-4">
        <summary className="cursor-pointer list-none text-sm text-accent">+ Connect {isStory ? "characters and locations" : "to the story"}</summary>
        {connectForm()}
      </details>
    ) : (
      <section className="panel flex flex-col gap-3 p-4" aria-labelledby="related-h">
        <h3 id="related-h" className="font-medium">Connected to</h3>
        <ul className="flex flex-col gap-1">
          {relationships.map((r) => {
            const outgoing = r.source_entity_id === entityId;
            const otherId = outgoing ? r.target_entity_id : r.source_entity_id;
            const [outLabel, inLabel] = LINK_LABEL[r.relationship_type] ?? [r.relationship_type, r.relationship_type];
            return (
              <li key={r.id} className="flex items-center justify-between gap-2">
                <Link href={`${base}/items/${otherId}`} className="flex min-h-11 items-center hover:text-accent">
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
        {canConnect && <details><summary className="cursor-pointer list-none text-sm text-accent">+ Add a connection</summary>{connectForm()}</details>}
      </section>
    )
  );

  function connectForm() {
    return (
      <form action={linkEntities} className="mt-3 flex flex-col gap-2">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="entityId" value={entityId} />
        <label className="sr-only" htmlFor="link">Connection</label>
        <select id="link" name="link" className="field">
          {kind === "character" && <option value="out:appears_in">appears in…</option>}
          {kind === "story" && <option value="in:appears_in">features…</option>}
          {kind === "story" && <option value="out:set_in">is set in…</option>}
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
    );
  }

  /* ------------------------------------------------- story: guided questions */
  const storyHidden = (skip: string) => (
    <>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="entityId" value={entityId} />
      <input type="hidden" name="parentVersionId" value={selected?.id ?? ""} />
      <input type="hidden" name="baseVersionId" value={entity.current_version_id ?? ""} />
      <input type="hidden" name="back" value={`${base}/items/${entityId}`} />
      {INTAKE_QUESTIONS.filter((q) => q.key !== skip).map((q) => (
        <input key={q.key} type="hidden" name={q.key} value={answers[q.key]} />
      ))}
    </>
  );
  const followUps = INTAKE_QUESTIONS.filter((q) => q.key !== "idea");
  const allAnswered = followUps.every((q) => answers[q.key].trim());
  const storyLead = isStory && (
    <div className="flex flex-col gap-4" aria-label="Story questions">
      {followUps.map((q) => {
        const answered = !!answers[q.key].trim();
        return (
          <section key={q.key} className="panel flex flex-col gap-2 p-4">
            {answered ? (
              <details>
                <summary className="cursor-pointer list-none">
                  <span className="block font-semibold">{q.label}</span>
                  <span className="mt-1 line-clamp-4 block text-sm whitespace-pre-wrap text-muted">{answers[q.key]}</span>
                  {caps.can_edit && <span className="mt-1 block text-xs text-accent">Edit</span>}
                </summary>
                {caps.can_edit && (
                  <form action={saveSynopsis} className="mt-2 flex flex-col gap-2">
                    {storyHidden(q.key)}
                    <textarea name={q.key} defaultValue={answers[q.key]} rows={5} className="field font-serif" aria-label={q.label} />
                    <span><SubmitButton pendingText="Saving…">Save</SubmitButton></span>
                  </form>
                )}
              </details>
            ) : caps.can_edit ? (
              <form action={saveSynopsis} className="flex flex-col gap-2">
                {storyHidden(q.key)}
                <label htmlFor={`lead-${q.key}`} className="font-semibold">{q.label}</label>
                <p className="text-sm">{q.help}</p>
                <textarea id={`lead-${q.key}`} name={q.key} rows={4} required placeholder={q.placeholder} className="field font-serif" />
                <p className="text-xs text-muted">{q.why}</p>
                <span><SubmitButton variant="primary" pendingText="Saving…">Save answer</SubmitButton></span>
              </form>
            ) : (
              <p className="text-sm text-muted">{q.label} Not answered yet.</p>
            )}
          </section>
        );
      })}
      {caps.can_edit && answers.idea.trim() && allAnswered && aiConfigured() && budget.available && (
        <form action={requestBreakdown} className="panel flex flex-col gap-2 p-4">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="entityId" value={entityId} />
          <SubmitButton pendingText="Sending…">Suggest characters &amp; locations</SubmitButton>
          <p className="text-xs text-muted">Suggestions wait for you in Suggestions. Sent to Anthropic&apos;s Claude AI.</p>
        </form>
      )}
    </div>
  );

  // Thumbnail chooser for characters and locations: their artwork or reference images.
  const thumbId = (entity as { metadata?: Record<string, unknown> | null }).metadata?.thumbnail_asset_id as string | undefined;
  const thumbChoices = [
    ...assets.map((a) => ({ id: a.id, name: a.display_name })),
    ...references.filter((r) => r.preview_asset_id).map((r) => ({ id: r.preview_asset_id as string, name: r.title ?? "Reference" })),
  ];
  const thumbnailPanel = !isStory && (
    <section id="thumbnail" className="panel flex scroll-mt-6 flex-col gap-3 p-4" aria-labelledby="thumb-h">
      <h3 id="thumb-h" className="font-medium">Thumbnail</h3>
      {thumbId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/assets/${thumbId}`} alt={`${entity.name} thumbnail`} className="aspect-[4/3] w-full border border-line object-cover" />
      ) : (
        <p className="help">Pick the picture that shows on {entity.name}&apos;s card.</p>
      )}
      {caps.can_edit && (thumbChoices.length === 0 ? (
        <p className="text-xs text-muted">Upload artwork or add a reference image here first, then choose it as the thumbnail.</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2">
          {thumbChoices.map((c) => (
            <li key={c.id}>
              <form action={setThumbnail}>
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="entityId" value={entityId} />
                <input type="hidden" name="assetId" value={c.id} />
                <button type="submit" title={`Use ${c.name}`} aria-pressed={c.id === thumbId}
                  className={`block aspect-square w-full overflow-hidden border-2 ${c.id === thumbId ? "border-brand" : "border-transparent hover:border-line"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/assets/${c.id}`} alt={c.name} className="size-full object-cover" loading="lazy" />
                </button>
              </form>
            </li>
          ))}
        </ul>
      ))}
    </section>
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">{isStory ? "Story" : kind}</p>
          {caps.can_edit ? (
            <form action={renameEntity} className="flex items-center gap-2">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="entityId" value={entityId} />
              <label className="sr-only" htmlFor="rename">Name</label>
              <input id="rename" name="name" defaultValue={entity.name} maxLength={120}
                className="min-h-11 border border-transparent bg-transparent text-3xl display hover:border-line focus:border-accent focus:outline-none" />
              <SubmitButton pendingText="…">Rename</SubmitButton>
            </form>
          ) : (
            <h2 className="display text-4xl leading-none">{entity.name}</h2>
          )}
          {versionTag}
        </div>
        {revisionsLayer}
      </header>

      <Flash error={error} notice={notice} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="flex flex-col gap-6">
          {isStory && (
            <LengthPicker projectId={projectId} back={`${base}/items/${entityId}`} runtime={runtime}
              canEdit={!!caps.can_edit} helpHref={`${base}/partners/story`} />
          )}
          {isStory ? (
            caps.can_edit ? (
              <form action={saveSynopsis} className="panel flex flex-col gap-3 p-5" key={selected?.id ?? "new"}>
                {storyHidden("idea")}
                <label className="label" htmlFor="idea">Synopsis</label>
                <p className="text-sm">{INTAKE_QUESTIONS[0].label} {INTAKE_QUESTIONS[0].help}</p>
                <textarea id="idea" name="idea" defaultValue={answers.idea} rows={12} required
                  placeholder={INTAKE_QUESTIONS[0].placeholder} className="field font-serif text-lg leading-relaxed" />
                <div className="flex flex-wrap items-center gap-3">
                  <SubmitButton variant="primary" pendingText="Saving…">Save</SubmitButton>
                  <p className="text-xs text-muted">Saving makes a new version; earlier ones stay under Revisions.</p>
                </div>
              </form>
            ) : selected ? (
              <article className="panel p-5">
                <p className="label">Synopsis</p>
                <div className="font-serif text-lg leading-relaxed whitespace-pre-wrap">{answers.idea || "—"}</div>
              </article>
            ) : (
              <Empty title="Nothing written yet" />
            )
          ) : caps.can_edit ? (
            <form action={saveRevision} className="panel flex flex-col gap-4 p-5" key={selected?.id ?? "new"}>
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="entityId" value={entityId} />
              <input type="hidden" name="kind" value={kind} />
              <input type="hidden" name="parentVersionId" value={selected?.id ?? ""} />
              {/* The approved version this edit is based on; approval is refused if it has moved on. */}
              <input type="hidden" name="baseVersionId" value={entity.current_version_id ?? ""} />
              <div>
                <label className="label" htmlFor="summary">Description</label>
                <textarea id="summary" name="summary" defaultValue={selected?.content.summary ?? ""} rows={5} className="field"
                  placeholder={KIND_HELP[kind as "character" | "location"]} />
              </div>
              <div>
                <label className="label" htmlFor="notes">Development notes</label>
                <textarea id="notes" name="notes" defaultValue={selected?.content.notes ?? ""} rows={6} className="field" />
              </div>
              {assets.length > 0 && (
                <fieldset>
                  <legend className="label">Artwork in this version</legend>
                  <div className="flex flex-wrap gap-3">
                    {assets.map((a) => (
                      <label key={a.id} className="flex min-h-11 cursor-pointer items-center gap-2 border border-line px-2 py-1">
                        <input type="checkbox" name="assetIds" value={a.id} className="size-5"
                          defaultChecked={selectedArtwork.includes(a.id) || !usedArtwork.has(a.id)} />
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/assets/${a.id}`} alt="" className="size-10 object-cover" />
                        <span className="max-w-40 truncate text-sm">{a.display_name}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              <div className="flex flex-wrap gap-3">
                <SubmitButton variant="primary" name="intent" value="propose" pendingText="Saving…">Save</SubmitButton>
                <SubmitButton name="intent" value="draft" pendingText="Saving…">Save as draft</SubmitButton>
              </div>
            </form>
          ) : selected ? (
            <article className="panel flex flex-col gap-4 p-5">
              <p className="whitespace-pre-wrap">{selected.content.summary || "—"}</p>
              {selected.content.notes && <p className="help whitespace-pre-wrap">{selected.content.notes}</p>}
            </article>
          ) : (
            <Empty title="Nothing written yet" />
          )}

          {isStory && <OutlineBox projectId={projectId} items={notebook.filter((n) => ["beginning", "middle", "ending"].includes(n.kind))}
            runtime={runtime} canEdit={!!caps.can_edit} back={`${base}/items/${entityId}`} />}

          {!isStory && (
            <section className="panel flex flex-col gap-4 p-5" aria-labelledby="artwork-h">
              <h3 id="artwork-h" className="text-lg font-medium">
                Artwork {selected && <span className="help">· v.{selected.version_number}</span>}
              </h3>
              {selectedArtwork.length === 0 ? (
                <Empty title="No artwork in this version">
                  {caps.can_edit ? "Upload a Procreate export, then save a version that includes it." : null}
                </Empty>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {selectedArtwork.map((id) => (
                    <figure key={id} className="overflow-hidden border border-line bg-ink">
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

        <aside className="flex flex-col gap-6">
          {storyLead}
          {thumbnailPanel}
          {connected}
          {!isStory && (
            <section className="panel flex flex-col gap-3 p-4" aria-labelledby="refs-h">
              <h3 id="refs-h" className="font-medium">References</h3>
              {caps.can_edit && (
                <Link href={`${base}/import?to=${entityId}`} className="btn self-start">Add images from Google Drive</Link>
              )}
              {otherRefs.length === 0 ? <p className="help">No references yet.</p> : refList(otherRefs)}
              {addRefForm}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
