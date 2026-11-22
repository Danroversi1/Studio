// Script writing desk with the three-act timeline (90 pages ≈ 90 minutes).
import Link from "next/link";
import { notFound } from "next/navigation";
import { Empty, Flash } from "@/components/flash";
import { ScriptDesk } from "@/components/script-desk";
import { SubmitButton } from "@/components/ui";
import { getCast, getCastOriginals, getNotebook, getProjectShell, getScreenplay, getWorld } from "@/lib/data";
import { WorldLine } from "@/components/world-line";
import { BreakdownPanel } from "@/components/breakdown-panel";
import { ScenePlanAuto } from "@/components/scene-plan-auto";
import { CastScanAuto } from "@/components/cast-scan-auto";
import { aiConfigured } from "@/lib/agents/run-story-breakdown";
import { PARTS, uncoveredBeats, type Part } from "@/lib/scene-plan";

export const maxDuration = 300;
import { CastBox } from "@/components/cast-box";
import { runtimeInfo, targetPages } from "@/lib/runtime";
import { approveScreenplay, saveScreenplay } from "../actions";
import { DialogueDesk } from "@/components/dialogue/dialogue-desk";
import { getDialogueDesk } from "@/lib/dialogue/data";
import { DIALOGUE_PROVIDER } from "@/lib/dialogue/run";

export default async function ScriptPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ v?: string; error?: string; notice?: string }>;
}) {
  const { projectId } = await params;
  const { v, error, notice } = await searchParams;
  const [shell, sp, cast, originals, notebook] = await Promise.all([
    getProjectShell(projectId), getScreenplay(projectId), getCast(projectId), getCastOriginals(projectId), getNotebook(projectId),
  ]);
  const [world, desk] = await Promise.all([getWorld(projectId), getDialogueDesk(projectId)]);
  if (!shell || !shell.caps.member) notFound();
  const { caps } = shell;
  const runtime = (shell.project as { runtime?: string | null }).runtime ?? null;
  const versions = sp?.versions ?? [];
  const canonical = versions.find((x) => x.id === sp?.entity.current_version_id) ?? null;
  const selected = versions.find((x) => x.id === v) ?? versions[0] ?? null;
  if (!caps.can_edit && !selected) {
    return <Empty title="No approved script yet">When the Director approves a script revision, you can read it here.</Empty>;
  }
  const latestBody = String(versions[0]?.content.body ?? "");
  const beats = notebook.filter((n) => (PARTS as string[]).includes(n.kind) && n.status !== "archived")
    .map((n) => ({ id: n.id, part: n.kind as Part, text: n.body }));
  const pendingBeats = caps.can_edit && aiConfigured() && (!v || v === versions[0]?.id) ? uncoveredBeats(latestBody, beats).length : 0;
  const canApprove = !!(caps.can_approve_canonical && selected && selected.id !== canonical?.id && selected.status !== "working");

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <p className="eyebrow">Script writing desk</p>
          <h1 className="display text-4xl leading-none sm:text-5xl">Screenplay</h1>
          <p className="max-w-2xl text-muted">
            Write in plain text; STUDIO formats it as screenplay pages. One page is about one minute of screen time.
          </p>
          <WorldLine projectId={projectId} world={world} />
          {caps.can_edit && (
            <Link href={`/projects/${projectId}/partners/dialogue`} className="text-sm text-accent">Find your characters&apos; voices with the Dialogue partner →</Link>
          )}
        </div>
        <p className="text-xs text-muted">
          {canonical ? `Approved: revision ${canonical.version_number}` : "No approved version yet"}
        </p>
      </header>
      <Flash error={error} notice={notice} />

      <ScenePlanAuto projectId={projectId} pending={pendingBeats} />
      {caps.can_edit && latestBody.trim() && <CastScanAuto key={versions[0]?.id} projectId={projectId} />}

      <details className="panel p-4" open>
        <summary className="cursor-pointer list-none font-semibold">Cast ({cast.length}) <span className="text-xs font-normal text-muted">: who they are, while you write</span></summary>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {cast.map((c) => (
            <div key={c.id} className="border border-line p-3 text-sm">
              <p className="font-semibold">{c.name}</p>
              <p className="mt-1 whitespace-pre-wrap">{c.summary || "No description yet."}</p>
              {originals[c.name.toLowerCase()] && originals[c.name.toLowerCase()] !== c.summary.trim() && (
                <p className="mt-1 text-xs text-muted">Your original: {originals[c.name.toLowerCase()]}</p>
              )}
            </div>
          ))}
          {!cast.length && <p className="text-sm text-muted">No characters yet. Add them in your Story&apos;s Cast.</p>}
        </div>
      </details>

      {selected && selected.id !== versions[0]?.id && (
        <p className="panel px-4 py-3 text-sm">You&apos;re looking at revision {selected.version_number}. Saving creates a new revision starting from it.</p>
      )}

      <ScriptDesk key={selected?.id ?? "new"} projectId={projectId} entityId={sp?.entity.id ?? ""}
        initial={selected?.content.body ?? ""} parentVersionId={selected?.id ?? ""}
        baseVersionId={sp?.entity.current_version_id ?? ""} canEdit={!!caps.can_edit} saveAction={saveScreenplay}
        target={targetPages(runtime)} lengthLabel={runtimeInfo(runtime)?.label ?? null} />

      {(!v || v === versions[0]?.id) && (
        <DialogueDesk projectId={projectId} canEdit={!!caps.can_edit} aiReady={aiConfigured()}
          provider={`${DIALOGUE_PROVIDER.provider} ${DIALOGUE_PROVIDER.model} (${DIALOGUE_PROVIDER.location.toLowerCase()})`}
          scenes={desk.scenes} contexts={desk.contexts} proposals={desk.proposals} settings={desk.settings} characters={desk.characters}
          scriptVersionId={desk.scriptVersionId} />
      )}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_24rem]">
        <BreakdownPanel body={selected?.content.body ?? ""} />
        <CastBox projectId={projectId} back={`/projects/${projectId}/script`} cast={cast} canEdit={!!caps.can_edit} originals={originals} />
      </div>

      {versions.length > 0 && (
        <section className="panel flex flex-col gap-3 p-4" aria-labelledby="hist-h">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="hist-h" className="display text-[22px]">Revision history</h2>
            {canApprove && selected && (
              <form action={approveScreenplay}>
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="versionId" value={selected.id} />
                <input type="hidden" name="expectedCurrentId" value={sp?.entity.current_version_id ?? ""} />
                <SubmitButton variant="primary" pendingText="Approving…">Approve revision {selected.version_number}</SubmitButton>
              </form>
            )}
          </div>
          <ul className="flex flex-col">
            {versions.map((r) => (
              <li key={r.id} className={`flex flex-wrap items-baseline justify-between gap-2 border-b border-line py-2 text-sm ${r.id === selected?.id ? "font-medium" : ""}`}>
                <Link href={`/projects/${projectId}/script?v=${r.id}`} className="hover:text-accent">
                  Revision {r.version_number}{r.change_summary ? ` · ${r.change_summary}` : ""}
                </Link>
                <span className="text-xs text-muted">
                  {r.id === canonical?.id ? "Approved · " : ""}{new Date(r.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
