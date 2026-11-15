// "Name: who they are" lines in her cast answer → characters. Pure (unit-tested).
// Only text she wrote in that pattern is used; anything else stays just text.
export interface CastMember { name: string; description: string }

const MARKER = /(^|[\n.;!?]\s*)(?:[-•*]\s*)?([A-ZÀ-ɏ][\p{L}'’.\- ]{0,38}?)\s*[:：]\s+/gu;

export function parseCast(text: string): CastMember[] {
  const src = (text ?? "").replace(/\r\n?/g, "\n");
  const marks: { name: string; start: number; bodyStart: number }[] = [];
  for (const m of src.matchAll(MARKER)) {
    const name = m[2].trim().replace(/^[-•*]\s*/, "");
    if (!name || name.split(/\s+/).length > 4) continue;
    marks.push({ name, start: (m.index ?? 0) + m[1].length, bodyStart: (m.index ?? 0) + m[0].length });
  }
  const out: CastMember[] = [];
  const seen = new Set<string>();
  marks.forEach((mk, i) => {
    const end = marks[i + 1]?.start ?? src.length;
    const description = src.slice(mk.bodyStart, end).replace(/\s+/g, " ").trim();
    const key = mk.name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name: mk.name.slice(0, 120), description: description.slice(0, 2000) });
  });
  return out.slice(0, 30);
}
