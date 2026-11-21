import { CharacterAgent } from "@/components/characters/character-agent";
import { RoleButtons } from "@/components/characters/role-picker";
import { CharacterFeelings } from "@/components/sim/character-feelings";
import { getCharacterFeelings } from "@/lib/sim/data";
import { CharacterBubblePanel } from "@/components/bubbles/bubble-panels";
import { getBubbleDesk, getCharacterBubble } from "@/lib/bubbles/data";
import { ROLE_LABEL, roleOf } from "@/lib/characters/roles";
import { getCharacterAgent } from "@/lib/characters/data";
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
import { currentUser, getAiBudget, getBoard, getCast, getNotebook, getScreenplay, getStoryReferences, getEntityWorkspace, getProjectShell, type VersionRow } from "@/lib/data";
import { CastBox } from "@/components/cast-box";
import { autoEdges } from "@/lib/board";
import { ThumbView } from "@/components/thumb-view";
import { TreatmentCropPicker } from "@/components/treatment-crop-picker";
import { thumbOf } from "@/lib/thumb";
import type { SlideInfo } from "@/lib/slide-match";
import { parseCast } from "@/lib/cast";
import { addReference, approveRevision, renameEntity, requestBreakdown, saveRevision, saveSynopsis, setThumbnail } from "../../actions";

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


function when(iso: string) {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export default async function ItemWorkspace({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; entityId: string }>;
  searchParams: Promise<{ v?: string; error?: string; notice?: string; day?: string }>;
}) {
  const { projectId, entityId } = await params;
  const { v, error, notice, day } = await searchParams;
  const [shell, ws, user, budget, notebook, cast, board, sp] = await Promise.all([
    getProjectShell(projectId), getEntityWorkspace(projectId, entityId), currentUser(), getAiBudget(projectId),
    getNotebook(projectId), getCast(projectId), getBoard(projectId), getScreenplay(projectId),
  ]);
  const agent = ws?.entity.kind === "character" ? await getCharacterAgent(projectId, entityId) : null;
  const feelings = ws?.entity.kind === "character" ? await getCharacterFeelings(projectId, entityId, roleOf(ws.entity.metadata as Record<string, unknown> | null)) : null;
  const bubbleDesk = ws?.entity.kind === "character" ? await getBubbleDesk(projectId) : null;
  const bubble = ws?.entity.kind === "character" ? await getCharacterBubble(projectId, entityId, roleOf(ws.entity.metadata as Record<string, unknown> | null), day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined) : null;
  const storyEntity = shell?.entities.find((e) => e.kind === "story");
  const storyRefs = storyEntity ? await getStoryReferences(projectId, storyEntity.id) : [];
  if (!shell || !ws) notFound();
  const boardAuto = autoEdges({
    entities: shell.entities.filter((e) => e.kind === "character" || e.kind === "location").map((e) => ({ id: e.id, kind: e.kind as "character" | "location", name: e.name, summary: "" })),
    script: String(sp?.versions?.[0]?.content?.body ?? ""), showScenes: false,
  });
  const { caps, entities } = shell;
  const { entity, versions, assets, artworkByVersion, references } = ws;
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

  // Connections live on the board; here, a read-only view of this card's strings.
  const myKey = `e:${entityId}`;
  const mine = isStory ? [] : [
    ...board.links.filter((l) => l.from === myKey || l.to === myKey).map((l) => ({ other: l.from === myKey ? l.to : l.from, label: l.label ?? "connected", hers: true })),
    ...boardAuto.filter((e) => e.from === myKey || e.to === myKey).map((e) => ({ other: e.from === myKey ? e.to : e.from, label: e.weight > 1 ? `${e.label} (${e.weight} scenes)` : e.label, hers: false })),
  ];
  const otherName = (k: string) => k.startsWith("e:") ? (entityName.get(k.slice(2)) ?? "item") : k.startsWith("n:") ? "a note" : "a reference";
  const connected = !isStory && (
    <section className="panel flex flex-col gap-2 p-4" aria-labelledby="related-h">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id="related-h" className="font-medium">Connections</h3>
        <Link href={`${base}/connections`} className="text-xs text-accent">Open the board</Link>
      </div>
      {mine.length === 0 ? <p className="text-sm text-muted">Nothing connected yet.</p> : (
        <ul className="flex flex-col">
          {mine.map((m, i) => (
            <li key={i} className={`border-t border-line py-1.5 text-sm ${m.hers ? "" : "text-muted"}`}>
              {m.other.startsWith("e:") ? <Link href={`${base}/items/${m.other.slice(2)}`} className="font-medium hover:text-accent">{otherName(m.other)}</Link> : otherName(m.other)}
              <span className="text-muted"> · {m.label}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

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
  const allAnswered = followUps.every((q) => answers[q.key].trim() || (q.key === "who" && cast.length > 0));
  const storyLead = isStory && (
    <div className="flex flex-col gap-4" aria-label="Story questions">
      {followUps.map((q) => {
        const answered = !!answers[q.key].trim();
        if (q.key === "who" && (answered || cast.length > 0)) {
          return (
            <CastBox key={q.key} projectId={projectId} back={`${base}/items/${entityId}`} cast={cast} canEdit={!!caps.can_edit}
              originals={Object.fromEntries(parseCast(answers.who).map((c) => [c.name.toLowerCase(), c.description]))}>
              {caps.can_edit && answered && (
                <details>
                  <summary className="cursor-pointer list-none text-xs text-accent">Edit your cast answer</summary>
                  <form action={saveSynopsis} className="mt-2 flex flex-col gap-2">
                    {storyHidden(q.key)}
                    <input type="hidden" name="syncCast" value="1" />
                    <textarea name={q.key} defaultValue={answers[q.key]} rows={6} className="field font-serif" aria-label={q.label} />
                    <p className="text-xs text-muted">Write each as “Name: who they are”. Saving updates Characters on every desk.</p>
                    <span><SubmitButton pendingText="Saving…">Save</SubmitButton></span>
                  </form>
                </details>
              )}
            </CastBox>
          );
        }
        return (
          <section key={q.key} className="panel flex flex-col gap-2 p-4">
            {answered ? (
              <details>
                <summary className="cursor-pointer list-none">
                  <span className="block font-semibold">{"answeredTitle" in q ? q.answeredTitle : q.label}</span>
                  <span className="mt-1 line-clamp-4 block text-sm whitespace-pre-wrap text-muted">{answers[q.key]}</span>
                  {caps.can_edit && <span className="mt-1 block text-xs text-accent">Edit</span>}
                </summary>
                {caps.can_edit && (
                  <form action={saveSynopsis} className="mt-2 flex flex-col gap-2">
                    {storyHidden(q.key)}
                    {q.key === "who" && <input type="hidden" name="syncCast" value="1" />}
                    <textarea name={q.key} defaultValue={answers[q.key]} rows={5} className="field font-serif" aria-label={q.label} />
                    <span><SubmitButton pendingText="Saving…">Save</SubmitButton></span>
                  </form>
                )}
              </details>
            ) : caps.can_edit ? (
              <form action={saveSynopsis} className="flex flex-col gap-2">
                {storyHidden(q.key)}
                {q.key === "who" && <input type="hidden" name="syncCast" value="1" />}
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

  // Thumbnail for characters and locations: a live crop of the treatment (nothing stored),
  // or a picture already on this item.
  const thumbSrc = thumbOf((entity as { metadata?: Record<string, unknown> | null }).metadata);
  const thumbId = thumbSrc?.kind === "asset" ? thumbSrc.assetId : undefined;
  const thumbChoices = [
    ...assets.map((a) => ({ id: a.id, name: a.display_name })),
    ...references.filter((r) => r.preview_asset_id).map((r) => ({ id: r.preview_asset_id as string, name: r.title ?? "Reference" })),
  ];
  const deckRef = storyRefs.filter((r) => isTreatmentRef(r)).map((r) => ({ link: parseGoogleLink(r.source_url), meta: r.metadata as Record<string, unknown> | null }))
    .find((x) => x.link?.kind === "slides");
  const deck = deckRef?.link;
  const deckSlides = Array.isArray(deckRef?.meta?.slides) ? (deckRef.meta.slides as SlideInfo[]) : null;
  const thumbnailPanel = !isStory && (
    <section id="thumbnail" className="panel flex scroll-mt-6 flex-col gap-3 p-4" aria-labelledby="thumb-h">
      <h3 id="thumb-h" className="font-medium">Thumbnail</h3>
      {thumbSrc ? (
        <ThumbView source={thumbSrc} alt={`${entity.name} thumbnail`} className="aspect-[4/3] w-full border border-line" />
      ) : (
        <p className="help">Pick the picture that shows on {entity.name}&apos;s card.</p>
      )}
      {caps.can_edit && (deck ? (
        <details open={!thumbSrc}>
          <summary className="cursor-pointer list-none text-sm text-accent">{thumbSrc ? "Change: crop from the treatment" : "Crop from the treatment"}</summary>
          <div className="mt-3">
            <TreatmentCropPicker projectId={projectId} entityId={entityId} entityName={entity.name} fileId={deck.id}
              entityKind={entity.kind === "location" ? "location" : "character"} slides={deckSlides}
              initial={thumbSrc?.kind === "crop" ? thumbSrc.crop : null} />
          </div>
        </details>
      ) : (
        <p className="text-xs text-muted">Link your Google Slides treatment (Treatment page) to crop thumbnails from it.</p>
      ))}
      {caps.can_edit && thumbChoices.length > 0 && (
        <details>
          <summary className="cursor-pointer list-none text-xs text-muted hover:text-accent">Or use a picture already on {entity.name}</summary>
          <ul className="mt-2 grid grid-cols-3 gap-2">
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
        </details>
      )}
    </section>
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">{isStory ? "Story" : kind}</p>
          {isStory ? (
            <h2 className="display text-4xl leading-none">{shell.project.name}</h2>
          ) : caps.can_edit ? (
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
          {kind === "character" && (caps.can_edit
            ? <div className="mt-2 max-w-2xl"><RoleButtons projectId={projectId} entityId={entityId} name={entity.name} role={roleOf(entity.metadata as Record<string, unknown> | null)} /></div>
            : roleOf(entity.metadata as Record<string, unknown> | null) && <p className="text-xs text-muted uppercase">{ROLE_LABEL[roleOf(entity.metadata as Record<string, unknown> | null)!]}</p>)}
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
                <textarea id="idea" name="idea" defaultValue={answers.idea || (shell.project.description ?? "")} rows={fitRows(answers.idea || (shell.project.description ?? ""))} required
                  placeholder={INTAKE_QUESTIONS[0].placeholder} className="field font-serif text-lg leading-relaxed [field-sizing:content] min-h-24 max-h-[70vh]" />
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

          {kind === "character" && feelings && (
            <CharacterFeelings projectId={projectId} characterId={entityId} name={entity.name} canEdit={!!caps.can_edit} f={feelings} />
          )}
          {kind === "character" && !feelings && caps.can_edit && (
            <p className="text-xs text-muted">Feelings in the story are tracked for protagonists, antagonists and supporting characters. Choose a role above to track {entity.name}&apos;s.</p>
          )}

          {kind === "character" && bubble?.eligible && (
            <CharacterBubblePanel projectId={projectId} characterId={entityId} name={entity.name} canEdit={!!caps.can_edit} b={bubble} day={day} desk={bubbleDesk!} />
          )}
          {kind === "character" && bubble && !bubble.eligible && bubble.history > 0 && (
            <p className="text-xs text-muted">{entity.name}&apos;s daily coverage is paused while they aren&apos;t a protagonist, antagonist or supporting character. {bubble.history} earlier day{bubble.history === 1 ? " is" : "s are"} kept; choose one of those roles to see them and resume.</p>
          )}

          {kind === "character" && agent && (
            <CharacterAgent projectId={projectId} entityId={entityId} name={entity.name} canEdit={!!caps.can_edit} aiReady={aiConfigured()}
              profile={agent.profile} links={agent.links} turns={agent.turns} />
          )}

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

/** Box height that fits the text: a short synopsis gets a short box, a long one a tall box.
 *  (Browsers that support it also grow the box as she types.) */
function fitRows(text: string, perLine = 80) {
  const lines = text.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
  return Math.min(18, Math.max(3, lines + 1));
}
