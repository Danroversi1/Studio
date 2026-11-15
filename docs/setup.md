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
- If the key is not scoped to a workspace, also set `ANTHROPIC_WORKSPACE_ID` (the workspace id from the Claude Console). Otherwise every AI request is refused with "This API key is not scoped to a workspace".
- **Still needed for artwork uploads and Drive imports:** `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (see "Cloudflare R2"). Until they're set, the upload and image routes return errors; everything else works.
- **Still needed for Google Drive:** `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_API_KEY`, `NEXT_PUBLIC_GOOGLE_APP_ID` (see "Google Drive"). Until they're set, the Drive pages say Google isn't connected.

### Google Drive (images and reading the treatment)

STUDIO reads Google Drive **in the browser**, with the person's own Google sign-in and only the
`drive.file` permission: it can open files they pick in Google's Picker (or picked before), nothing
else. The Google token never reaches STUDIO's server. One-time setup, about 15 minutes, free:

1. Go to https://console.cloud.google.com, create a project named `STUDIO`.
2. **APIs & Services → Library:** enable **Google Drive API** and **Google Picker API**.
3. **Google Auth Platform → Branding / Audience:** app name `STUDIO`, user type **External**, publishing status **Testing**. Under **Test users**, add the Google accounts that will use STUDIO (yours and your daughter's). Testing mode needs no Google review.
4. **Data access:** add the scope `.../auth/drive.file`.
5. **Clients → Create client → Web application.** Authorized JavaScript origins: `https://studio-one-omega-46.vercel.app` (and `http://localhost:3000` for local work). No redirect URIs. Copy the **Client ID**.
6. **APIs & Services → Credentials → Create credentials → API key.** Restrict it: *Websites* → `https://studio-one-omega-46.vercel.app/*`; *API restrictions* → Google Picker API. Copy the key.
7. **Project number:** Cloud console home (Project info card).
8. In Vercel (Production), add `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_API_KEY`, `NEXT_PUBLIC_GOOGLE_APP_ID` (= project number). These three are public by design (they ship to the browser), so they don't need the Sensitive flag. Redeploy.

Imports also need R2 (below), because each picked image is stored privately in STUDIO.

### Cloudflare R2 (private image storage)

1. Cloudflare dashboard → **R2 Object Storage** → enable R2 (free tier: 10 GB). Create bucket `studio-media`, location Automatic. Leave public access **off**.
2. Bucket → **Settings → CORS policy**:
   ```json
   [{"AllowedOrigins":["https://studio-one-omega-46.vercel.app"],"AllowedMethods":["PUT","GET"],"AllowedHeaders":["Content-Type","If-None-Match"],"MaxAgeSeconds":3600}]
   ```
3. R2 → **Manage API tokens → Create API token**: permission *Object Read & Write*, applied to `studio-media` only.
4. In Vercel (Production, mark Sensitive): `R2_ACCOUNT_ID` (shown on the R2 overview page), `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. Redeploy.

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
| Google sign-in, Picker, Drive download and Docs ZIP export (`lib/google/client.ts`) | Written against Google's documented APIs; **not run** (no Google project yet). ZIP reader and link parsing are unit-tested |
| Treatment reader (`components/treatment-reader.tsx`) | Builds; not opened in a browser with a real Doc |
| `scripts/seed-dev-users.mjs` | Not run |
| Dev storage route handler | Adapter logic unit-tested; the HTTP route itself is not run |

## Developer comments layer

Accounts listed in `public.studio_developers` see a **+ Comment** / **Dev** control in the
bottom-right corner of every page. Click **+ Comment**, click a spot on the page, write a
note: it is pinned to that page and spot (with the element it was on). Nobody else sees
the control or the comments (RLS + `is_studio_developer()`).

Add a developer (SQL editor, service role):

```sql
insert into public.studio_developers (user_id)
select id from auth.users where email = 'someone@example.com';
```

Read open comments (e.g. to work through them):

```sql
select path, body, anchor->>'selector' as element, anchor->>'snippet' as text, created_at
from public.dev_comments where status = 'open' order by created_at;
```
