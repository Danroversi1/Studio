# Product scope

STUDIO helps a young director develop an animated film through connected workspaces (WRITE, DEVELOP, ANIMATE, EDIT, SCORE) over one shared project. The director is the creative authority. Software and, later, AI may propose; nothing is approved silently.

## Milestone 1 — a connected creative workflow (this repository)

1. Sign in (email + password; accounts created by a guardian).
2. Create a private film project. The creator is Director with Commit + Admin + creative approval.
3. Write or paste a story/treatment. No screenplay is required.
4. Manually create characters and locations, and connect them to the story.
5. Open each item's workspace.
6. Upload Procreate exports (PNG/JPEG, ≤ 50 MB) to private storage.
7. Add reference links with attribution, rights status and notes.
8. Save new revisions, as drafts or proposals, with or without artwork.
9. Inspect any earlier revision, including its artwork.
10. Explicitly approve a revision as canonical. Stale approvals are refused with an explanation.
11. Everything persists in the cloud database and appears in any signed-in, authorized browser.

Works without AI. There are no controls for unfinished features.

## Deferred (preserved in the schema/architecture, not implemented, no placeholders)

- Human-reviewed screenplay breakdowns (extraction produces proposals a person accepts).
- Research Domain Leads and attributed moodboards. Research agents never generate images automatically; research, image generation and creative approval stay separate capabilities.
- Director treatment / pitch-deck assembly.
- Shot Blueprints connecting development to animation.
- Lens-first drawing guides and lens-after experimentation. These must distinguish framing, camera position, sensor size, focal length and optical effects, and must not promise physically accurate perspective reconstruction from arbitrary flat artwork.
- Storyboarding and animation; editorial timelines with deterministic time remapping.
- MusicXML, MIDI and audio interoperability with MuseScore.
- Resource estimates, Executive Producer spend approvals, asynchronous jobs.
- Secure Mac compute companion and local/cloud routing.
- Invitation delivery and the collaborator-management UI (membership is seeded by the service role for now).
- Branch/merge workflows beyond the single `main` branch; change sets.
