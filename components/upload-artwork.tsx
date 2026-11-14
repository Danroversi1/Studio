"use client";
// Three-step private upload: reserve (server makes the key) → PUT to a signed URL →
// server verifies the stored bytes and marks the original ready.
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type State = { phase: "idle" } | { phase: "working"; label: string } | { phase: "error"; message: string };

async function readError(res: Response) {
  try {
    return ((await res.json()) as { error?: string }).error ?? `Upload failed (${res.status}).`;
  } catch {
    return `Upload failed (${res.status}).`;
  }
}

export function UploadArtwork({ entityId }: { entityId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ phase: "idle" });

  async function upload(file: File) {
    try {
      setState({ phase: "working", label: "Preparing…" });
      const reserve = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId, fileName: file.name, mimeType: file.type, byteSize: file.size }),
      });
      if (!reserve.ok) throw new Error(await readError(reserve));
      const { assetId, upload: signed } = (await reserve.json()) as {
        assetId: string;
        upload: { url: string; method: string; headers: Record<string, string> };
      };

      setState({ phase: "working", label: "Uploading…" });
      const put = await fetch(signed.url, { method: signed.method, headers: signed.headers, body: file });
      if (!put.ok) throw new Error("The upload was interrupted. Please try again.");

      setState({ phase: "working", label: "Checking the file…" });
      const done = await fetch(`/api/assets/${assetId}/complete`, { method: "POST" });
      if (!done.ok) throw new Error(await readError(done));

      setState({ phase: "idle" });
      router.refresh();
    } catch (e) {
      setState({ phase: "error", message: e instanceof Error ? e.message : "Upload failed." });
    } finally {
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="btn cursor-pointer self-start">
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg"
          className="sr-only"
          disabled={state.phase === "working"}
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        />
        {state.phase === "working" ? state.label : "Upload artwork"}
      </label>
      <p className="help">
        In Procreate: Share → PNG or JPEG. The original is kept exactly as uploaded; new versions are new uploads.
      </p>
      {state.phase === "error" && <p role="alert" className="text-sm text-danger">{state.message}</p>}
    </div>
  );
}
