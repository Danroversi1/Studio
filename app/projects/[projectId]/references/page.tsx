// Additional references, organized by department (Casting, Locations, Wardrobe,
// Production design, Special effects). The treatment lives on the story page.
import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash } from "@/components/flash";
import { SubmitButton } from "@/components/ui";
import { DEPARTMENTS, departmentLabel, isDepartment } from "@/lib/departments";
import { getAllReferences, getProjectShell, type ReferenceRow } from "@/lib/data";
import { addReference, fileReference } from "../actions";

export default async function ReferencesPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ d?: string; error?: string; notice?: string }>;
}) {
  const { projectId } = await params;
  const { d, error, notice } = await searchParams;
  const [shell, refs] = await Promise.all([getProjectShell(projectId), getAllReferences(projectId)]);
  if (!shell || !shell.caps.member) notFound();
  const { caps, entities } = shell;
  const base = `/projects/${projectId}/references`;
  const current = isDepartment(d) ? d : d === "general" ? "general" : "all";
  const story = entities.find((e) => e.kind === "story");
  const nameOf = new Map(entities.map((e) => [e.id, e.name]));
  const inDept = (dep: string) => refs.filter((r) => (dep === "general" ? !r.department : r.department === dep));
  const shown = current === "all" ? refs : inDept(current);
  const back = current === "all" ? base : `${base}?d=${current}`;
  const deptInfo = DEPARTMENTS.find((x) => x.value === current);

  const card = (r: ReferenceRow) => (
    <li key={r.id} className="flex flex-col border border-line bg-panel-2">
      {r.preview_asset_id ? (
        <a href={`/api/assets/${r.preview_asset_id}`} target="_blank" rel="noopener" className="block aspect-[4/3] bg-panel">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/assets/${r.preview_asset_id}`} alt={r.title ?? "Reference image"} loading="lazy" className="size-full object-contain" />
        </a>
      ) : null}
      <div className="flex flex-1 flex-col gap-1 p-3">
        <a href={r.source_url} target="_blank" rel="noopener noreferrer nofollow" className="font-medium hover:text-accent">{r.title || r.source_domain}</a>
        <p className="text-xs text-muted">By {r.attribution} · {r.source_domain}</p>
        <p className="text-xs text-muted">For <Link href={`/projects/${projectId}/items/${r.entity_id}`} className="link-accent">{nameOf.get(r.entity_id) ?? "the film"}</Link></p>
        {r.observations && <p className="help mt-1 line-clamp-3">{r.observations}</p>}
        {caps.can_edit ? (
          <form action={fileReference} className="mt-auto flex items-center gap-2 pt-2">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="referenceId" value={r.id} />
            <input type="hidden" name="back" value={back} />
            <label className="sr-only" htmlFor={`dept-${r.id}`}>Department</label>
            <select id={`dept-${r.id}`} name="department" defaultValue={r.department ?? ""} className="field min-h-9 py-1 text-xs">
              <option value="">General</option>
              {DEPARTMENTS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </select>
            <SubmitButton pendingText="…">Move</SubmitButton>
          </form>
        ) : (
          <p className="mt-auto pt-2 text-[11px] tracking-[0.08em] text-muted uppercase">{departmentLabel(r.department)}</p>
        )}
      </div>
    </li>
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="eyebrow">Additional references</p>
        <h1 className="display text-4xl leading-none sm:text-5xl">References</h1>
        <p className="max-w-2xl text-muted">Inspiration for each department. Always note who made it: references are for study, not for copying into the film.</p>
      </header>
      <Flash error={error} notice={notice} />

      <nav aria-label="Departments" className="flex flex-wrap gap-2">
        <Link href={base} aria-current={current === "all" ? "page" : undefined} className={`btn ${current === "all" ? "btn-primary" : ""}`}>All ({refs.length})</Link>
        {DEPARTMENTS.map((x) => (
          <Link key={x.value} href={`${base}?d=${x.value}`} aria-current={current === x.value ? "page" : undefined}
            className={`btn ${current === x.value ? "btn-primary" : ""}`}>{x.label} ({inDept(x.value).length})</Link>
        ))}
        <Link href={`${base}?d=general`} aria-current={current === "general" ? "page" : undefined}
          className={`btn ${current === "general" ? "btn-primary" : ""}`}>General ({inDept("general").length})</Link>
      </nav>

      {current === "all" ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {DEPARTMENTS.map((x) => {
            const list = inDept(x.value);
            return (
              <Link key={x.value} href={`${base}?d=${x.value}`} className="panel flex flex-col gap-2 p-4 hover:border-text">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="display text-lg">{x.label}</span>
                  <span className="text-xs text-muted">{list.length}</span>
                </span>
                <span className="text-sm text-muted">{x.blurb}</span>
                {list.some((r) => r.preview_asset_id) && (
                  <span className="mt-1 flex gap-1">
                    {list.filter((r) => r.preview_asset_id).slice(0, 4).map((r) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={r.id} src={`/api/assets/${r.preview_asset_id}`} alt="" className="size-14 object-cover" loading="lazy" />
                    ))}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ) : (
        <section className="flex flex-col gap-3">
          {deptInfo && <p className="text-sm text-muted">{deptInfo.blurb}</p>}
          {shown.length === 0
            ? <p className="help">Nothing here yet.</p>
            : <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{shown.map(card)}</ul>}
        </section>
      )}

      {caps.can_edit && story && (
        <section className="panel flex flex-col gap-4 p-5" aria-labelledby="add-ref-h">
          <h2 id="add-ref-h" className="display text-lg">Add a reference{deptInfo ? ` to ${deptInfo.label}` : ""}</h2>
          <div className="flex flex-wrap gap-2">
            <Link href={`/projects/${projectId}/import${deptInfo ? `?dept=${deptInfo.value}` : ""}`} className="btn btn-primary">Add images from Google Drive</Link>
          </div>
          <form action={addReference} className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="back" value={back} />
            <input name="url" type="url" required placeholder="Or paste a link: https://…" className="field md:col-span-2" aria-label="Link" />
            <input name="title" placeholder="Title (optional)" className="field" aria-label="Title" />
            <input name="attribution" required placeholder="Who made it? (artist, museum, site)" className="field" aria-label="Attribution" />
            <select name="department" defaultValue={deptInfo?.value ?? ""} className="field" aria-label="Department">
              <option value="">General</option>
              {DEPARTMENTS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </select>
            <select name="entityId" defaultValue={story.id} className="field" aria-label="For">
              {entities.map((e) => <option key={e.id} value={e.id}>For: {e.kind === "story" ? "the whole film" : `${e.name} (${e.kind})`}</option>)}
            </select>
            <textarea name="notes" rows={2} placeholder="What do you notice?" className="field md:col-span-2" aria-label="Notes" />
            <input type="hidden" name="rights" value="unknown" />
            <div className="md:col-span-2"><SubmitButton pendingText="Adding…">Add reference</SubmitButton></div>
          </form>
        </section>
      )}
    </div>
  );
}
