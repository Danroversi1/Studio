// BROWSER (and Node for tests). Research documents: the original file goes into Studio's
// private storage through the existing upload flow; readable text is extracted here, in
// the browser, for plain text, Markdown and Word (.docx). PDF text isn't read yet: the file
// is kept and she can paste the parts she needs. No model is involved.
import { readZip } from "../zip";
import { decodeEntities } from "./feed";

export const DOC_TYPES: Record<string, { mime: string; label: string }> = {
  pdf: { mime: "application/pdf", label: "PDF" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", label: "Word" },
  txt: { mime: "text/plain", label: "Text" },
  md: { mime: "text/markdown", label: "Markdown" },
};

export function docTypeOf(file: { name: string; type: string }): { ext: string; mime: string } | null {
  const ext = (/\.([a-z0-9]+)$/i.exec(file.name)?.[1] ?? "").toLowerCase();
  const byExt = DOC_TYPES[ext === "markdown" ? "md" : ext];
  return byExt ? { ext: ext === "markdown" ? "md" : ext, mime: byExt.mime } : null;
}

/** Paragraph text of a .docx (word/document.xml): <w:p> → line, <w:t> → text, tabs/breaks kept. */
export async function docxText(bytes: Uint8Array): Promise<string> {
  const entries = await readZip(bytes);
  const doc = entries.find((e) => e.name === "word/document.xml");
  if (!doc) throw new Error("This Word file has no document text.");
  const xml = new TextDecoder().decode(doc.bytes);
  const paras = xml.split(/<\/w:p>/);
  const lines = paras.map((p) => {
    const marked = p.replace(/<w:tab\/>/g, "<w:t>\t</w:t>").replace(/<w:br\/>/g, "<w:t>\n</w:t>");
    return decodeEntities([...marked.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join(""));
  });
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export async function extractText(file: File): Promise<{ text: string; note: string | null }> {
  const t = docTypeOf(file);
  if (!t) return { text: "", note: null };
  if (t.ext === "txt" || t.ext === "md") return { text: (await file.text()).replace(/\r\n?/g, "\n").trim(), note: null };
  if (t.ext === "docx") {
    try { return { text: await docxText(new Uint8Array(await file.arrayBuffer())), note: null }; }
    catch { return { text: "", note: "The Word file's text couldn't be read. The file is saved; paste the parts you need." }; }
  }
  return { text: "", note: "Studio can't read text from PDFs yet. The file is saved; paste the parts you need." };
}

async function readError(res: Response) {
  try { return ((await res.json()) as { error?: string }).error ?? `Upload failed (${res.status}).`; } catch { return `Upload failed (${res.status}).`; }
}

/** Upload the original through Studio's private upload flow (reserve → PUT → server check). */
export async function uploadDocument(ownerEntityId: string, file: File): Promise<string> {
  const t = docTypeOf(file);
  if (!t) throw new Error(`${file.name}: use a PDF, Word (.docx), text or Markdown file.`);
  const reserve = await fetch("/api/assets", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entityId: ownerEntityId, fileName: file.name, mimeType: t.mime, byteSize: file.size }),
  });
  if (!reserve.ok) throw new Error(await readError(reserve));
  const { assetId, upload } = (await reserve.json()) as { assetId: string; upload: { url: string; method: string; headers: Record<string, string> } };
  const put = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: file });
  if (!put.ok) throw new Error(`${file.name}: the upload was interrupted. Please try again.`);
  const fin = await fetch(`/api/assets/${assetId}/complete`, { method: "POST" });
  if (!fin.ok) throw new Error(`${file.name}: ${await readError(fin)}`);
  return assetId;
}
