// What changed in STUDIO, newest first: one page (/changes) for the developer to review
// every round. Add a round at the top each time work ships. Links point at the test film.
const J = "/projects/c4a933f3-924a-48cf-ab26-6e3df43bba47";
const JOHNNY_STORY = `${J}/items/ccfc0b25-d08a-4dcb-8251-7106d50d7c6a`;

export interface ChangeItem { text: string; href?: string }
export interface ChangeRound { at: string; title: string; items: ChangeItem[] }

export const CHANGELOG: ChangeRound[] = [
  {
    at: "2026-11-16T04:10:00Z",
    title: "Thumbnails are crops of the treatment",
    items: [
      { text: "Character and location pages: pick a slide, drag a box over the part you want, resize it from the corner, then \"Use for …\". Nothing is copied or stored; the crop shows live from the Google Slides treatment.", href: `${J}/items/b547cb85-1d37-413a-8e10-3ebe1a74e14f#thumbnail` },
      { text: "Crops show on the Overview cards and the Connections board too." },
      { text: "Removed the upload-based picker from the import page." },
    ],
  },
  {
    at: "2026-11-16T03:10:00Z",
    title: "Thumbnails from the treatment",
    items: [
      { text: "Character and location pages: \"Pick from the treatment\" opens the treatment's pictures; one tap on \"Use for …\" sets the thumbnail.", href: `${J}/items/b547cb85-1d37-413a-8e10-3ebe1a74e14f#thumbnail` },
      { text: "Google Slides treatments now work for pulling pictures (before, only Google Docs did); Slides decks can also be picked from Drive." },
    ],
  },
  {
    at: "2026-11-16T02:40:00Z",
    title: "Edit the outline in place",
    items: [
      { text: "Every beat has Edit, ↑ / ↓ and Remove; ↑ at the top of a part moves it into the part before, ↓ at the bottom into the next.", href: `${JOHNNY_STORY}#outline-h` },
      { text: "\"+ Add a beat here\" between beats (and at the start of each part) to add earlier events, not just at the end." },
      { text: "A beat added earlier gets its scene placed in the matching spot of the script, not at the end." },
      { text: "The partners read the outline in its new order." },
    ],
  },
  {
    at: "2026-11-16T01:05:00Z",
    title: "Connections board",
    items: [
      { text: "New Connections section: characters, locations, references with pictures and sticky notes on one board.", href: `${J}/connections` },
      { text: "Drag a card's pin to another card to tie a string and name it in her words; click a string to rename or remove it." },
      { text: "Grey dashed strings come from the script (who's in a scene where, who shares scenes) and update themselves." },
      { text: "\"Show scenes\" puts scene cards on the board too. Zoom, pan and Fit; a full list of connections below for keyboard use." },
      { text: "The old Connect buttons are gone; character and location pages show their connections with a link to the board.", href: `${J}/items/b547cb85-1d37-413a-8e10-3ebe1a74e14f` },
      { text: "The partners see her strings and labels." },
    ],
  },
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
