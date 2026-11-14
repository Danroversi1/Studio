# STUDIO database migrations — foundation 0.1

Target: Supabase PostgreSQL.

## Files

- `0001_foundation.sql` — core relational model: organizations, projects, graph, intake, assets, immutable creative versions, collaboration, Domain Leads, compute and resource accounting.
- `0002_access_control.sql` — row-level security (RLS) and explicit project access helpers/policies.

## Apply

1. Create a Supabase project.
2. Review the SQL against the current STUDIO PRD/TAS and run it in a development project first.
3. Apply `0001_foundation.sql`, then `0002_access_control.sql` using the Supabase SQL Editor or the Supabase CLI migration workflow.
4. Do not expose the Supabase service-role key in the browser. Server-side workers use it only in trusted environments.

## Important implementation notes

- The database stores object-storage keys, not public media URLs. Keep R2 buckets private and issue short-lived signed upload/download URLs from the backend.
- `versions` is append-only for client users. A trusted server-side merge operation should update `entities.current_version_id` only after checking commit permission, branch/base consistency and approval requirements.
- Project invitations should be created by a trusted backend flow that validates the inviter's `admin` access and sends the invitation. Do not let a client self-assign `accepted_at` or elevate `access_level`.
- The `project_members` table is the authority for project access. An organization membership alone does not grant access to every project in that organization. Pending email invitations live in `project_invitations` until accepted; the trusted backend must validate the token, email identity and expiry before creating the membership row.
- `project_role` describes a person's production function; `access_level` describes their technical permissions. An Executive Producer role does not automatically grant creative commit authority.
- Agent and job execution results, resource transactions and audit events are written by trusted server-side services, not arbitrary browser clients.
- This is a first migration baseline, not a production security sign-off. Before launch, add automated tests for RLS, invitation acceptance, commit/merge authorization, resource approvals, and cross-project isolation.

## Deliberate next migrations

1. `0003_events_and_outbox.sql` — transactional outbox, domain events and idempotent event processing.
2. `0004_module_workspaces.sql` — structured screenplay/treatment content, shot blueprints, storyboard panels, lens profiles, camera setups, editorial timeline and score/cue data.
3. `0005_security_hardening.sql` — permission-aware commit functions, invitation workflow, immutable audit/event enforcement, storage policies and RLS test coverage.
