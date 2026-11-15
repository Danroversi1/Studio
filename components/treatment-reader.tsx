"use client";
// Read the linked Google Docs treatment inside STUDIO. The Doc is fetched in this browser tab
// with the Director's own Google permission, cleaned of anything active, and shown in a
// sandboxed frame with scripts disabled. Nothing is stored; it's read fresh each time.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { googleConfig, openDocWithPermission, preloadGoogle } from "@/lib/google/client";
import { BLOCKED_TAGS, isSafeHref, splitDocExport } from "@/lib/google/links";
import type { ZipEntry } from "@/lib/zip";

function toDataUrl(bytes: Uint8Array, name: string) {
  const mime = /\.png$/i.test(name) ? "image/png" : /\.gif$/i.test(name) ? "image/gif" : "image/jpeg";
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

/** Build a safe, self-contained page from a Google Docs "Web page (zipped)" export. */
function buildPage(entries: ZipEntry[]): string {
  const { html, images } = splitDocExport(entries);
  if (!html) throw new Error("Google sent back an export without the document in it.");
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(html.bytes), "text/html");
  doc.querySelectorAll(BLOCKED_TAGS.join(",")).forEach((el) => el.remove());
  const imageData = new Map(images.map((i) => [i.name, toDataUrl(i.bytes, i.name)]));
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const n = attr.name.toLowerCase();
      if (n.startsWith("on") || n === "srcset" || n === "formaction") el.removeAttribute(attr.name);
    }
    if (el.tagName === "IMG") {
      const src = el.getAttribute("src") ?? "";
      const data = imageData.get(decodeURIComponent(src));
      if (data) el.setAttribute("src", data);
      else el.remove(); // never load anything from the network inside the reader
    }
    if (el.tagName === "A") {
      const href = el.getAttribute("href") ?? "";
      if (!isSafeHref(href)) el.removeAttribute("href");
      el.setAttribute("rel", "noopener noreferrer");
    }
    const style = el.getAttribute("style");
    if (style && /url\s*\(|expression\s*\(/i.test(style)) el.removeAttribute("style");
  });
  doc.querySelectorAll("style").forEach((s) => {
    s.textContent = (s.textContent ?? "").replace(/@import[^;]+;/gi, "").replace(/url\s*\([^)]*\)/gi, "none");
  });
  const head = doc.head;
  const base = doc.createElement("base");
  base.setAttribute("target", "_blank");
  head.prepend(base);
  const csp = doc.createElement("meta");
  csp.setAttribute("http-equiv", "Content-Security-Policy");
  csp.setAttribute("content", "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'");
  head.prepend(csp);
  const fit = doc.createElement("style");
  fit.textContent = "html,body{margin:0!important;background:#fff!important}body{max-width:none!important;padding:32px 6%!important;box-sizing:border-box}img{max-width:100%!important;height:auto!important}";
  head.appendChild(fit);
  return "<!DOCTYPE html>" + doc.documentElement.outerHTML;
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; page: string; name: string }
  | { kind: "error"; message: string };

export function TreatmentReader({ docId, title, sourceUrl, importHref }: {
  docId: string; title: string; sourceUrl: string; importHref: string | null;
}) {
  const cfg = googleConfig();
  const [state, setState] = useState<State>({ kind: "idle" });
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(900);

  useEffect(() => {
    if (cfg) preloadGoogle().catch(() => {});
  }, [cfg]);

  async function open() {
    if (!cfg) return;
    setState({ kind: "loading" });
    try {
      const { entries, name } = await openDocWithPermission(cfg, docId);
      setState({ kind: "ready", page: buildPage(entries), name });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "Couldn't open the treatment." });
    }
  }

  function fitHeight() {
    const body = frame.current?.contentDocument?.documentElement;
    if (body) setHeight(Math.max(600, body.scrollHeight + 24));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {cfg && state.kind !== "ready" && (
          <button type="button" className="btn btn-primary" disabled={state.kind === "loading"} onClick={open}>
            {state.kind === "loading" ? "Opening…" : "Open treatment here"}
          </button>
        )}
        {state.kind === "ready" && <button type="button" className="btn" onClick={open}>Refresh</button>}
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="btn">Open in Google Docs ↗</a>
        {importHref && <Link href={importHref} className="btn">Pull its images</Link>}
      </div>
      {!cfg && (
        <p className="help">Reading inside STUDIO needs the Google Drive setup (docs/setup.md, &ldquo;Google Drive&rdquo;). Until then, open it in Google Docs.</p>
      )}
      {state.kind === "idle" && cfg && (
        <p className="help">The first time, Google asks you to sign in and select the treatment. That lets STUDIO open this document and no others.</p>
      )}
      {state.kind === "error" && <p role="alert" className="text-sm text-danger">{state.message}</p>}
      {state.kind === "ready" && (
        <iframe
          ref={frame}
          title={`Treatment: ${state.name || title}`}
          srcDoc={state.page}
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          onLoad={fitHeight}
          style={{ height }}
          className="w-full border border-line bg-white"
        />
      )}
    </div>
  );
}
