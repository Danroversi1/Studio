// What changed in STUDIO, newest first: one page (/changes) for the developer to review
// every round. Add a round at the top each time work ships. Links point at the test film.
const J = "/projects/c4a933f3-924a-48cf-ab26-6e3df43bba47";
const JOHNNY_STORY = `${J}/items/ccfc0b25-d08a-4dcb-8251-7106d50d7c6a`;

export interface ChangeItem { text: string; href?: string }
export interface ChangeRound { at: string; title: string; items: ChangeItem[] }

export const CHANGELOG: ChangeRound[] = [
  {
    at: "2026-11-16T19:30:00Z",
    title: "Generate Locally (on your own computer)",
    items: [
      { text: "Storyboards → Connect Local Renderer: pair your computer with a one-time code. It shows what your computer reports (system, graphics card and memory, installed workflow, what it can do) and what isn't supported. Nothing is installed or downloaded for you.", href: `${J}/storyboards/renderer` },
      { text: "Generate Locally on a frame: choose the cast and location pictures and Look & Feel, see exactly which pictures go to your computer and which can't (with why), pick Draft or Refine, then send ONE frame. It runs on your computer through ComfyUI; no cloud image service is used." },
      { text: "Results stay in the frame's history: compare, show one on the frame, approve & lock. Approved or locked frames are never replaced. Cancel, out-of-memory, missing model, disconnect and failed upload are handled without losing your work; nothing retries on its own." },
      { text: "Print sheet: option to use each frame's chosen generated picture." },
    ],
  },
  {
    at: "2026-11-16T17:00:00Z",
    title: "Look & Feel (Treatment desk)",
    items: [
      { text: "Treatment desk → LOOK & FEEL: collect the images that shape your film. Upload pictures or drawings, reuse a picture already in the film (no copy), choose part of a treatment slide, or add a link (it stays a link). Each reference asks “What do you like about this?” and keeps your words.", href: `${J}/treatment` },
      { text: "Optional per reference: Use this for, Leave out, Applies to (whole film or chosen scenes, characters, places), approval, credit. Reorder with the arrows; remove from the collection without deleting the picture elsewhere." },
      { text: "Visual directions: named groups with an intention, ordered references, palette and scope. One approved direction can be the film's default; overlaps are never mixed. Every save keeps a version; approved storyboard frames that use a changed direction get a review note (nothing is redrawn)." },
      { text: "Palettes: add colors by hand, pick colors from a picture, or get suggested colors from its pixels (plain arithmetic, no AI). Suggestions are labeled as suggestions." },
      { text: "Storyboards → Refs tab: Cast → Location → Look & Feel for each frame. Follow the storyboard or film default, choose another direction, or pick references; see their Use for / Leave out notes; trace over a reference (not exported) or place it as a layer only when you choose.", href: `${J}/storyboards` },
    ],
  },
  {
    at: "2026-11-16T13:00:00Z",
    title: "Lens shelf (with Lens Addiction)",
    items: [
      { text: "Paste a Lens Addiction lens link and the lens name, focal length, aperture and anamorphic squeeze fill in from the link itself (the page isn't opened), camera stays yours to add.", href: `${J}/storyboards?panel=camera` },
      { text: "Camera tab → Lens shelf: browse Lens Addiction, then add a lens with its link, focal lengths, spherical/anamorphic. STUDIO keeps your notes and the link only; “Open on Lens Addiction” goes back to the page.", href: `${J}/storyboards` },
      { text: "Click a focal length to use that lens for a frame: field of view, depth of field and how far the camera stands for the shot size fill in. The lens name shows on the printed storyboard, with a credit link." },
    ],
  },
  {
    at: "2026-11-16T12:00:00Z",
    title: "Storyboards: Compose (no AI needed)",
    items: [
      { text: "Storyboards desk: compose frames by hand on a canvas — starter silhouettes and set pieces, your uploads, text and dialogue captions, drawing and erasing; move, scale, rotate, crop, flip, duplicate, group, lock, hide; snapping guides, grids, aspect presets; undo/redo; autosave plus Save versions.", href: `${J}/storyboards` },
      { text: "Project asset library: characters, poses, wardrobe, backgrounds, props, drawings and references (with purpose, what you like about it, credit, permission). Shared across frames; replacing a shared image shows exactly which frames change first." },
      { text: "Local look: exposure, contrast, saturation, warm/cool, grayscale, vignette and seeded grain — same in preview and export. Stock-inspired starting points are labeled approximations." },
      { text: "Exports rendered in the browser: PNG per frame or all, storyboard PDF, JSON with compositions." },
      { text: "Optional AI in a secondary menu, only when asked: Suggest Shots (editable before adding), Create Missing Asset (saved to the library), Illustrate This Frame (separate result; layers untouched), Shot Builder conversation." },
    ],
  },
  {
    at: "2026-11-16T07:20:00Z",
    title: "Thumbnail picker sees new slides right away",
    items: [
      { text: "Each time the picker opens it re-reads the treatment (slide IDs and labels) so slides just added or moved show up, and it jumps to the matching \"Casting / …\" or \"Locations / …\" slide. Works without signing in to Google or the Slides API, for a treatment shared by link.", href: `${J}/items/b547cb85-1d37-413a-8e10-3ebe1a74e14f#thumbnail` },
    ],
  },
  {
    at: "2026-11-16T06:10:00Z",
    title: "Thumbnail picker opens on the right slide",
    items: [
      { text: "The picker reads the treatment's slide labels (\"Casting/Johnny\", \"Location/Coffee Shop\") and opens on that character's or location's slide, with buttons for any other slides that name them. Plain text matching, no AI.", href: `${J}/items/b547cb85-1d37-413a-8e10-3ebe1a74e14f#thumbnail` },
      { text: "The slide list (IDs and labels, no images) is kept with the treatment, so every page knows it; \"Re-read slides\" updates it after the deck changes." },
    ],
  },
  {
    at: "2026-11-16T05:40:00Z",
    title: "Thumbnails stay put when the treatment changes",
    items: [
      { text: "A thumbnail now remembers the slide's permanent Google ID plus the spot (X, Y) and size of the area chosen, so adding, removing or reordering slides doesn't move it.", href: `${J}/items/b547cb85-1d37-413a-8e10-3ebe1a74e14f#thumbnail` },
    ],
  },
  {
    at: "2026-11-16T05:00:00Z",
    title: "Characters the script calls out join the cast",
    items: [
      { text: "When the script changes, a reader picks out people it singles out who aren't in the cast yet (e.g. the president, the man in the aisle, the kid on the plane) and adds them to Characters with what the script shows about them, marked \"Not described yet\".", href: `${J}/script` },
      { text: "New speaking parts (a name above a line of dialogue) are added the moment the script is saved." },
      { text: "Crowds and groups aren't added, and a character she removes is never added back." },
    ],
  },
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
