# Review of the supplied foundation (0001) — verified findings

Method: the supplied `0001_foundation.sql` was applied unchanged to PostgreSQL 16.15 with a Supabase auth shim (`db/test/00_supabase_auth_shim.sql`). Each claim was checked by catalog query or by an actual exploit attempt. `0002_access_control.sql` was **not supplied**; nothing here assumes its contents.

| # | Claim (brief / Nov 9 review) | Result | Evidence |
|---|---|---|---|
| 1 | RLS is not enabled | **Confirmed** | 0 of 28 public tables have RLS; 0 policies |
| 2 | FKs don't guarantee same-project relationships | **Confirmed** | A relationship from a project-A character to a project-B character was accepted |
| 3 | `current_version_id` FK doesn't guarantee same entity | **Confirmed** | A character's `current_version_id` set to a location's version was accepted |
| 4 | Immutable content/audit are intentions only | **Confirmed** | `UPDATE versions SET content=…` succeeded; no triggers on versions/audit_events |
| 5 | Invitation acceptance and controlled merge not implemented | **Confirmed** | No such functions exist in `public` |
| 6 | `project_imports.imported_asset_id` lacks an FK | **Confirmed** | No FK constraint covers that column |
| 7 | Review finding E: updated_at triggers missing on `project_invitations`, `project_imports` | **Not true for 0001** | Neither table has an `updated_at` column; all 12 tables that do have the trigger |
| 8 | Review finding A/B (Edit can update change sets; approval policies) | **Unverifiable** | Refers to policies in the unsupplied 0002 |
| 9 | Review finding F: global agent config readable by any user | **Unverifiable** | Refers to 0002 |

Additional findings:

- **0001 is not re-runnable.** Despite `if not exists` elsewhere, line 570 (`add constraint agent_runs_resource_estimate_fk`) fails on a second run.
- **The creator bootstrap conflated admin with creative authority.** The `projects_bootstrap_creator` trigger inserted every creator as `director` + `admin`, and `admin` was the top of the same ladder as `commit`.
- **`versions.parent_version_id` / `content_asset_id` were `on delete set null`.** That lets history lineage be silently rewritten. These are replaced by composite NO ACTION FKs.
- **`created_by` columns are client-supplied** in 0001, with no check against `auth.uid()`. This is resolved by removing client write privileges entirely.
- **pgcrypto installs into `public`** when run on plain Postgres. On Supabase it already exists in `extensions`, so this is a no-op.

## Corrections (in `20261114193035_milestone1_hardening.sql`)

See `docs/architecture.md`. Every protection is covered by `db/test/10_milestone1_security.sql`.

Remaining integrity gaps on **deferred** tables (not used by milestone 1, deny-all RLS):

- `agent_runs`, `ai_jobs`, `resource_estimates`, `resource_transactions`, `creative_decisions` approval links: cross-project FKs aren't yet composite.
- `asset_versions` has no `project_id`.
- `approvals.target_id` is polymorphic and is validated only inside trusted functions.
- Cost/duration non-negativity and state-transition checks on compute tables aren't added yet.
