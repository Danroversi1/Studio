// Which treatment slide belongs to which character or location, from the slide's own text
// ("Casting/Johnny", "Location: Coffee Shop", or just the name as its title). Plain text
// matching: no AI. Pure (unit-tested).
export interface SlideInfo { id: string; text: string }

// "President's Office" = "President office"; "Mr. X's Hideout" = "Mr X. Hideout".
const norm = (s: string) => ` ${s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/['\u2019]s\b/g, "")
  .replace(/[^a-z0-9]+/g, " ").trim()} `;
const strip = (n: string) => n.replace(/^\s*(the|a|an)\s+/i, "");

const LABELS: Record<"character" | "location", string[]> = {
  character: ["casting", "cast", "character", "characters"],
  location: ["location", "locations", "set", "sets", "place", "places"],
};

/** Slide numbers (1-based), best match first: a labeled slide ("Casting/Johnny") beats a
 *  slide whose first line is the name, which beats a slide that mentions the name. */
export function slidesFor(slides: SlideInfo[], name: string, kind: "character" | "location"): number[] {
  const n = norm(strip(name)).trim();
  if (n.length < 2) return [];
  const scored: { i: number; score: number }[] = [];
  slides.forEach((s, i) => {
    const text = s.text ?? "";
    const all = norm(text);
    if (!all.includes(` ${n} `)) return;
    const first = norm(text.split(/\n/).find((l) => l.trim()) ?? "");
    let score = 1;
    if (first.includes(` ${n} `)) score = 2;
    for (const label of LABELS[kind]) if (all.includes(` ${label} ${n} `) || all.includes(` ${label} the ${n} `)) score = Math.max(score, 3);
    const otherKind = kind === "character" ? "location" : "character";
    for (const label of LABELS[otherKind]) if (all.includes(` ${label} ${n} `) && score < 3) score = 0.5;
    scored.push({ i: i + 1, score });
  });
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).map((x) => x.i);
}

/** Keep what's useful for matching: each slide's ID and the start of its text. */
export function trimSlides(slides: SlideInfo[]): SlideInfo[] {
  return slides.slice(0, 500).map((s) => ({ id: s.id, text: (s.text ?? "").replace(/\s+\n/g, "\n").trim().slice(0, 300) }));
}
