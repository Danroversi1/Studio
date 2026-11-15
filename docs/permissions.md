# Permission model (provisional)

Authority is split into four independent dimensions on `project_members`:

| Column | Values | Meaning |
|---|---|---|
| `access_level` | `view` < `review` < `edit` < `commit` | Creative access ladder. The legacy `admin` value is forbidden by a check constraint. |
| `can_admin` | boolean | Manage membership and configuration. Grants **no** creative capability. |
| `can_approve_creative` | boolean | Director creative-approval authority. Check constraint: only `project_role = 'director'`. |
| `can_authorize_spend` | boolean | Resource-spending authority. Check constraint: only `project_role = 'executive_producer'`. |

`project_role` (`director`, `executive_producer`, `collaborator`) describes a person's production function. Authority comes only from the explicit flags; nothing is inferred from role or from Admin.

**Approving a revision as canonical requires `commit` access AND `can_approve_creative`.** Commit alone, Director-flag alone (without Commit), Admin, and Executive Producer are all refused.

The project creator is granted, explicitly and visibly in `create_project()` and the audit log: `director`, `commit`, `can_admin`, `can_approve_creative`. The creator does not receive spending authority.

## Matrix (milestone 1)

| Operation | View | Review | Edit | Commit | Commit + Director | Admin only | EP (edit + spend) |
|---|---|---|---|---|---|---|---|
| See project, members | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Read approved versions + their artwork, references, links | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Read drafts, proposals, full history, WIP artwork | – | ✓ | ✓ | ✓ | ✓ | – | ✓ |
| Read approvals, comments | – | ✓ | ✓ | ✓ | ✓ | – | ✓ |
| Read audit trail | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Comment on a revision | – | ✓ | ✓ | ✓ | ✓ | – | ✓ |
| Create character/location, rename, link, add reference | – | – | ✓ | ✓ | ✓ | – | ✓ |
| Upload artwork, save draft/proposed revision | – | – | ✓ | ✓ | ✓ | – | ✓ |
| Approve revision as canonical | – | – | – | – | ✓ | – | – |
| See agent suggestions and run status | – | ✓ | ✓ | ✓ | ✓ | – | ✓ |
| Ask the Story Lead; accept, merge or dismiss suggestions | – | – | ✓ | ✓ | ✓ | – | ✓ |
| Delete (soft-delete) the film | – | – | – | – | ✓ (with Admin) | – | – |
| See AI spend; change the monthly AI budget | – | – | – | – | – | – | ✓ |
| Authorize spending | *deferred — no spend operations exist yet* ||||||
| Manage members / invitations | *deferred — service role only in this milestone* ||||||

"Admin only" members have `access_level = view`, so they read like View users, plus the audit trail.

## Enforcement

- **Reads:** RLS policies (`SELECT` only) on every table in `public`. Tables for deferred features have RLS enabled and no policy (deny all).
- **Writes:** clients (`anon`, `authenticated`) have no `INSERT/UPDATE/DELETE` privilege on any table. All writes go through `SECURITY DEFINER` functions that read the actor from `auth.uid()` and re-check capability. A caller can't supply their own `created_by`, approver, or audit actor.
- **Trusted-only functions:** `complete_asset_upload`, `fail_asset_upload`, `start_agent_run`, `complete_story_breakdown` and `fail_agent_run` are executable only by `service_role`.
- **Agents:** an agent can only create rows in `agent_proposals`, through the service role. Accepting a proposal is a human action: it runs `create_entity`, so the new item's only revision is `submitted` and is authored by the person who accepted it. Agent runs are audited with `actor_type = 'agent'`.
- **Deleting a film** needs Admin *and* Director creative authority, plus typing the film's title. It's a soft delete: the project's status becomes `deleted`, and it vanishes for every member because `studio_my_membership()` ignores deleted projects. Nothing is destroyed. `restore_project()` (service role only) brings it back, and both actions are audited.
- **Budget:** spend records are append-only and readable only by members with `can_authorize_spend`. A Director without that flag can't see or change spending, and an Executive Producer can't approve creative work.
- **Non-members** get the same "Project not found" (`PT404`) for missing and inaccessible projects.

## Open decisions (not blocking milestone 1)

1. Who may grant or revoke `can_approve_creative` and `can_authorize_spend`? An Admin must not be able to grant themselves creative authority. Membership changes are therefore service-role only until this is decided.
2. A single person can't currently be both Director and Executive Producer (one `project_role`). That's fine for the expected household (daughter = Director, parent = EP), but confirm it.
3. Should a Commit user be able to merge a revision that a Director approved earlier (a two-step flow)? The `approvals` table supports it; this milestone uses the single-step Director + Commit approval.

## Creative partners (Story partner, Design partner)

- Instructions: the parent's specs in `docs/agents/*.txt`, embedded verbatim (`lib/agents/specs/`, regenerate from the .txt), plus a short "Running inside STUDIO" section that states what the partner can and cannot see or do (`lib/agents/partners.ts`).
- Talking to a partner needs **Edit** access (`post_agent_message`). **Review** access and above can read conversations (so the EP can see what the partners say). View access can't.
- Every reply is an `agent_runs` row (`task_type = 'conversation_turn'`) charged to the monthly AI budget. One reply at a time per conversation; at most 300 replies per film per day.
- Each turn the partner sees a fresh snapshot: synopsis, the last treatment text the Story Lead read, characters/locations with latest descriptions and approval state, reference titles/credits/notes, pending suggestions. It sees no images.
- Its only tool, `suggest_item`, adds a pending suggestion (same inbox and rules as the Story Lead). Nothing a partner does approves or edits the film.
- Messages are append-only.
