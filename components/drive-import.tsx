"use client";
// Pull images in from Google Drive or from the linked treatment. Everything Google-side
// happens in this browser tab: Google sign-in, the Picker, downloads. She then chooses which
// images to keep and which item they belong to; each one is uploaded through STUDIO's
// private upload path and becomes a credited reference on that item.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { MAX_ARTWORK_BYTES, sniffImageType } from "@/lib/assets/validate";
import {
  DOC_MIME, SLIDES_MIME, downloadDriveFile, exportDocZip, exportSlidesZip, getGoogleToken, googleConfig, openTreatmentWithPermission,
  pickFromDrive, preloadGoogle,
} from "@/lib/google/client";
import { setThumbnailFor } from "@/app/projects/[projectId]/thumb-actions";
import { docUrl, driveFileUrl, slidesUrl, splitDocExport } from "@/lib/google/links";
import { DEPARTMENTS } from "@/lib/departments";
import { TREATMENT_ATTRIBUTION } from "@/lib/intake";

export interface ImportTarget { id: string; name: string; kind: "story" | "character" | "location" }

interface Candidate {
  key: string;
  name: string;
  blob: Blob;
  mime: "image/png" | "image/jpeg";
  preview: string;
  sourceUrl: string;
  fileId: string;
  fromTreatment: boolean;
  from: string;
  selected: boolean;
}

type Phase = { kind: "idle" } | { kind: "busy"; label: string } | { kind: "error"; message: string };

const KIND_LABEL = { story: "Story", character: "Character", location: "Location" } as const;

async function readError(res: Response) {
  try {
    return ((await res.json()) as { error?: string }).error ?? `Request failed (${res.status}).`;
  } catch {
    return `Request failed (${res.status}).`;
  }
}

export function DriveImport({ projectId, targets, defaultTargetId, treatment, startWithTreatment, defaultDepartment, thumbFor }: {
  projectId: string;
  targets: ImportTarget[];
  defaultTargetId: string;
  treatment: { fileId: string; kind: "doc" | "slides"; title: string } | null;
  startWithTreatment: boolean;
  defaultDepartment: string;
  /** Choosing a thumbnail for this character or location: one tap adds the picture and uses it. */
  thumbFor?: { id: string; name: string } | null;
}) {
  const router = useRouter();
  const cfg = googleConfig();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [items, setItems] = useState<Candidate[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [target, setTarget] = useState(defaultTargetId);
  const [attribution, setAttribution] = useState(TREATMENT_ATTRIBUTION);
  const [department, setDepartment] = useState(defaultDepartment);
  const [added, setAdded] = useState(0);
  const previews = useRef<string[]>([]);

  useEffect(() => {
    if (cfg) preloadGoogle().catch(() => {});
    const urls = previews.current;
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [cfg]);

  function addCandidate(c: Omit<Candidate, "preview" | "selected" | "mime" | "blob">, bytes: Uint8Array, skipped: string[]) {
    const mime = sniffImageType(bytes.subarray(0, 16));
    if (!mime) return skipped.push(`${c.name}: not a PNG or JPEG`);
    if (bytes.length > MAX_ARTWORK_BYTES) return skipped.push(`${c.name}: larger than 50 MB`);
    const blob = new Blob([bytes as BlobPart], { type: mime });
    const preview = URL.createObjectURL(blob);
    previews.current.push(preview);
    setItems((prev) => (prev.some((p) => p.key === c.key) ? prev : [...prev, { ...c, blob, mime, preview, selected: true }]));
  }

  function addDocImages(docId: string, docName: string, entries: { name: string; bytes: Uint8Array }[], fromTreatment: boolean, skipped: string[], kind: "doc" | "slides" = "doc") {
    const { images } = splitDocExport(entries);
    if (!images.length) skipped.push(`${docName}: no images inside`);
    images.forEach((img, i) =>
      addCandidate({
        key: `${docId}:${img.name}`, name: `${docName} – image ${i + 1}`, sourceUrl: kind === "doc" ? docUrl(docId) : slidesUrl(docId), fileId: docId,
        fromTreatment, from: fromTreatment ? "Treatment" : docName,
      }, img.bytes, skipped));
  }

  async function run(label: string, work: (skipped: string[]) => Promise<void>) {
    if (!cfg) return;
    const skipped: string[] = [];
    setAdded(0);
    setPhase({ kind: "busy", label });
    try {
      await work(skipped);
      setPhase({ kind: "idle" });
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof Error ? e.message : "Something went wrong with Google Drive." });
    }
    setNotes(skipped);
  }

  const fromTreatment = () =>
    run("Opening your treatment…", async (skipped) => {
      if (!treatment || !cfg) return;
      const { entries, name } = await openTreatmentWithPermission(cfg, treatment.fileId, treatment.kind);
      setPhase({ kind: "busy", label: "Finding images…" });
      addDocImages(treatment.fileId, name || treatment.title, entries, true, skipped, treatment.kind);
    });

  const fromDrive = () =>
    run("Opening Google Drive…", async (skipped) => {
      if (!cfg) return;
      const token = await getGoogleToken(cfg);
      const picked = await pickFromDrive(cfg, token, {
        mimeTypes: ["image/png", "image/jpeg", DOC_MIME, SLIDES_MIME], multiselect: true, title: "Choose images, a Google Doc or Slides",
      });
      for (const [i, f] of picked.entries()) {
        setPhase({ kind: "busy", label: `Downloading ${i + 1} of ${picked.length}…` });
        if (f.mimeType === DOC_MIME) {
          addDocImages(f.id, f.name, await exportDocZip(token, f.id), f.id === treatment?.fileId, skipped);
        } else if (f.mimeType === SLIDES_MIME) {
          addDocImages(f.id, f.name, await exportSlidesZip(token, f.id), f.id === treatment?.fileId, skipped, "slides");
        } else {
          addCandidate({ key: f.id, name: f.name, sourceUrl: driveFileUrl(f.id), fileId: f.id, fromTreatment: false, from: "Google Drive" },
            await downloadDriveFile(token, f.id), skipped);
        }
      }
    });

  async function uploadOne(c: Candidate, entityId: string): Promise<string> {
    const reserve = await fetch("/api/assets/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entityId, fileName: `${c.name}.${c.mime === "image/png" ? "png" : "jpg"}`, mimeType: c.mime,
        byteSize: c.blob.size, sourceUrl: c.sourceUrl, attribution, fileId: c.fileId, fromTreatment: c.fromTreatment,
        department: department || null,
      }),
    });
    if (!reserve.ok) throw new Error(await readError(reserve));
    const { assetId, upload } = (await reserve.json()) as {
      assetId: string; upload: { url: string; method: string; headers: Record<string, string> };
    };
    const put = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: c.blob });
    if (!put.ok) throw new Error("The upload was interrupted. Please try again.");
    const fin = await fetch(`/api/assets/${assetId}/complete`, { method: "POST" });
    if (!fin.ok) throw new Error(await readError(fin));
    return assetId;
  }

  /** Thumbnail mode: add this one picture to the item and use it as its thumbnail. */
  async function useAsThumbnail(c: Candidate) {
    if (!thumbFor) return;
    setPhase({ kind: "busy", label: `Setting ${thumbFor.name}'s thumbnail…` });
    try {
      const assetId = await uploadOne(c, thumbFor.id);
      const r = await setThumbnailFor({ projectId, entityId: thumbFor.id, assetId });
      if (!r.ok) throw new Error(r.error);
      router.push(`/projects/${projectId}/items/${thumbFor.id}#thumbnail`);
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof Error ? e.message : "That didn't work. Try again." });
    }
  }

  async function attach() {
    const chosen = items.filter((i) => i.selected);
    if (!chosen.length) return;
    let done = 0;
    try {
      for (const c of chosen) {
        setPhase({ kind: "busy", label: `Adding ${done + 1} of ${chosen.length}…` });
        await uploadOne(c, target);
        done++;
        setItems((prev) => prev.filter((p) => p.key !== c.key));
      }
      setAdded(done);
      setPhase({ kind: "idle" });
      router.refresh();
    } catch (e) {
      setAdded(done);
      setPhase({ kind: "error", message: `${done ? `${done} added. ` : ""}${e instanceof Error ? e.message : "Upload failed."}` });
    }
  }

  if (!cfg) {
    return (
      <div className="panel p-5">
        <p className="font-semibold">Google Drive isn&apos;t connected to STUDIO yet.</p>
        <p className="help mt-1">A grown-up on the team needs to finish the Google setup (see docs/setup.md, &ldquo;Google Drive&rdquo;). Until then you can still upload PNG or JPEG files on any item&apos;s page.</p>
      </div>
    );
  }

  const busy = phase.kind === "busy";
  const selected = items.filter((i) => i.selected).length;
  const targetName = targets.find((t) => t.id === target)?.name ?? "";

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="panel flex flex-col gap-3 p-5">
          <p className="eyebrow">From your treatment</p>
          <p className="help">{treatment ? `Find every picture in “${treatment.title}”.` : "Link your treatment (Google Docs or Slides) on the Treatment page first."}</p>
          <button type="button" className={`btn ${startWithTreatment ? "btn-primary" : ""} self-start`} disabled={busy || !treatment} onClick={fromTreatment}>
            Get images from treatment
          </button>
        </div>
        <div className="panel flex flex-col gap-3 p-5">
          <p className="eyebrow">From Google Drive</p>
          <p className="help">Pick PNG or JPEG images, or a Google Doc to take its pictures. STUDIO only sees the files you pick.</p>
          <button type="button" className={`btn ${startWithTreatment ? "" : "btn-primary"} self-start`} disabled={busy} onClick={fromDrive}>
            Choose from Google Drive
          </button>
        </div>
      </div>

      {phase.kind === "busy" && <p role="status" className="text-sm">{phase.label}</p>}
      {phase.kind === "error" && <p role="alert" className="text-sm text-danger">{phase.message}</p>}
      {added > 0 && phase.kind === "idle" && (
        <p role="status" className="text-sm">Added {added} {added === 1 ? "image" : "images"} to {targetName}&apos;s references.</p>
      )}
      {notes.length > 0 && (
        <details className="text-sm text-muted">
          <summary className="cursor-pointer">{notes.length} skipped</summary>
          <ul className="mt-1 list-disc pl-5">{notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </details>
      )}

      {items.length > 0 && (
        <section className="panel flex flex-col gap-4 p-5" aria-labelledby="pick-h">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="pick-h" className="display text-xl">Choose what to keep</h2>
            <div className="flex gap-2">
              <button type="button" className="btn" onClick={() => setItems((p) => p.map((i) => ({ ...i, selected: true })))}>All</button>
              <button type="button" className="btn" onClick={() => setItems((p) => p.map((i) => ({ ...i, selected: false })))}>None</button>
            </div>
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((c) => (
              <li key={c.key}>
                <label className={`flex cursor-pointer flex-col border bg-panel-2 ${c.selected ? "border-text" : "border-line opacity-60"}`}>
                  <span className="relative block aspect-square overflow-hidden bg-panel">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={c.preview} alt={c.name} className="size-full object-contain" />
                    <input type="checkbox" checked={c.selected} className="absolute top-2 left-2 size-5 accent-[var(--color-brand)]"
                      onChange={(e) => setItems((p) => p.map((i) => (i.key === c.key ? { ...i, selected: e.target.checked } : i)))} />
                  </span>
                  <span className="truncate px-2 py-1.5 text-xs">{c.name}</span>
                  <span className="px-2 pb-2 text-[10px] tracking-[0.1em] text-muted uppercase">{c.from}</span>
                </label>
                {thumbFor && (
                  <button type="button" className="btn-primary mt-1 min-h-9 w-full text-xs" disabled={busy} onClick={() => useAsThumbnail(c)}>
                    Use for {thumbFor.name}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-1 gap-3 border-t border-line pt-4 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="import-dept">Department</label>
              <select id="import-dept" className="field" value={department} onChange={(e) => setDepartment(e.target.value)}>
                <option value="">General</option>
                {DEPARTMENTS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="import-target">Add them to</label>
              <select id="import-target" className="field" value={target} onChange={(e) => setTarget(e.target.value)}>
                {targets.map((t) => <option key={t.id} value={t.id}>{KIND_LABEL[t.kind]}: {t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="import-attr">Who made them?</label>
              <input id="import-attr" className="field" maxLength={500} value={attribution} onChange={(e) => setAttribution(e.target.value)} />
            </div>
          </div>
          <p className="help">They&apos;ll appear under References on that page, credited to who made them, with a link back to Drive. If some images are by other artists, add those in a separate batch with their name.</p>
          <button type="button" className="btn btn-primary self-start" disabled={busy || !selected || !attribution.trim()} onClick={attach}>
            Add {selected} {selected === 1 ? "image" : "images"}
          </button>
        </section>
      )}
    </div>
  );
}
