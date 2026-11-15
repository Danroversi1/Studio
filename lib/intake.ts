// Marks a reference on the Story item as the director's own treatment.
export const TREATMENT_ATTRIBUTION = "Director (own work)";
export const TREATMENT_NOTES = "Director treatment";

/** A treatment link (not an image she imported, which is also her own work). */
export function isTreatmentRef(r: { attribution: string | null; observations?: string | null; preview_asset_id?: string | null }) {
  return r.attribution === TREATMENT_ATTRIBUTION && !r.preview_asset_id && (r.observations ?? TREATMENT_NOTES) === TREATMENT_NOTES;
}

// ---------------------------------------------------------------------------
// Story intake: three guided questions. Answers are saved together as the story's
// text (one revision), under headings, so the Story Lead, the partners and the
// story page all read them as one synopsis. Pure functions (unit-tested).
// ---------------------------------------------------------------------------
export const INTAKE_QUESTIONS = [
  {
    key: "idea",
    heading: "What's your story idea?",
    help: "A few sentences, a scene you imagine, or a “what if…” is enough.",
    why: "This is your premise: your starting point.",
    placeholder: "What if the last lighthouse keeper found out the light was keeping something away…",
  },
  {
    key: "who",
    heading: "Whose story is it?",
    help: "Tell us about the main character, or group. What do they want?",
    why: "A point of view, and a want that can drive the action.",
    placeholder: "Mira, 13, the keeper's granddaughter. She wants to prove she can run the lighthouse alone…",
  },
  {
    key: "difficulty",
    heading: "What makes it difficult?",
    help: "What stands in their way? What could happen if things go wrong?",
    why: "Conflict, and what's at stake.",
    placeholder: "A storm is coming, and nobody believes her about what's out there. If the light goes out…",
  },
] as const;

export type IntakeKey = (typeof INTAKE_QUESTIONS)[number]["key"];
export type IntakeAnswers = Record<IntakeKey, string>;

export function composeIntake(a: Partial<IntakeAnswers>): string {
  return INTAKE_QUESTIONS
    .map((q) => ({ q, text: (a[q.key] ?? "").replace(/\r\n?/g, "\n").trim() }))
    .filter(({ text }) => text)
    .map(({ q, text }) => `## ${q.heading}\n${text}`)
    .join("\n\n");
}

/** Split saved story text back into the three answers. Text written elsewhere goes to the idea. */
export function parseIntake(body: string): IntakeAnswers {
  const out: IntakeAnswers = { idea: "", who: "", difficulty: "" };
  const text = (body ?? "").replace(/\r\n?/g, "\n");
  const marks = INTAKE_QUESTIONS
    .map((q) => ({ key: q.key, at: text.indexOf(`## ${q.heading}\n`), len: `## ${q.heading}\n`.length }))
    .filter((m) => m.at >= 0)
    .sort((x, y) => x.at - y.at);
  if (!marks.length || marks[0].at > 0 && text.slice(0, marks[0].at).trim()) {
    // Not (only) intake answers: keep the whole text as the idea so nothing is lost.
    out.idea = text.trim();
    return out;
  }
  marks.forEach((m, i) => {
    out[m.key] = text.slice(m.at + m.len, marks[i + 1]?.at ?? text.length).trim();
  });
  return out;
}
