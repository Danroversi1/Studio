-- STUDIO — Storyboards: build first, generate when needed.
--
-- A storyboard sequence is a project entity (kind 'storyboard'), so uploads are ordinary
-- assets on it. Each frame (shot) has a stable ID and an editable composition (layers,
-- transforms, drawing strokes, framing, look + grain seed) stored as data, never flattened.
-- Display order is a separate position. Autosave updates the composition; "Save" records a
-- version. A project asset library holds reusable characters, poses, wardrobe, backgrounds,
-- props, drawings and references; frames refer to library items with per-frame transforms.
-- AI is optional: jobs exist only for "Illustrate This Frame" and "Create Missing Asset",
-- and shot suggestions are a text-model run whose results she edits before adding.
-- Nothing here calls a model; routine actions never create jobs.
begin;

-- ---- Sequences --------------------------------------------------------------------------
create table if not exists public.storyboard_sequences (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  title text not null check (length(title) between 1 and 120),
  brief text not null default '' check (length(brief) <= 6000),
  entry jsonb not null default '{}'::jsonb,      -- how it started: text / script scenes / images
  settings jsonb not null default '{}'::jsonb,   -- sequence defaults (style, aspect, format, look)
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists storyboard_sequences_project on public.storyboard_sequences (project_id) where archived_at is null;

-- ---- Shots ------------------------------------------------------------------------------
create table if not exists public.storyboard_shots (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.storyboard_sequences(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  position double precision not null,
  state text not null default 'proposed' check (state in ('proposed', 'approved')),
  locked boolean not null default false,
  origin text not null default 'director' check (origin in ('director', 'agent')),
  revision int not null default 1,
  content jsonb not null,
  approved_revision int,
  approved_content jsonb,
  composition jsonb not null default '{}'::jsonb,                        -- editable layers (data, not pixels)
  composition_version int not null default 0,
  illustration_asset_id uuid references public.assets(id) on delete set null, -- optional AI illustration shown
  review jsonb,                                                          -- why it needs a look
  notes text not null default '' check (length(notes) <= 4000),          -- director annotations
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists storyboard_shots_seq on public.storyboard_shots (sequence_id, position) where archived_at is null;

create table if not exists public.storyboard_shot_revisions (
  id uuid primary key default gen_random_uuid(),
  shot_id uuid not null references public.storyboard_shots(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  revision int not null,
  content jsonb not null,
  composition jsonb,
  origin text not null check (origin in ('director', 'agent')),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (shot_id, revision)
);

-- ---- Project asset library ------------------------------------------------------------
create table if not exists public.storyboard_library (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('character', 'pose', 'wardrobe', 'background', 'prop', 'drawing', 'reference')),
  name text not null check (length(name) between 1 and 120),
  asset_id uuid references public.assets(id) on delete set null,      -- the image (null for a link-only reference)
  entity_id uuid references public.entities(id) on delete set null,   -- shared character / location ID
  parent_id uuid references public.storyboard_library(id) on delete set null, -- a pose or wardrobe of a character
  views text not null default '' check (length(views) <= 300),        -- which views/poses it actually supplies
  purpose text check (purpose in ('character', 'location', 'prop', 'composition', 'atmosphere', 'color', 'illustration_style')),
  note text not null default '' check (length(note) <= 600),          -- "What do you like about this?"
  usage text not null default 'composition' check (usage in ('composition', 'reference_only')),
  source_url text check (source_url is null or (length(source_url) <= 2000 and source_url ~ '^https://')),
  attribution text not null default '' check (length(attribution) <= 300),
  permission text not null default '' check (length(permission) <= 300),
  origin text not null default 'upload' check (origin in ('upload', 'generated', 'link', 'film')),
  version int not null default 1,
  previous_asset_ids uuid[] not null default '{}',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (asset_id is not null or source_url is not null or entity_id is not null)
);
create index if not exists storyboard_library_project on public.storyboard_library (project_id) where archived_at is null;

-- ---- Generation jobs (history; never overwritten) ---------------------------------------
create table if not exists public.storyboard_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  sequence_id uuid not null references public.storyboard_sequences(id) on delete cascade,
  shot_id uuid references public.storyboard_shots(id) on delete cascade,      -- illustrate: the source frame
  library_item_id uuid references public.storyboard_library(id) on delete set null, -- asset: where the result goes
  kind text not null check (kind in ('illustrate', 'asset')),
  mode text not null default 'illustration' check (length(mode) <= 40),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  provider text not null check (length(provider) <= 40),
  model text not null check (length(model) <= 80),
  prompt_version text not null check (length(prompt_version) <= 40),
  prompt text not null check (length(prompt) <= 12000),
  params jsonb not null,                  -- snapshot of every setting used (incl. presets)
  reference_assets jsonb not null default '[]'::jsonb,  -- images actually sent [{asset_id, role}]
  text_only_refs jsonb not null default '[]'::jsonb,    -- described in words only
  source_revision int,                      -- frame composition version it came from
  base_asset_id uuid references public.assets(id) on delete set null,   -- the rough composition render sent
  output_asset_id uuid references public.assets(id) on delete set null,
  applied boolean not null default false, -- became the shot's shown image
  usage jsonb,
  error text,
  idempotency_key text not null check (length(idempotency_key) between 8 and 120),
  requested_by uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique (project_id, idempotency_key)
);
create index if not exists storyboard_jobs_shot on public.storyboard_jobs (shot_id, created_at desc);

-- ---- Libraries (curated, versioned) -----------------------------------------------------
create table if not exists public.storyboard_lens_profiles (
  id text primary key check (id ~ '^[a-z0-9-]{2,60}$'),
  manufacturer text not null,
  model text not null,
  focal_lengths numeric[] not null default '{}',
  coverage text not null default '',
  optical text not null check (optical in ('spherical', 'anamorphic')),
  squeeze numeric,
  aperture_spec text not null default '',        -- as published, e.g. 'T2.0' or 'f/1.4'
  source_url text,
  verification text not null check (verification in ('manufacturer_spec', 'secondary_source', 'unverified', 'generic')),
  character_notes text not null default '',      -- editorial, labeled as such in the app
  production_examples jsonb not null default '[]'::jsonb,  -- kept apart from specs
  version int not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists public.storyboard_stock_profiles (
  id text primary key check (id ~ '^[a-z0-9-]{2,60}$'),
  manufacturer text not null,
  stock text not null,
  product_codes text[] not null default '{}',
  category text not null check (category in ('camera_negative', 'reversal', 'print', 'other')),
  medium text not null check (medium in ('motion_picture', 'still')),
  gauges text[] not null default '{}',
  balance text check (balance in ('daylight', 'tungsten')),
  ei_daylight numeric,
  ei_tungsten numeric,
  exposure_notes text not null default '',
  documented text not null default '',     -- from the manufacturer's own documents
  editorial text not null default '',      -- descriptive language, kept separate
  source_urls text[] not null default '{}',
  verification text not null check (verification in ('manufacturer_spec', 'secondary_source', 'unverified')),
  checked_at date,
  version int not null default 1,
  updated_at timestamptz not null default now()
);

-- ---- Access -----------------------------------------------------------------------------
do $$ declare t text;
begin
  foreach t in array array['storyboard_sequences', 'storyboard_shots', 'storyboard_shot_revisions', 'storyboard_library', 'storyboard_jobs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.studio_level(project_id) >= 2)', t || '_read', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
  foreach t in array array['storyboard_lens_profiles', 'storyboard_stock_profiles'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ---- Sequence RPCs ----------------------------------------------------------------------
create or replace function public.storyboard_create(p_project uuid, p_title text, p_brief text, p_entry jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_entity uuid; v_id uuid; v_title text := btrim(coalesce(p_title, ''));
begin
  v_uid := public.studio_require(p_project, 3, 'make a storyboard');
  if length(v_title) not between 1 and 120 then raise exception 'Give the storyboard a title (up to 120 characters).' using errcode = '22023'; end if;
  if length(coalesce(p_brief, '')) > 6000 then raise exception 'The description is too long.' using errcode = '22023'; end if;
  if p_entry is not null and (jsonb_typeof(p_entry) <> 'object' or length(p_entry::text) > 20000) then
    raise exception 'Unexpected starting point.' using errcode = '22023';
  end if;
  -- The storyboard is a project entity (so its pictures are ordinary assets on it).
  insert into public.entities (project_id, kind, name, module_key, created_by)
  values (p_project, 'storyboard', v_title, 'storyboard', v_uid)
  returning id into v_entity;
  insert into public.storyboard_sequences (project_id, entity_id, title, brief, entry, created_by)
  values (p_project, v_entity, v_title, coalesce(p_brief, ''), coalesce(p_entry, '{}'::jsonb), v_uid)
  returning id into v_id;
  perform public.studio_audit(p_project, v_uid, 'user', 'storyboard.created', 'storyboard', v_id, '{}'::jsonb);
  return v_id;
end $$;

create or replace function public.storyboard_update(p_sequence uuid, p_title text, p_brief text, p_settings jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare s public.storyboard_sequences; v_uid uuid;
begin
  select * into s from public.storyboard_sequences where id = p_sequence;
  v_uid := public.studio_require(s.project_id, 3, 'edit a storyboard');
  if p_title is not null and length(btrim(p_title)) not between 1 and 120 then raise exception 'Titles are 1–120 characters.' using errcode = '22023'; end if;
  if p_brief is not null and length(p_brief) > 6000 then raise exception 'The description is too long.' using errcode = '22023'; end if;
  if p_settings is not null and (jsonb_typeof(p_settings) <> 'object' or length(p_settings::text) > 8000) then
    raise exception 'Unexpected settings.' using errcode = '22023';
  end if;
  update public.storyboard_sequences
     set title = coalesce(nullif(btrim(p_title), ''), title), brief = coalesce(p_brief, brief),
         settings = coalesce(p_settings, settings), updated_at = now()
   where id = p_sequence;
end $$;

create or replace function public.storyboard_archive(p_sequence uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare s public.storyboard_sequences; v_uid uuid;
begin
  select * into s from public.storyboard_sequences where id = p_sequence;
  v_uid := public.studio_require(s.project_id, 3, 'remove a storyboard');
  update public.storyboard_sequences set archived_at = now(), updated_at = now() where id = p_sequence;
  perform public.studio_audit(s.project_id, v_uid, 'user', 'storyboard.archived', 'storyboard', p_sequence, '{}'::jsonb);
end $$;

-- ---- Shot RPCs --------------------------------------------------------------------------
create or replace function public.storyboard_shot_check(p_content jsonb)
returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_content is null or jsonb_typeof(p_content) <> 'object' or length(p_content::text) > 20000 then
    raise exception 'Unexpected frame details.' using errcode = '22023';
  end if;
end $$;

create or replace function public.storyboard_composition_check(p_comp jsonb)
returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_comp is null or jsonb_typeof(p_comp) <> 'object' or length(p_comp::text) > 600000 then
    raise exception 'This frame has too much in it to save (keep drawings and layers under the limit).' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_comp -> 'layers', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_comp -> 'layers', '[]'::jsonb)) > 300 then
    raise exception 'A frame holds up to 300 layers.' using errcode = '22023';
  end if;
end $$;

/** Add a frame (p_shot null) at p_position with optional composition, or save new frame
 *  details as a version. Editing an approved frame makes it a proposal again; locked
 *  frames can't be edited. */
create or replace function public.storyboard_shot_save(p_sequence uuid, p_shot uuid, p_content jsonb, p_origin text,
  p_position double precision, p_expected_revision int, p_composition jsonb default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare s public.storyboard_sequences; sh public.storyboard_shots; v_uid uuid; v_id uuid; v_pos double precision;
begin
  select * into s from public.storyboard_sequences where id = p_sequence;
  v_uid := public.studio_require(s.project_id, 3, 'edit the storyboard');
  if s.archived_at is not null then raise exception 'That storyboard was removed.' using errcode = 'PT404'; end if;
  perform public.storyboard_shot_check(p_content);
  if p_composition is not null then perform public.storyboard_composition_check(p_composition); end if;
  if coalesce(p_origin, 'director') not in ('director', 'agent') then raise exception 'Unknown origin.' using errcode = '22023'; end if;
  if p_shot is null then
    if (select count(*) from public.storyboard_shots where sequence_id = p_sequence and archived_at is null) >= 200 then
      raise exception 'A storyboard holds up to 200 frames.' using errcode = '22023';
    end if;
    v_pos := coalesce(p_position, (select coalesce(max(position), 0) + 1000 from public.storyboard_shots where sequence_id = p_sequence));
    insert into public.storyboard_shots (sequence_id, project_id, position, origin, content, composition, created_by)
    values (p_sequence, s.project_id, v_pos, coalesce(p_origin, 'director'), p_content, coalesce(p_composition, '{}'::jsonb), v_uid)
    returning id into v_id;
    insert into public.storyboard_shot_revisions (shot_id, project_id, revision, content, composition, origin, created_by)
    values (v_id, s.project_id, 1, p_content, coalesce(p_composition, '{}'::jsonb), coalesce(p_origin, 'director'), v_uid);
    return v_id;
  end if;
  select * into sh from public.storyboard_shots where id = p_shot and sequence_id = p_sequence for update;
  if sh.id is null or sh.archived_at is not null then raise exception 'Frame not found.' using errcode = 'PT404'; end if;
  if sh.locked then raise exception 'This frame is locked. Unlock it to change it.' using errcode = '22023'; end if;
  if p_expected_revision is not null and p_expected_revision <> sh.revision then
    raise exception 'This frame changed since you opened it. Reload to see the latest.' using errcode = 'PT409';
  end if;
  if sh.content = p_content then return sh.id; end if;
  update public.storyboard_shots
     set content = p_content, revision = sh.revision + 1, state = 'proposed', updated_at = now()
   where id = p_shot;
  insert into public.storyboard_shot_revisions (shot_id, project_id, revision, content, composition, origin, created_by)
  values (p_shot, sh.project_id, sh.revision + 1, p_content, sh.composition, coalesce(p_origin, 'director'), v_uid);
  return p_shot;
end $$;

/** Autosave the editable composition (no version row). Returns the new composition version.
 *  A stale version is refused so two open tabs never silently overwrite each other. */
create or replace function public.storyboard_shot_compose(p_shot uuid, p_composition jsonb, p_expected_version int)
returns int
language plpgsql security definer set search_path = '' as $$
declare sh public.storyboard_shots; v_uid uuid;
begin
  select * into sh from public.storyboard_shots where id = p_shot for update;
  v_uid := public.studio_require(sh.project_id, 3, 'edit frames');
  if sh.archived_at is not null then raise exception 'Frame not found.' using errcode = 'PT404'; end if;
  if sh.locked then raise exception 'This frame is locked. Unlock it to change it.' using errcode = '22023'; end if;
  perform public.storyboard_composition_check(p_composition);
  if p_expected_version is not null and p_expected_version <> sh.composition_version then
    raise exception 'This frame was changed somewhere else. Reload to see the latest.' using errcode = 'PT409';
  end if;
  update public.storyboard_shots
     set composition = p_composition, composition_version = sh.composition_version + 1,
         state = case when sh.state = 'approved' and sh.composition <> p_composition then 'proposed' else sh.state end, updated_at = now()
   where id = p_shot;
  return sh.composition_version + 1;
end $$;

/** "Save": record the current frame (details + composition) as a version. */
create or replace function public.storyboard_shot_snapshot(p_shot uuid)
returns int
language plpgsql security definer set search_path = '' as $$
declare sh public.storyboard_shots; v_uid uuid; v_last jsonb;
begin
  select * into sh from public.storyboard_shots where id = p_shot for update;
  v_uid := public.studio_require(sh.project_id, 3, 'save frames');
  select composition into v_last from public.storyboard_shot_revisions where shot_id = p_shot order by revision desc limit 1;
  if v_last is not distinct from sh.composition then return sh.revision; end if;
  update public.storyboard_shots set revision = sh.revision + 1, updated_at = now() where id = p_shot;
  insert into public.storyboard_shot_revisions (shot_id, project_id, revision, content, composition, origin, created_by)
  values (p_shot, sh.project_id, sh.revision + 1, sh.content, sh.composition, 'director', v_uid);
  return sh.revision + 1;
end $$;

/** Bring back an earlier version of a frame (the current one is kept as a version first). */
create or replace function public.storyboard_shot_restore(p_shot uuid, p_revision int)
returns void
language plpgsql security definer set search_path = '' as $$
declare sh public.storyboard_shots; r public.storyboard_shot_revisions; v_uid uuid;
begin
  select * into sh from public.storyboard_shots where id = p_shot for update;
  v_uid := public.studio_require(sh.project_id, 3, 'restore frames');
  if sh.locked then raise exception 'This frame is locked. Unlock it first.' using errcode = '22023'; end if;
  select * into r from public.storyboard_shot_revisions where shot_id = p_shot and revision = p_revision;
  if r.id is null then raise exception 'Version not found.' using errcode = 'PT404'; end if;
  perform public.storyboard_shot_snapshot(p_shot);
  select * into sh from public.storyboard_shots where id = p_shot;
  update public.storyboard_shots
     set content = r.content, composition = coalesce(r.composition, sh.composition), composition_version = sh.composition_version + 1,
         revision = sh.revision + 1, state = 'proposed', updated_at = now()
   where id = p_shot;
  insert into public.storyboard_shot_revisions (shot_id, project_id, revision, content, composition, origin, created_by)
  values (p_shot, sh.project_id, sh.revision + 1, r.content, coalesce(r.composition, sh.composition), 'director', v_uid);
end $$;

/** Duplicate a frame right after itself: an independent copy of its details and layers
 *  (shared library items stay shared; layer placement is the copy's own). */
create or replace function public.storyboard_shot_duplicate(p_shot uuid, p_composition jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare sh public.storyboard_shots; v_uid uuid; v_next double precision; v_id uuid; v_comp jsonb;
begin
  select * into sh from public.storyboard_shots where id = p_shot;
  v_uid := public.studio_require(sh.project_id, 3, 'duplicate frames');
  if (select count(*) from public.storyboard_shots where sequence_id = sh.sequence_id and archived_at is null) >= 200 then
    raise exception 'A storyboard holds up to 200 frames.' using errcode = '22023';
  end if;
  v_comp := coalesce(p_composition, sh.composition);
  perform public.storyboard_composition_check(v_comp);
  select min(position) into v_next from public.storyboard_shots where sequence_id = sh.sequence_id and archived_at is null and position > sh.position;
  insert into public.storyboard_shots (sequence_id, project_id, position, origin, content, composition, created_by)
  values (sh.sequence_id, sh.project_id, case when v_next is null then sh.position + 1000 else (sh.position + v_next) / 2 end,
          'director', sh.content - 'source', v_comp, v_uid)
  returning id into v_id;
  insert into public.storyboard_shot_revisions (shot_id, project_id, revision, content, composition, origin, created_by)
  values (v_id, sh.project_id, 1, sh.content - 'source', v_comp, 'director', v_uid);
  return v_id;
end $$;

create or replace function public.storyboard_shot_move(p_shot uuid, p_position double precision)
returns void
language plpgsql security definer set search_path = '' as $$
declare sh public.storyboard_shots; v_uid uuid;
begin
  select * into sh from public.storyboard_shots where id = p_shot;
  v_uid := public.studio_require(sh.project_id, 3, 'reorder the storyboard');
  if p_position is null or p_position <> p_position then raise exception 'Unexpected position.' using errcode = '22023'; end if;
  update public.storyboard_shots set position = p_position where id = p_shot;  -- identity, versions and layers unchanged
end $$;

create or replace function public.storyboard_shot_state(p_shot uuid, p_state text, p_locked boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare sh public.storyboard_shots; v_uid uuid;
begin
  select * into sh from public.storyboard_shots where id = p_shot;
  v_uid := public.studio_require(sh.project_id, 3, 'approve frames');
  if p_state is not null and p_state not in ('proposed', 'approved') then raise exception 'Unknown state.' using errcode = '22023'; end if;
  if p_state = 'approved' then perform public.storyboard_shot_snapshot(p_shot); select * into sh from public.storyboard_shots where id = p_shot; end if;
  update public.storyboard_shots
     set state = coalesce(p_state, state),
         approved_revision = case when p_state = 'approved' then sh.revision else approved_revision end,
         approved_content = case when p_state = 'approved' then sh.content else approved_content end,
         locked = coalesce(p_locked, locked), updated_at = now()
   where id = p_shot;
  perform public.studio_audit(sh.project_id, v_uid, 'user', 'storyboard.shot_state', 'storyboard_shot', p_shot,
    jsonb_build_object('state', p_state, 'locked', p_locked));
end $$;

create or replace function public.storyboard_shot_notes(p_shot uuid, p_notes text)
returns void
language plpgsql security definer set search_path = '' as $$
declare sh public.storyboard_shots; v_uid uuid;
begin
  select * into sh from public.storyboard_shots where id = p_shot;
  v_uid := public.studio_require(sh.project_id, 3, 'annotate frames');
  if length(coalesce(p_notes, '')) > 4000 then raise exception 'Notes are up to 4000 characters.' using errcode = '22023'; end if;
  update public.storyboard_shots set notes = coalesce(p_notes, ''), updated_at = now() where id = p_shot;
end $$;

create or replace function public.storyboard_shot_archive(p_shot uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare sh public.storyboard_shots; v_uid uuid;
begin
  select * into sh from public.storyboard_shots where id = p_shot;
  v_uid := public.studio_require(sh.project_id, 3, 'remove frames');
  if sh.locked then raise exception 'This frame is locked. Unlock it first.' using errcode = '22023'; end if;
  update public.storyboard_shots set archived_at = now(), updated_at = now() where id = p_shot;
end $$;

create or replace function public.storyboard_shot_review(p_shot uuid, p_review jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare sh public.storyboard_shots; v_uid uuid;
begin
  select * into sh from public.storyboard_shots where id = p_shot;
  v_uid := public.studio_require(sh.project_id, 3, 'review frames');
  if p_review is not null and (jsonb_typeof(p_review) <> 'object' or length(p_review::text) > 4000) then
    raise exception 'Unexpected review note.' using errcode = '22023';
  end if;
  update public.storyboard_shots set review = p_review where id = p_shot;
end $$;

/** Show an earlier illustration from this frame's history (or none). */
create or replace function public.storyboard_shot_pick(p_shot uuid, p_asset uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare sh public.storyboard_shots; v_uid uuid;
begin
  select * into sh from public.storyboard_shots where id = p_shot;
  v_uid := public.studio_require(sh.project_id, 3, 'choose illustrations');
  if p_asset is not null and not exists (select 1 from public.storyboard_jobs j where j.shot_id = p_shot and j.output_asset_id = p_asset and j.status in ('succeeded', 'cancelled')) then
    raise exception 'That picture isn''t part of this frame.' using errcode = '22023';
  end if;
  update public.storyboard_shots set illustration_asset_id = p_asset, updated_at = now() where id = p_shot;
end $$;

-- ---- Library RPCs -----------------------------------------------------------------------
create or replace function public.storyboard_library_save(p_project uuid, p_item uuid, p_data jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_id uuid; v_asset uuid; v_entity uuid; v_parent uuid; v_url text;
begin
  v_uid := public.studio_require(p_project, 3, 'add to the asset library');
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'Unexpected asset.' using errcode = '22023'; end if;
  v_asset := nullif(p_data ->> 'asset_id', '')::uuid;
  v_entity := nullif(p_data ->> 'entity_id', '')::uuid;
  v_parent := nullif(p_data ->> 'parent_id', '')::uuid;
  v_url := nullif(p_data ->> 'source_url', '');
  if v_asset is not null and not exists (select 1 from public.assets where id = v_asset and project_id = p_project and upload_status = 'ready') then
    raise exception 'That picture isn''t in this film.' using errcode = '22023';
  end if;
  if v_entity is not null and not exists (select 1 from public.entities where id = v_entity and project_id = p_project) then
    raise exception 'That character or place isn''t in this film.' using errcode = '22023';
  end if;
  if v_parent is not null and not exists (select 1 from public.storyboard_library where id = v_parent and project_id = p_project) then
    raise exception 'Unknown parent asset.' using errcode = '22023';
  end if;
  if p_item is null then
    insert into public.storyboard_library (project_id, kind, name, asset_id, entity_id, parent_id, views, purpose, note, usage, source_url, attribution, permission, origin, created_by)
    values (p_project, p_data ->> 'kind', coalesce(nullif(btrim(p_data ->> 'name'), ''), 'Untitled'), v_asset, v_entity, v_parent,
            coalesce(p_data ->> 'views', ''), nullif(p_data ->> 'purpose', ''), coalesce(p_data ->> 'note', ''),
            -- A link with no image can only ever be a reference.
            case when v_asset is null then 'reference_only' else coalesce(nullif(p_data ->> 'usage', ''), 'composition') end,
            v_url, coalesce(p_data ->> 'attribution', ''), coalesce(p_data ->> 'permission', ''),
            case when v_asset is null and v_url is not null then 'link' when v_asset is null then 'film' else coalesce(nullif(p_data ->> 'origin', ''), 'upload') end, v_uid)
    returning id into v_id;
  else
    update public.storyboard_library
       set kind = coalesce(p_data ->> 'kind', kind), name = coalesce(nullif(btrim(p_data ->> 'name'), ''), name),
           entity_id = case when p_data ? 'entity_id' then v_entity else entity_id end,
           parent_id = case when p_data ? 'parent_id' then v_parent else parent_id end,
           views = coalesce(p_data ->> 'views', views), purpose = case when p_data ? 'purpose' then nullif(p_data ->> 'purpose', '') else purpose end,
           note = coalesce(p_data ->> 'note', note),
           usage = case when asset_id is null then 'reference_only' else coalesce(nullif(p_data ->> 'usage', ''), usage) end,
           attribution = coalesce(p_data ->> 'attribution', attribution), permission = coalesce(p_data ->> 'permission', permission), updated_at = now()
     where id = p_item and project_id = p_project returning id into v_id;
    if v_id is null then raise exception 'Asset not found.' using errcode = 'PT404'; end if;
  end if;
  return v_id;
end $$;

/** Frames that use a library item (what a shared change would affect). */
create or replace function public.storyboard_library_usage(p_item uuid)
returns table (shot_id uuid, sequence_id uuid, sequence_title text, frame_number bigint, locked boolean)
language plpgsql stable security definer set search_path = '' as $$
declare it public.storyboard_library; v_uid uuid;
begin
  select * into it from public.storyboard_library where id = p_item;
  v_uid := public.studio_require(it.project_id, 2, 'see where assets are used');
  return query
    select x.id, x.sequence_id, x.title, x.n, x.locked from (
      select sh.id, sh.sequence_id, sq.title, sh.locked, sh.composition,
             row_number() over (partition by sh.sequence_id order by sh.position) as n
        from public.storyboard_shots sh join public.storyboard_sequences sq on sq.id = sh.sequence_id
       where sh.project_id = it.project_id and sh.archived_at is null and sq.archived_at is null) x
    where exists (select 1 from jsonb_array_elements(coalesce(x.composition -> 'layers', '[]'::jsonb)) l where l ->> 'libraryId' = p_item::text)
    order by x.title, x.n;
end $$;

/** Replace a shared asset's image everywhere it's used. p_expected_frames must equal the
 *  number of frames she was shown, so the scope is always confirmed. The old image is kept. */
create or replace function public.storyboard_library_replace(p_item uuid, p_asset uuid, p_expected_frames int)
returns int
language plpgsql security definer set search_path = '' as $$
declare it public.storyboard_library; v_uid uuid; n int;
begin
  select * into it from public.storyboard_library where id = p_item for update;
  v_uid := public.studio_require(it.project_id, 3, 'replace shared assets');
  if not exists (select 1 from public.assets where id = p_asset and project_id = it.project_id and upload_status = 'ready') then
    raise exception 'That picture isn''t in this film.' using errcode = '22023';
  end if;
  select count(*) into n from public.storyboard_library_usage(p_item);
  if p_expected_frames is null or p_expected_frames <> n then
    raise exception 'This asset is now used in % frames. Check the list again before replacing it.', n using errcode = 'PT409';
  end if;
  update public.storyboard_library
     set previous_asset_ids = case when asset_id is null then previous_asset_ids else previous_asset_ids || asset_id end,
         asset_id = p_asset, version = version + 1, usage = case when usage = 'reference_only' and asset_id is null then 'composition' else usage end, updated_at = now()
   where id = p_item;
  perform public.studio_audit(it.project_id, v_uid, 'user', 'storyboard.asset_replaced', 'storyboard_library', p_item, jsonb_build_object('frames', n));
  return n;
end $$;

create or replace function public.storyboard_library_archive(p_item uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare it public.storyboard_library; v_uid uuid;
begin
  select * into it from public.storyboard_library where id = p_item;
  v_uid := public.studio_require(it.project_id, 3, 'remove assets');
  update public.storyboard_library set archived_at = now(), updated_at = now() where id = p_item;
end $$;

-- ---- Optional AI: jobs (only on request) -----------------------------------------------
/** Request "Illustrate This Frame" (kind illustrate, p_shot + p_base_asset = the rough
 *  composition render) or "Create Missing Asset" (kind asset, p_library_kind + name).
 *  The same idempotency key returns the same job (no duplicate). */
create or replace function public.storyboard_job_request(p_project uuid, p_kind text, p_shot uuid, p_library jsonb, p_provider text, p_model text,
  p_prompt_version text, p_prompt text, p_params jsonb, p_reference_assets jsonb, p_base_asset uuid, p_idempotency_key text)
returns table (job_id uuid, existing boolean)
language plpgsql security definer set search_path = '' as $$
declare sh public.storyboard_shots; v_uid uuid; v_id uuid; v_seq uuid; v_lib uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'use AI assistance');
  select j.id into v_id from public.storyboard_jobs j where j.project_id = p_project and j.idempotency_key = p_idempotency_key;
  if v_id is not null then return query select v_id, true; return; end if;
  if p_kind = 'illustrate' then
    select * into sh from public.storyboard_shots where id = p_shot and project_id = p_project;
    if sh.id is null or sh.archived_at is not null then raise exception 'Frame not found.' using errcode = 'PT404'; end if;
    if p_base_asset is null then raise exception 'Illustrating needs the frame''s composition.' using errcode = '22023'; end if;
    v_seq := sh.sequence_id;
  elsif p_kind = 'asset' then
    if p_library is null or (p_library ->> 'kind') not in ('character', 'pose', 'wardrobe', 'background', 'prop') then
      raise exception 'Choose what kind of asset to create.' using errcode = '22023';
    end if;
    v_seq := nullif(p_library ->> 'sequence_id', '')::uuid;
    if v_seq is null or not exists (select 1 from public.storyboard_sequences where id = v_seq and project_id = p_project) then
      raise exception 'Open a storyboard first.' using errcode = '22023';
    end if;
  else
    raise exception 'Unknown request.' using errcode = '22023';
  end if;
  if (select count(*) from public.storyboard_jobs j where j.project_id = p_project and j.status in ('queued', 'running')
        and j.created_at > now() - interval '10 minutes') >= 4 then
    raise exception 'A few pictures are already being made. Wait for them to finish.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_params, 'null'::jsonb)) <> 'object' or length(p_params::text) > 60000 then
    raise exception 'Unexpected settings.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_reference_assets, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_reference_assets, '[]'::jsonb)) > 15 then
    raise exception 'Up to 15 reference images can be sent.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_reference_assets, '[]'::jsonb)) x
              where not exists (select 1 from public.assets a where a.id = (x ->> 'asset_id')::uuid and a.project_id = p_project and a.upload_status = 'ready')) then
    raise exception 'A reference image isn''t available.' using errcode = '22023';
  end if;
  if p_base_asset is not null and not exists (select 1 from public.assets a where a.id = p_base_asset and a.project_id = p_project and a.upload_status = 'ready') then
    raise exception 'The frame''s composition isn''t available.' using errcode = '22023';
  end if;
  insert into public.storyboard_jobs (project_id, sequence_id, shot_id, kind, mode, provider, model, prompt_version, prompt, params,
                                      reference_assets, source_revision, base_asset_id, idempotency_key, requested_by)
  values (p_project, v_seq, case when p_kind = 'illustrate' then p_shot end, p_kind, case when p_kind = 'illustrate' then 'illustration' else p_library ->> 'kind' end,
          p_provider, p_model, p_prompt_version, p_prompt, p_params || jsonb_build_object('library', p_library),
          coalesce(p_reference_assets, '[]'::jsonb), case when p_kind = 'illustrate' then sh.composition_version end, p_base_asset, p_idempotency_key, v_uid)
  returning id into v_id;
  perform public.studio_audit(p_project, v_uid, 'user', 'storyboard.ai_requested', 'storyboard_job', v_id, jsonb_build_object('kind', p_kind, 'model', p_model));
  return query select v_id, false;
end $$;

-- SERVICE ROLE ONLY: claim a queued job.
create or replace function public.storyboard_job_start(p_job uuid)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare v boolean;
begin
  update public.storyboard_jobs set status = 'running', started_at = now() where id = p_job and status = 'queued' returning true into v;
  return coalesce(v, false);
end $$;

-- SERVICE ROLE ONLY: record a result. An illustration is linked to its source frame (the
-- editable composition is untouched) and shown unless the frame is locked; a created asset
-- goes into the library so it can be reused without generating again.
create or replace function public.storyboard_job_complete(p_job uuid, p_asset uuid, p_usage jsonb, p_model text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare j public.storyboard_jobs; sh public.storyboard_shots; v_apply boolean := false; v_lib uuid; lib jsonb;
begin
  select * into j from public.storyboard_jobs where id = p_job for update;
  if j.id is null then raise exception 'Job not found.' using errcode = 'PT404'; end if;
  if j.status not in ('running', 'cancelled') then raise exception 'Job is %, not running.', j.status using errcode = 'PT409'; end if;
  -- (asset origin is immutable by design; the job row records that this image was generated)
  update public.assets set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('storyboard_job_id', j.id, 'generated', true, 'kind', j.kind)
   where id = p_asset and project_id = j.project_id;
  if j.kind = 'illustrate' then
    select * into sh from public.storyboard_shots where id = j.shot_id for update;
    v_apply := j.status = 'running' and not sh.locked;
    if v_apply then update public.storyboard_shots set illustration_asset_id = p_asset, updated_at = now() where id = j.shot_id; end if;
  elsif j.status = 'running' then
    lib := j.params -> 'library';
    insert into public.storyboard_library (project_id, kind, name, asset_id, entity_id, views, note, usage, origin, attribution, permission, created_by)
    values (j.project_id, lib ->> 'kind', coalesce(nullif(lib ->> 'name', ''), 'Created asset'), p_asset, nullif(lib ->> 'entity_id', '')::uuid,
            coalesce(lib ->> 'views', ''), coalesce(lib ->> 'description', ''), 'composition', 'generated',
            'Generated with ' || coalesce(p_model, j.model), 'Made for this film in Studio', j.requested_by)
    returning id into v_lib;
    v_apply := true;
  end if;
  update public.storyboard_jobs
     set status = case when j.status = 'cancelled' then 'cancelled' else 'succeeded' end, output_asset_id = p_asset, library_item_id = v_lib,
         usage = p_usage, model = coalesce(left(p_model, 80), model), applied = v_apply, completed_at = now()
   where id = p_job;
  return v_lib;
end $$;

-- SERVICE ROLE ONLY. A failure never touches existing work.
create or replace function public.storyboard_job_fail(p_job uuid, p_error text, p_usage jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.storyboard_jobs set status = case when status = 'cancelled' then 'cancelled' else 'failed' end,
         error = left(coalesce(p_error, 'Failed.'), 1000), usage = coalesce(p_usage, usage), completed_at = now()
   where id = p_job and status in ('queued', 'running', 'cancelled');
end $$;

create or replace function public.storyboard_job_cancel(p_job uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare j public.storyboard_jobs; v_uid uuid;
begin
  select * into j from public.storyboard_jobs where id = p_job;
  v_uid := public.studio_require(j.project_id, 3, 'cancel generation');
  update public.storyboard_jobs set status = 'cancelled', error = coalesce(error, 'Cancelled.'), completed_at = coalesce(completed_at, now())
   where id = p_job and status in ('queued', 'running');
end $$;

-- ---- Optional AI: shot suggestions (text model, only on request) -----------------------
create or replace function public.storyboard_suggest_request(p_sequence uuid, p_scope jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare s public.storyboard_sequences; v_uid uuid; v_run uuid;
begin
  select * into s from public.storyboard_sequences where id = p_sequence;
  v_uid := public.studio_require(s.project_id, 3, 'ask for shot suggestions');
  if p_scope is null or jsonb_typeof(p_scope) <> 'object' or length(p_scope::text) > 30000 then
    raise exception 'Pick a scene or describe the moment first.' using errcode = '22023';
  end if;
  if exists (select 1 from public.agent_runs ar where ar.project_id = s.project_id and ar.task_type = 'shot_suggestions'
              and ar.status in ('queued', 'running') and ar.created_at > now() - interval '5 minutes') then
    raise exception 'Suggestions are already being made.' using errcode = 'PT409';
  end if;
  if public.studio_ai_budget_usd(s.project_id) - public.studio_ai_spent_month_usd(s.project_id) < 0.10 then
    raise exception 'The team has used this month''s AI budget. Ask your Executive Producer.' using errcode = 'PT402';
  end if;
  insert into public.agent_runs (project_id, domain, status, task_type, input_payload, model_provider, prompt_version, requested_by)
  values (s.project_id, 'cinematography', 'queued', 'shot_suggestions', jsonb_build_object('sequence_id', p_sequence, 'scope', p_scope),
          'anthropic', 'shot-suggestions-v1', v_uid)
  returning id into v_run;
  return v_run;
end $$;

-- SERVICE ROLE ONLY. Suggestions are stored on the run; nothing is added to the storyboard
-- until she picks and edits them.
create or replace function public.storyboard_suggest_complete(p_run uuid, p_shots jsonb, p_usage jsonb, p_cost_usd numeric, p_model text)
returns void
language plpgsql security definer set search_path = '' as $$
declare r public.agent_runs;
begin
  select * into r from public.agent_runs where id = p_run for update;
  if r.id is null or r.task_type <> 'shot_suggestions' then raise exception 'Run not found.' using errcode = 'PT404'; end if;
  if r.status <> 'running' then raise exception 'Run is %, not running.', r.status using errcode = 'PT409'; end if;
  if jsonb_typeof(p_shots) <> 'array' or jsonb_array_length(p_shots) > 12 or length(p_shots::text) > 40000 then
    raise exception 'Unexpected suggestions.' using errcode = '22023';
  end if;
  perform public.studio_record_ai_charge(r, p_usage, p_cost_usd);
  update public.agent_runs set status = 'succeeded', completed_at = now(), model_name = left(p_model, 100),
         token_usage = coalesce(p_usage, '{}'::jsonb), output_payload = jsonb_build_object('shots', p_shots)
   where id = p_run;
end $$;

-- ---- Grants -----------------------------------------------------------------------------
do $$ declare f text;
begin
  foreach f in array array[
    'storyboard_create(uuid, text, text, jsonb)', 'storyboard_update(uuid, text, text, jsonb)', 'storyboard_archive(uuid)',
    'storyboard_shot_save(uuid, uuid, jsonb, text, double precision, int, jsonb)', 'storyboard_shot_compose(uuid, jsonb, int)',
    'storyboard_shot_snapshot(uuid)', 'storyboard_shot_restore(uuid, int)', 'storyboard_shot_duplicate(uuid, jsonb)',
    'storyboard_shot_move(uuid, double precision)', 'storyboard_shot_state(uuid, text, boolean)', 'storyboard_shot_notes(uuid, text)',
    'storyboard_shot_archive(uuid)', 'storyboard_shot_review(uuid, jsonb)', 'storyboard_shot_pick(uuid, uuid)',
    'storyboard_library_save(uuid, uuid, jsonb)', 'storyboard_library_usage(uuid)', 'storyboard_library_replace(uuid, uuid, int)',
    'storyboard_library_archive(uuid)',
    'storyboard_job_request(uuid, text, uuid, jsonb, text, text, text, text, jsonb, jsonb, uuid, text)', 'storyboard_job_cancel(uuid)',
    'storyboard_suggest_request(uuid, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['storyboard_job_start(uuid)', 'storyboard_job_complete(uuid, uuid, jsonb, text)', 'storyboard_job_fail(uuid, text, jsonb)',
                           'storyboard_suggest_complete(uuid, jsonb, jsonb, numeric, text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  execute 'revoke all on function public.storyboard_shot_check(jsonb) from public, anon';
  execute 'revoke all on function public.storyboard_composition_check(jsonb) from public, anon';
end $$;

-- ---- Library seed (curated; verified fields cite their source) --------------------------
insert into public.storyboard_stock_profiles (id, manufacturer, stock, product_codes, category, medium, gauges, balance, ei_daylight, ei_tungsten,
  exposure_notes, documented, editorial, source_urls, verification, checked_at) values
('kodak-vision3-50d', 'Kodak', 'VISION3 50D', '{5203,7203}', 'camera_negative', 'motion_picture', '{35mm (5203),16mm (7203)}', 'daylight', 50, 12,
 'Daylight (5500K) EI 50; tungsten EI 12 with WRATTEN 2 No. 80A filter.',
 'Daylight-balanced color negative camera film (5500K). Kodak describes measured MTF as high. Process ECN-2.',
 'Editorial: often chosen for bright exteriors where very fine grain is wanted.',
 '{https://www.kodak.com/content/pdfs/motion/KODAK-VISION3-50D-5203-7203-brochure.pdf,https://www.kodak.com/en/motion/products/camera-films/}', 'manufacturer_spec', '2026-11-16'),
('kodak-vision3-250d', 'Kodak', 'VISION3 250D', '{5207,7207}', 'camera_negative', 'motion_picture', '{35mm (5207),16mm (7207)}', 'daylight', 250, 64,
 'Daylight (5500K) EI 250; tungsten EI 64 with WRATTEN 2 No. 80A filter.',
 'Daylight-balanced color negative camera film (5500K). Kodak describes the measured granularity as exceptionally low. Process ECN-2.',
 'Editorial: a versatile daylight stock for exteriors and mixed daylight interiors.',
 '{https://www.kodak.com/content/pdfs/KODAK-VISION3-250D-5207-7207-brochure.pdf,https://www.kodak.com/en/motion/products/camera-films/}', 'manufacturer_spec', '2026-11-16'),
('kodak-vision3-200t', 'Kodak', 'VISION3 200T', '{5213,7213}', 'camera_negative', 'motion_picture', '{35mm (5213),16mm (7213)}', 'tungsten', 125, 200,
 'Tungsten (3200K) EI 200; daylight EI 125 with WRATTEN 2 No. 85 filter.',
 'Tungsten-balanced color negative camera film (3200K). Kodak: image structure of a 100-speed film with 200-speed versatility. Process ECN-2.',
 'Editorial: often used for lit interiors.',
 '{https://www.kodak.com/content/pdfs/motion/KODAK-VISION3-200T-5213-7213-brochure.pdf,https://www.kodak.com/en/motion/products/camera-films/}', 'manufacturer_spec', '2026-11-16'),
('kodak-vision3-500t', 'Kodak', 'VISION3 500T', '{5219,7219}', 'camera_negative', 'motion_picture', '{35mm (5219),16mm (7219)}', 'tungsten', 320, 500,
 'Tungsten (3200K) EI 500; daylight EI 320 with WRATTEN 2 No. 85 filter.',
 'Tungsten-balanced color negative camera film (3200K). Kodak describes the measured granularity as exceptionally low. Process ECN-2.',
 'Editorial: a common choice for night and low-light work.',
 '{https://www.kodak.com/content/products-brochures/motion-picture/KODAK-VISION3-500T-5219-7219-brochure.pdf,https://www.kodak.com/en/motion/products/camera-films/}', 'manufacturer_spec', '2026-11-16')
on conflict (id) do nothing;

insert into public.storyboard_lens_profiles (id, manufacturer, model, focal_lengths, coverage, optical, squeeze, aperture_spec, source_url, verification, character_notes) values
('generic-spherical-prime', 'Generic', 'Spherical prime set', '{18,25,32,40,50,75,100}', 'Super 35', 'spherical', null, '', null, 'generic',
 'Editorial: a neutral starting point. Lens character here is a description for the image model, not a measured profile.'),
('generic-anamorphic-2x', 'Generic', '2× anamorphic prime set', '{35,40,50,75,100}', 'Super 35 (4-perf, 2× squeeze)', 'anamorphic', 2, '', null, 'generic',
 'Editorial: horizontal flares and oval out-of-focus highlights are typical of many 2× anamorphics; the image model only approximates them.'),
('generic-zoom', 'Generic', 'Cinema zoom', '{24,290}', 'Super 35', 'spherical', null, '', null, 'generic',
 'Editorial: a zoom range for experiments; the image model does not reproduce a specific zoom.')
on conflict (id) do nothing;



-- ---- Shot Builder (a creative partner) --------------------------------------------------
alter table public.agent_threads drop constraint if exists agent_threads_agent_check;
alter table public.agent_threads add constraint agent_threads_agent_check check (agent in ('story', 'design', 'world', 'dialogue', 'shots'));

create or replace function public.start_agent_thread(p_project uuid, p_agent text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_id uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'talk with the creative partners');
  if p_agent not in ('story', 'design', 'world', 'dialogue', 'shots') then
    raise exception 'Unknown partner.' using errcode = '22023';
  end if;
  insert into public.agent_threads (project_id, agent, created_by) values (p_project, p_agent, v_uid)
  returning id into v_id;
  perform public.studio_audit(p_project, v_uid, 'user', 'agent_thread.started', 'agent_thread', v_id,
    jsonb_build_object('agent', p_agent));
  return v_id;
end $$;

/** A message to a partner. p_focus says what she has open (e.g. a storyboard). */
create or replace function public.post_agent_message(p_thread uuid, p_content text, p_focus jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; t public.agent_threads; v_text text := btrim(coalesce(p_content, ''));
        v_story uuid; v_msg uuid; v_run uuid; v_focus jsonb;
begin
  select * into t from public.agent_threads where id = p_thread;
  v_uid := public.studio_require(t.project_id, 3, 'talk with the creative partners');
  if length(v_text) = 0 then
    raise exception 'Write a message first.' using errcode = '22023';
  end if;
  if length(v_text) > 6000 then
    raise exception 'That message is too long (6,000 characters at most).' using errcode = '22023';
  end if;
  if exists (select 1 from public.agent_runs r
              where r.project_id = t.project_id and r.task_type = 'conversation_turn'
                and r.status in ('queued', 'running') and r.created_at > now() - interval '5 minutes'
                and r.input_payload ->> 'thread_id' = p_thread::text) then
    raise exception 'Your partner is still answering. Wait for the reply, then send your next message.' using errcode = 'PT409';
  end if;
  if (select count(*) from public.agent_runs r where r.project_id = t.project_id
        and r.task_type = 'conversation_turn' and r.created_at > now() - interval '1 day') >= 300 then
    raise exception 'That''s a lot of conversation for one day. Your partners will be back tomorrow.' using errcode = 'PT402';
  end if;
  if public.studio_ai_budget_usd(t.project_id) - public.studio_ai_spent_month_usd(t.project_id) < 0.25 then
    raise exception 'The team has used this month''s AI budget. Ask your Executive Producer.' using errcode = 'PT402';
  end if;
  -- Only a storyboard of this film can be the focus.
  if p_focus is not null and p_focus ->> 'storyboard_id' is not null
     and exists (select 1 from public.storyboard_sequences s where s.id = (p_focus ->> 'storyboard_id')::uuid and s.project_id = t.project_id) then
    v_focus := jsonb_build_object('storyboard_id', p_focus ->> 'storyboard_id');
  end if;

  select id into v_story from public.entities where project_id = t.project_id and kind = 'story' order by created_at limit 1;
  insert into public.agent_messages (project_id, thread_id, role, content, author_id)
  values (t.project_id, t.id, 'user', v_text, v_uid) returning id into v_msg;
  insert into public.agent_runs (project_id, domain, status, task_type, input_payload, model_provider, prompt_version, requested_by)
  values (t.project_id, case t.agent when 'design' then 'production_designer' when 'shots' then 'cinematography' else 'writer' end::public.agent_domain,
          'queued', 'conversation_turn',
          jsonb_strip_nulls(jsonb_build_object('thread_id', t.id, 'agent', t.agent, 'message_id', v_msg, 'entity_id', v_story, 'focus', v_focus)),
          'anthropic', case t.agent when 'story' then 'story-partner-v2.0' when 'world' then 'world-builder-v1.0'
                                    when 'dialogue' then 'dialogue-partner-v1.0' when 'shots' then 'shot-builder-v1.0' else 'design-partner-v1.0' end, v_uid)
  returning id into v_run;
  update public.agent_threads
     set last_message_at = now(), title = coalesce(title, left(regexp_replace(v_text, '\s+', ' ', 'g'), 80))
   where id = t.id;
  return v_run;
end $$;

create or replace function public.post_agent_message(p_thread uuid, p_content text)
returns uuid
language sql security definer set search_path = '' as $$
  select public.post_agent_message(p_thread, p_content, null::jsonb);
$$;

revoke all on function public.post_agent_message(uuid, text, jsonb) from public, anon;
grant execute on function public.post_agent_message(uuid, text, jsonb) to authenticated;
revoke all on function public.post_agent_message(uuid, text) from public, anon;
grant execute on function public.post_agent_message(uuid, text) to authenticated;

commit;
