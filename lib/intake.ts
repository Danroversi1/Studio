// Marks a reference on the Story item as the director's own treatment.
export const TREATMENT_ATTRIBUTION = "Director (own work)";
export const TREATMENT_NOTES = "Director treatment";

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
    placeholder: "What if a curious being from far away watched our planet for thousands of years…",
  },
  {
    key: "who",
    heading: "Whose story is it?",
    help: "Tell us about the main character, or group. What do they want?",
    why: "A point of view, and a want that can drive the action.",
    placeholder: "The Observer. It wants to understand the people it watches, without being seen…",
  },
  {
    key: "difficulty",
    heading: "What makes it difficult?",
    help: "What stands in their way? What could happen if things go wrong?",
    why: "Conflict, and what's at stake.",
    placeholder: "The longer it stays, the more its borrowed body changes. If it's discovered…",
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
