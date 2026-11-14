# Local setup, migrations and verification

## Prerequisites

Node 22+, the Supabase CLI and Docker (for `supabase start`). The database tests alone need only PostgreSQL 16 + `psql`.

## 1. Install dependencies and create the lockfile

```bash
npm ci               # installs exactly what package-lock.json records
npm run typecheck
npm run build
```

All versions are pinned exactly and resolved in `package-lock.json` (Next 16.4.6, React 19.2.8, @supabase/ssr 0.12.7, supabase-js 2.119.0, @aws-sdk 3.1169.0, Tailwind 4.3.3, TypeScript 6.0.3). Install, typecheck and production build were run on 2026-11-14 and pass.

## 2. Database

```bash
supabase init            # if supabase/config.toml does not exist yet; keeps supabase/migrations
supabase start           # local Postgres + Auth + API
supabase db reset        # applies supabase/migrations/* in order
supabase status          # copy API URL, anon/publishable key, service_role key
```

Migrations:

| File | Content |
|---|---|
| `20261114191039_foundation_baseline.sql` | The supplied 0001, unchanged |
| `20261114193035_milestone1_hardening.sql` | RLS, integrity, immutability, trusted functions |

**Existing environments.** If 0001 was already applied somewhere, mark it applied rather than re-running it (0001 isn't re-runnable):

```bash
supabase migration repair --status applied 20261114191039
supabase db push
```

If the unseen `0002_access_control.sql` was applied there, review that environment first. The hardening migration drops all `public` policies and replaces them. Legacy `admin` members become `view` + `can_admin`. Restore a creator's creative authority explicitly:

```sql
update public.project_members
   set access_level = 'commit', can_approve_creative = true
 where project_id = '<project>' and user_id = '<director>' and project_role = 'director';
```

### Live development database (applied 2026-11-14)

All migrations in `supabase/migrations/` are applied to the Supabase project "Danroversi1's Studio" (ref `bahmuyahrtwejvfngfav`, us-east-1, Postgres 17). The migration file names in this repository match the versions recorded there, so `supabase db push` and the Supabase GitHub integration treat them as already applied. The live copy of `20261114204155_story_breakdown_agents` differs from the file only in three inline comments; function bodies match exactly. After applying, the live schema's constraint, function and policy fingerprints matched the locally tested build exactly.

Supabase security advisor results after hardening, all expected:
- *RLS enabled, no policy* (15 tables): deliberate deny-all for deferred features.
- *Signed-in users can execute SECURITY DEFINER functions* (15): these are the intended write path, and each one re-checks permissions. The four `studio_*` helpers could move to a non-exposed schema later.
- *`set_updated_at` has a mutable search_path*: inherited from 0001; fix in the next migration with `alter function public.set_updated_at() set search_path = ''`.

## 3. App

```bash
cp .env.example .env.local    # fill in values from `supabase status`
openssl rand -base64 48       # → DEV_STORAGE_SECRET
node --env-file=.env.local scripts/seed-dev-users.mjs          # local accounts
npm run dev                                                    # http://localhost:3000
```

Sign in as `director@studio.test` and create a project. To try the permission levels in the browser, run the seed script again with the project id: `scripts/seed-dev-users.mjs <projectId>`.

For iPad testing on the same network, set `APP_URL` to the Mac's LAN address (e.g. `http://192.168.1.20:3000`) and start with `npm run dev -- -H 0.0.0.0`.

**R2.** Create a private bucket named `studio-media` (or set `STORAGE_BUCKET` and `alter database postgres set studio.storage_bucket = '<name>'`). Add a CORS rule allowing `PUT` from the app origin with headers `Content-Type` and `If-None-Match`. Create an API token scoped to that bucket, and set `STORAGE_DRIVER=r2` plus the `R2_*` variables. Never enable public access.

### Hosting on Vercel

The Vercel project `studio` (team "dnaideas") is linked to this repository, and every push to `main` deploys to production. Deployment Protection (Vercel Authentication) is on, so only members of the Vercel team can open `*.vercel.app` URLs.

Environment variables:
- **From the Supabase integration (production only):** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and others. Preview builds don't get them, so previews won't reach the database.
- **Added manually (production + preview):** `STORAGE_DRIVER=r2`, `STORAGE_BUCKET=studio-media`.
- **AI agents:** `ANTHROPIC_API_KEY` (Sensitive, production) is set. It's billed to the Claude Console workspace; STUDIO's own monthly budget is enforced in the database.
- **Still needed for artwork uploads:** `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. Until they're set, the upload and image routes return errors; everything else works.

Before giving anyone access, turn off public sign-ups in Supabase (Authentication → Sign In / Providers → "Allow new users to sign up") and create accounts under Authentication → Users.

## 4. Verification

```bash
npm run test:unit      # validation, signing, write-once storage (node:test)
PGHOST=… PGPORT=… PGUSER=postgres npm run test:db
```

`test:db` drops and recreates a throwaway database (`STUDIO_TEST_DB`, default `studio_test`) and loads the auth shim. **Don't point it at Supabase's own database.** To run the suite against local Supabase instead (real `auth` schema), skip the shim:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f db/test/10_milestone1_security.sql
```

This leaves a `tests` schema and seeded test users behind; run `supabase db reset` afterwards.

### Manual acceptance checklist (not yet executed — needs a running app)

- [ ] Workflow steps 1–10 as the director on a desktop browser; reload, then sign in from a second browser and see the same state.
- [ ] Repeat on iPad Safari (portrait and landscape) and at 1024×768 / 820×1180 viewports: sidebar groups, 44 px controls, artwork upload from Files/Photos.
- [ ] As `viewer@` only approved items are listed; as `editor@` there's no approve button, and a crafted request gets "needs Commit access and Director approval authority".
- [ ] Open two tabs, approve in one, then approve a different revision in the other: a clear conflict message appears.
- [ ] Copy an `/api/assets/<id>` URL into a browser signed in as `outsider@`: 404.
- [ ] An expired signed URL (wait > 5 min) is refused by storage.

## Unverified integrations

| Area | Status |
|---|---|
| Next.js app (all of `app/`, `components/`, `proxy.ts`) | Installs, typechecks (`tsc --noEmit`) and builds (`next build`); **not yet run against a live Supabase, and no browser or viewport check yet** |
| Supabase Auth / PostgREST via supabase-js | Not exercised. The DB functions they call are tested directly in SQL |
| PostgREST mapping of `PT409`/`PT404` to HTTP 409/404 | Based on PostgREST documentation; not observed |
| Cloudflare R2 adapter (`lib/storage/r2.ts`) | Not run against R2; `If-None-Match` write-once on presigned PUT is unconfirmed |
| `scripts/seed-dev-users.mjs` | Not run |
| Dev storage route handler | Adapter logic unit-tested; the HTTP route itself is not run |
