# Milestone 2 — agents that propose, a director who decides

Goal: STUDIO receives the story and does the first pass, so the director reviews suggestions instead of typing every field. Agents never approve, edit or delete creative work; they only create **proposals**.

## Increment 2a (this increment): Story Lead breakdown

1. On the story workspace, an Edit-level member clicks **Suggest characters & locations**. A notice says the story text is sent to Anthropic's Claude, and nothing is added until accepted.
2. The database checks permission and the monthly AI budget, then records a queued **agent run** (`agent_runs`, domain `writer`, task `story_breakdown`).
3. The server runs the Story Lead in the background (`after()`, up to 5 minutes) with the latest story revision and the project's existing characters and locations.
4. The model returns JSON (structured outputs). Plain code then validates it:
   - Every evidence quote must appear in the story text, or it's dropped.
   - Names are matched to existing items to flag likely duplicates.
   - Kinds are limited to character and location.
5. The trusted service records the proposals, the token usage and the cost (`resource_transactions`), and writes an audit event with `actor_type = 'agent'`.
6. The **Suggestions** inbox shows each proposal with its quoted passages. For each one the director can:
   - **Accept** (optionally editing the name or description): creates the item with a *proposed* first revision, never an approved one, and links it to the story.
   - **Merge** into the existing item it matches: links the existing item to the story.
   - **Dismiss**.
7. **Budget:** the default is $10 per month per project. Only members with spending authority (Executive Producer) see spend and change the budget. When the remaining budget is under $0.25, new runs are refused with a plain message.

## Deferred to later increments

- Google Drive import (needs a Google Cloud OAuth client; uses the `drive.file` scope so STUDIO sees only files the user picks).
- Props, costumes and story beats (each needs a workspace and content schema first).
- Specialist side panels: Research Lead with attributed web references (no image generation), Production Designer.
- Re-import diffing and per-run EP approval thresholds.
- R2 artwork storage (separate setup task).

## Acceptance criteria

- View and Review members can't start a breakdown; Edit members can.
- Proposals can only be recorded by the service role. Clients can't insert proposals, runs or charges.
- Accepting a proposal creates an item whose only revision is `submitted`; nothing becomes canonical without `approve_revision`.
- Proposals referencing another project's items are rejected by foreign keys.
- Starting a run with insufficient budget is refused (`PT402`); charges are visible only to spend-authorized members.
- Quotes not found in the story are discarded before storage (unit tested).
- With no `ANTHROPIC_API_KEY` configured, the UI says AI isn't set up yet and no run is created.
- The real Anthropic call is verified once the key is configured; until then it's labelled unverified.
