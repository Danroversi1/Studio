# Architecture decisions (milestone 1)

**ADR-1. Modular monolith on Next.js + Supabase.** One Next.js 16 app (App Router, server actions, route handlers) talks to Supabase Postgres. There are no separate services and no job queue yet.

**ADR-2. One shared project graph.** `entities` are stable identities (story, character, location); `versions` hold their changing creative states; `entity_relationships` connect them. WRITE and DEVELOP are views over the same rows, not copies.

**ADR-3. The database is the authorization boundary.** RLS governs every read. Clients hold `SELECT` only; every write is a `SECURITY DEFINER` function that takes the actor from `auth.uid()`. The UI hides controls for convenience only. Rationale: the PDF review's highest-severity risk was clients updating commit-sensitive fields directly.

**ADR-4. Append-only creative history.** Saving always inserts a new `versions` row. Triggers make content, lineage, author and timestamps immutable for everyone (including `service_role`). Only `status` can move, and only forward (`working/submitted → approved/rejected/superseded`, `approved → superseded`). Artwork attached to a revision lives in append-only `version_assets`.

**ADR-5. Explicit approval with optimistic concurrency.** Each revision records `base_version_id`: the approved version the author was looking at. `approve_revision(version, expected_current)` locks the entity row, then refuses (`PT409`, HTTP 409) if:

- the canonical version changed since the approver loaded the page, or
- the revision's base is no longer canonical.

On success it supersedes the old canonical, approves the new one, moves the pointer, writes an `approvals` row and an audit event, all in one transaction. The UI shows the database's message verbatim.

**ADR-6. Integrity via composite foreign keys.** Tables expose `unique (project_id, id)` / `unique (entity_id, id)`, and references use composite FKs. Cross-project and wrong-entity links are therefore impossible even for trusted code.

**ADR-7. Trusted audit.** `audit_events` is written only by trusted functions. Updates are refused for everyone, and deletes are refused for clients.

**ADR-8. Private media with server-generated keys.** The database generates object keys (`projects/{p}/entities/{e}/assets/{a}/original.{ext}`). A new upload is always a new asset and a new key, so originals are never overwritten. The flow is: reserve (`begin_asset_upload`) → signed PUT (10 min) → the server inspects the stored object (size, PNG/JPEG signature bytes, SHA-256) → `complete_asset_upload` (service role). Pending and failed assets are invisible under RLS. Downloads issue a 5-minute signed URL only after an RLS-checked read of the asset row.

**ADR-9. Storage adapters.** `dev-filesystem` is a clearly labelled local adapter with HMAC-signed, expiring, write-once URLs, and it's refused when `NODE_ENV=production`. `r2` uses the S3 API with region `auto`, and its PUT is signed with `If-None-Match: *` for write-once. The R2 adapter is **unverified** (no credentials were used).

**ADR-10. Deterministic first; no AI in this milestone.** Content validation, key generation, file sniffing and conflict detection are plain code. Entity creation is manual by design.

**Migration strategy.** `20261114191039_foundation_baseline.sql` is the supplied 0001 byte-for-byte, preserving history. `20261114193035_milestone1_hardening.sql` corrects it. If 0001 (or the unseen 0002) was already applied to some environment, record 0001 as applied there (`supabase migration repair --status applied 20261114191039`), review that environment's policies, then apply 0002. The migration drops all existing `public` policies before creating its own. Legacy `admin` members are converted conservatively to `view` + `can_admin`, and creative grants must be restored explicitly (see setup.md).

**Child safety and privacy notes.** Projects are private by default. There's no self sign-up page: accounts are created by a guardian. Reference links open with `noopener noreferrer`. Nothing is sent to external AI services.
