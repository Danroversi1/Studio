// What changed in STUDIO, newest first: one page (/changes) for the developer to review
// every round. Add a round at the top each time work ships. Links point at the test film.
const J = "/projects/c4a933f3-924a-48cf-ab26-6e3df43bba47";
const JOHNNY_STORY = `${J}/items/ccfc0b25-d08a-4dcb-8251-7106d50d7c6a`;

export interface ChangeItem { text: string; href?: string }
export interface ChangeRound { at: string; title: string; items: ChangeItem[] }

export const CHANGELOG: ChangeRound[] = [
  {
    at: "2026-11-15T23:40:00Z",
    title: "Navigation fixed · World & Time cards open · synopsis box fits",
    items: [
      { text: "Leaving any page with a partner chat no longer crashes the next page.", href: `${J}/partners/world` },
      { text: "Menu clicks no longer wait while a partner thinks, scenes are laid out or the story is read." },
      { text: "World & Time: empty WHERE / WHEN / TIME SPAN cards open ready to fill; no click-through.", href: `${J}/world` },
      { text: "World & Time reads the story once per change instead of on every visit." },
      { text: "Synopsis box is short for a short synopsis, taller for a long one, and grows as she types.", href: JOHNNY_STORY },
    ],
  },
  {
    at: "2026-11-15T23:20:00Z",
    title: "Dialogue partner",
    items: [
      { text: "New partner built from your Dialogue prompt (verbatim, with the reference cases); sees the script, cast and World & Time.", href: `${J}/partners/dialogue` },
      { text: "Link to it from the Script desk.", href: `${J}/script` },
    ],
  },
  {
    at: "2026-11-15T23:15:00Z",
    title: "World & Time + World Builder",
    items: [
      { text: "New World & Time page: Where, When, Time span, coverage, your world in a sentence, Explore deeper, visual reference.", href: `${J}/world` },
      { text: "World Builder partner beside the cards; decisions only in her words, everything else a suggestion." },
      { text: "World line on the Overview and Script desk.", href: J },
    ],
  },
  {
    at: "2026-11-15T23:00:00Z",
    title: "Image storage on (Cloudflare R2)",
    items: [{ text: "Uploads, Drive imports and thumbnails now work.", href: `${J}/references` }],
  },
  {
    at: "2026-11-15T20:55:00Z",
    title: "Scenes from the outline · Breakdown · Locations",
    items: [
      { text: "Outline beats become scenes (INT/EXT, place, time, a line to write per character, art notes).", href: `${J}/script` },
      { text: "Breakdown panel; places in scene headings become Locations.", href: `${J}#locations` },
    ],
  },
];
