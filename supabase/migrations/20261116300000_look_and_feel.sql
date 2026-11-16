-- STUDIO — Look & Feel: the film's visual-direction knowledge base (Treatment desk).
--
-- Three reference roles stay distinct: Cast (who), Locations (where) live on character and
-- location entities; Look & Feel (how it looks) lives here. A Look & Feel reference points at
-- a shared asset (uploaded here or already in the film), a window of a treatment slide (a
-- crop: nothing stored), and/or an outside link (link-only until an image is attached).
-- Her words are kept as written. Visual directions group ordered references with a palette
-- and a scope; every change is a new version. Storyboard frames record which direction (and
-- version) they follow; editing a direction flags affected approved frames for review and
-- never regenerates anything. Nothing here calls a model.
begin;

-- ---- References -------------------------------------------------------------------------
create table if not exists public.look_references (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  asset_id uuid references public.assets(id) on delete set null,          -- the original image (shared asset)
  thumb_asset_id uuid references public.assets(id) on delete set null,    -- small browsing copy
  crop jsonb,                                                             -- a window of a treatment slide
  source_url text check (source_url is null or (length(source_url) <= 2000 and source_url ~ '^https://')),
  source_entity_id uuid references public.entities(id) on delete set null, -- came from this character/location
  title text not null default 'Reference' check (length(title) between 1 and 120),
  tags text[] not null default '{}' check (tags <@ array['colors', 'lighting', 'atmosphere', 'contrast', 'texture', 'drawing', 'composition', 'overall', 'other']::text[]),
  reason text not null default '' check (length(reason) <= 1000),        -- "What do you like about this?" (her words)
  use_for text not null default '' check (length(use_for) <= 600),
  leave_out text not null default '' check (length(leave_out) <= 600),
  applies jsonb not null default '{"film": true}'::jsonb,                 -- {film:true} | {entities:[...], scenes:[n...]}
  status text not null default 'proposed' check (status in ('proposed', 'approved')),
  palette jsonb not null default '[]'::jsonb,                             -- colors suggested or sampled from this image
  attribution text not null default '' check (length(attribution) <= 300),
  permission text not null default '' check (length(permission) <= 300),
  position double precision not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz                                                  -- removed from the collection (assets untouched)
);
create index if not exists look_references_project on public.look_references (project_id, position) where archived_at is null;

-- ---- Visual directions ------------------------------------------------------------------
create table if not exists public.look_directions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  intention text not null default '' check (length(intention) <= 600),
  notes text not null default '' check (length(notes) <= 2000),
  palette jsonb not null default '[]'::jsonb,
  scope jsonb not null default '{"film": true}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'approved', 'archived')),
  is_default boolean not null default false,
  version int not null default 1,
  position double precision not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not is_default or status = 'approved')
);
create unique index if not exists look_directions_one_default on public.look_directions (project_id) where is_default;
create index if not exists look_directions_project on public.look_directions (project_id, position);

create table if not exists public.look_direction_refs (
  direction_id uuid not null references public.look_directions(id) on delete cascade,
  reference_id uuid not null references public.look_references(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  position int not null,
  primary key (direction_id, reference_id)
);

create table if not exists public.look_direction_versions (
  id uuid primary key default gen_random_uuid(),
  direction_id uuid not null references public.look_directions(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  version int not null,
  snapshot jsonb not null,           -- name, intention, notes, palette, scope, status and its references (with her notes) at that time
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (direction_id, version)
);

-- ---- Storyboard links -------------------------------------------------------------------
alter table public.storyboard_sequences add column if not exists look_direction_id uuid references public.look_directions(id) on delete set null;
-- {mode: 'default' | 'direction' | 'references', direction_id?, version?, reference_ids?: [...]}
alter table public.storyboard_shots add column if not exists look jsonb;

-- ---- Access -----------------------------------------------------------------------------
do $$ declare t text;
begin
  foreach t in array array['look_references', 'look_directions', 'look_direction_refs', 'look_direction_versions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.studio_level(project_id) >= 2)', t || '_read', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ---- Helpers ----------------------------------------------------------------------------
/** The entity that owns Look & Feel uploads (created on first use). */
create or replace function public.look_owner_entity(p_project uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_id uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'add Look & Feel references');
  select id into v_id from public.entities where project_id = p_project and module_key = 'look' and kind = 'research_board' order by created_at limit 1;
  if v_id is null then
    insert into public.entities (project_id, kind, name, module_key, created_by)
    values (p_project, 'research_board', 'Look & Feel', 'look', v_uid) returning id into v_id;
  end if;
  return v_id;
end $$;

/** An image already in this film with the same bytes (so a re-upload reuses it). */
create or replace function public.look_find_asset(p_project uuid, p_sha256 text)
returns table (asset_id uuid, thumb_asset_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'add Look & Feel references');
  if p_sha256 !~ '^[0-9a-f]{64}$' then return; end if;
  return query
    select a.id, (select r.thumb_asset_id from public.look_references r where r.asset_id = a.id and r.thumb_asset_id is not null limit 1)
      from public.assets a
     where a.project_id = p_project and a.checksum_sha256 = p_sha256 and a.upload_status = 'ready' and a.deleted_at is null and a.kind = 'image'
     order by a.created_at limit 1;
end $$;

create or replace function public.look_check_applies(p_project uuid, p_applies jsonb)
returns jsonb
language plpgsql stable set search_path = '' as $$
declare v_ents jsonb; v_scenes jsonb;
begin
  if p_applies is null or jsonb_typeof(p_applies) <> 'object' or coalesce((p_applies ->> 'film')::boolean, false) then
    return '{"film": true}'::jsonb;
  end if;
  v_ents := coalesce(p_applies -> 'entities', '[]'::jsonb);
  v_scenes := coalesce(p_applies -> 'scenes', '[]'::jsonb);
  if jsonb_typeof(v_ents) <> 'array' or jsonb_typeof(v_scenes) <> 'array' or jsonb_array_length(v_ents) > 100 or jsonb_array_length(v_scenes) > 200 then
    raise exception 'Unexpected scope.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements_text(v_ents) x
              where x !~ '^[0-9a-f-]{36}$' or not exists (select 1 from public.entities e where e.id = x::uuid and e.project_id = p_project and e.kind in ('character', 'location'))) then
    raise exception 'Choose characters or locations from this film.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(v_scenes) x where jsonb_typeof(x) <> 'number' or (x::text)::numeric < 1 or (x::text)::numeric > 999) then
    raise exception 'Scenes are numbers from the script.' using errcode = '22023';
  end if;
  if jsonb_array_length(v_ents) = 0 and jsonb_array_length(v_scenes) = 0 then return '{"film": true}'::jsonb; end if;
  return jsonb_build_object('entities', v_ents, 'scenes', v_scenes);
end $$;

create or replace function public.look_check_palette(p_palette jsonb)
returns jsonb
language plpgsql immutable set search_path = '' as $$
begin
  if p_palette is null then return '[]'::jsonb; end if;
  if jsonb_typeof(p_palette) <> 'array' or jsonb_array_length(p_palette) > 24 then
    raise exception 'A palette holds up to 24 colors.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_palette) c
              where coalesce(c ->> 'hex', '') !~ '^#[0-9a-fA-F]{6}$' or coalesce(c ->> 'source', 'manual') not in ('manual', 'sampled', 'suggested')
                 or length(coalesce(c ->> 'label', '')) > 40) then
    raise exception 'Colors are #RRGGBB.' using errcode = '22023';
  end if;
  return p_palette;
end $$;

create or replace function public.look_check_crop(p_crop jsonb)
returns jsonb
language plpgsql immutable set search_path = '' as $$
begin
  if p_crop is null or p_crop = 'null'::jsonb then return null; end if;
  if jsonb_typeof(p_crop) <> 'object' or coalesce(p_crop ->> 'file_id', '') !~ '^[A-Za-z0-9_-]{10,200}$'
     or jsonb_typeof(p_crop -> 'slide') <> 'number'
     or exists (select 1 from unnest(array['x', 'y', 'w', 'h']) k where jsonb_typeof(p_crop -> k) <> 'number' or (p_crop ->> k)::numeric < 0 or (p_crop ->> k)::numeric > 1)
     or (p_crop ? 'slide_id' and p_crop ->> 'slide_id' is not null and p_crop ->> 'slide_id' !~ '^[A-Za-z0-9_.-]{1,100}$') then
    raise exception 'Unexpected treatment crop.' using errcode = '22023';
  end if;
  return jsonb_build_object('file_id', p_crop ->> 'file_id', 'slide', (p_crop ->> 'slide')::int, 'slide_id', p_crop -> 'slide_id',
    'x', (p_crop ->> 'x')::numeric, 'y', (p_crop ->> 'y')::numeric, 'w', (p_crop ->> 'w')::numeric, 'h', (p_crop ->> 'h')::numeric);
end $$;

-- ---- Reference RPCs ---------------------------------------------------------------------
/** Add (p_ref null) or edit a reference. Only keys present in p_data change. */
create or replace function public.look_reference_save(p_project uuid, p_ref uuid, p_data jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; r public.look_references; v_asset uuid; v_thumb uuid; v_url text; v_ent uuid; v_crop jsonb; v_id uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'edit Look & Feel references');
  if p_data is null or jsonb_typeof(p_data) <> 'object' or length(p_data::text) > 20000 then raise exception 'Unexpected reference.' using errcode = '22023'; end if;
  if p_ref is not null then
    select * into r from public.look_references where id = p_ref and project_id = p_project and archived_at is null for update;
    if r.id is null then raise exception 'Reference not found.' using errcode = 'PT404'; end if;
  end if;
  v_asset := case when p_data ? 'asset_id' then nullif(p_data ->> 'asset_id', '')::uuid else r.asset_id end;
  v_thumb := case when p_data ? 'thumb_asset_id' then nullif(p_data ->> 'thumb_asset_id', '')::uuid else r.thumb_asset_id end;
  v_url := case when p_data ? 'source_url' then nullif(btrim(p_data ->> 'source_url'), '') else r.source_url end;
  v_ent := case when p_data ? 'source_entity_id' then nullif(p_data ->> 'source_entity_id', '')::uuid else r.source_entity_id end;
  v_crop := case when p_data ? 'crop' then public.look_check_crop(p_data -> 'crop') else r.crop end;
  if v_url is not null and (v_url !~ '^https://' or length(v_url) > 2000) then raise exception 'Links start with https://' using errcode = '22023'; end if;
  if v_asset is not null and v_asset is distinct from r.asset_id
     and not exists (select 1 from public.assets a where a.id = v_asset and a.project_id = p_project and a.upload_status = 'ready' and a.deleted_at is null and a.kind = 'image') then
    raise exception 'That picture isn''t in this film.' using errcode = '22023';
  end if;
  if v_thumb is not null and v_thumb is distinct from r.thumb_asset_id
     and not exists (select 1 from public.assets a where a.id = v_thumb and a.project_id = p_project and a.upload_status = 'ready' and a.deleted_at is null) then
    raise exception 'That picture isn''t in this film.' using errcode = '22023';
  end if;
  if v_ent is not null and v_ent is distinct from r.source_entity_id
     and not exists (select 1 from public.entities e where e.id = v_ent and e.project_id = p_project) then
    raise exception 'That character or place isn''t in this film.' using errcode = '22023';
  end if;
  if p_ref is null and v_asset is null and v_crop is null and v_url is null then
    raise exception 'Add an image, a part of your treatment, or a link.' using errcode = '22023';
  end if;
  if p_data ? 'tags' and (jsonb_typeof(p_data -> 'tags') <> 'array' or exists (
       select 1 from jsonb_array_elements_text(p_data -> 'tags') t where t not in ('colors', 'lighting', 'atmosphere', 'contrast', 'texture', 'drawing', 'composition', 'overall', 'other'))) then
    raise exception 'Unknown tag.' using errcode = '22023';
  end if;
  if p_data ? 'status' and p_data ->> 'status' not in ('proposed', 'approved') then raise exception 'Unknown status.' using errcode = '22023'; end if;
  -- A browsing thumbnail isn't offered as a picture of its own elsewhere.
  if v_thumb is not null and v_thumb is distinct from v_asset then
    update public.assets set metadata = coalesce(metadata, '{}'::jsonb) || '{"look_thumbnail": true}'::jsonb where id = v_thumb and project_id = p_project;
  end if;

  if p_ref is null then
    insert into public.look_references (project_id, asset_id, thumb_asset_id, crop, source_url, source_entity_id, title, tags, reason, use_for, leave_out,
                                        applies, status, palette, attribution, permission, position, created_by)
    values (p_project, v_asset, v_thumb, v_crop, v_url, v_ent,
            coalesce(nullif(left(btrim(p_data ->> 'title'), 120), ''), 'Reference'),
            coalesce((select array_agg(distinct t) from jsonb_array_elements_text(p_data -> 'tags') t), '{}'),
            left(coalesce(p_data ->> 'reason', ''), 1000), left(coalesce(p_data ->> 'use_for', ''), 600), left(coalesce(p_data ->> 'leave_out', ''), 600),
            public.look_check_applies(p_project, p_data -> 'applies'), coalesce(p_data ->> 'status', 'proposed'),
            public.look_check_palette(p_data -> 'palette'),
            left(coalesce(p_data ->> 'attribution', ''), 300), left(coalesce(p_data ->> 'permission', ''), 300),
            (select coalesce(max(position), 0) + 1000 from public.look_references where project_id = p_project), v_uid)
    returning id into v_id;
    perform public.studio_audit(p_project, v_uid, 'user', 'look.reference_added', 'look_reference', v_id, '{}'::jsonb);
    return v_id;
  end if;
  update public.look_references set
    asset_id = v_asset, thumb_asset_id = v_thumb, crop = v_crop, source_url = v_url, source_entity_id = v_ent,
    title = case when p_data ? 'title' then coalesce(nullif(left(btrim(p_data ->> 'title'), 120), ''), title) else title end,
    tags = case when p_data ? 'tags' then coalesce((select array_agg(distinct t) from jsonb_array_elements_text(p_data -> 'tags') t), '{}') else tags end,
    reason = case when p_data ? 'reason' then left(coalesce(p_data ->> 'reason', ''), 1000) else reason end,
    use_for = case when p_data ? 'use_for' then left(coalesce(p_data ->> 'use_for', ''), 600) else use_for end,
    leave_out = case when p_data ? 'leave_out' then left(coalesce(p_data ->> 'leave_out', ''), 600) else leave_out end,
    applies = case when p_data ? 'applies' then public.look_check_applies(p_project, p_data -> 'applies') else applies end,
    status = coalesce(p_data ->> 'status', status),
    palette = case when p_data ? 'palette' then public.look_check_palette(p_data -> 'palette') else palette end,
    attribution = case when p_data ? 'attribution' then left(coalesce(p_data ->> 'attribution', ''), 300) else attribution end,
    permission = case when p_data ? 'permission' then left(coalesce(p_data ->> 'permission', ''), 300) else permission end,
    updated_at = now()
  where id = p_ref;
  return p_ref;
end $$;

create or replace function public.look_reference_move(p_ref uuid, p_position double precision)
returns void
language plpgsql security definer set search_path = '' as $$
declare r public.look_references; v_uid uuid;
begin
  select * into r from public.look_references where id = p_ref;
  v_uid := public.studio_require(r.project_id, 3, 'reorder references');
  if p_position is null or p_position <> p_position then raise exception 'Unexpected position.' using errcode = '22023'; end if;
  update public.look_references set position = p_position where id = p_ref;
end $$;

-- ---- Direction RPCs ---------------------------------------------------------------------
create or replace function public.look_direction_snapshot(p_dir uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('name', d.name, 'intention', d.intention, 'notes', d.notes, 'palette', d.palette, 'scope', d.scope,
           'status', d.status, 'is_default', d.is_default,
           'references', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'asset_id', r.asset_id, 'thumb_asset_id', r.thumb_asset_id,
               'crop', r.crop, 'source_url', r.source_url, 'tags', to_jsonb(r.tags), 'reason', r.reason, 'use_for', r.use_for, 'leave_out', r.leave_out,
               'applies', r.applies, 'status', r.status, 'attribution', r.attribution, 'permission', r.permission) order by dr.position)
             from public.look_direction_refs dr join public.look_references r on r.id = dr.reference_id where dr.direction_id = d.id), '[]'::jsonb))
    from public.look_directions d where d.id = p_dir;
$$;

/** Approved storyboard frames that follow a direction (explicitly, through their storyboard,
 *  or through the film default) get a review note. Nothing is redrawn. */
create or replace function public.look_flag_frames(p_dir uuid, p_reason text)
returns int
language plpgsql security definer set search_path = '' as $$
declare d public.look_directions; n int;
begin
  select * into d from public.look_directions where id = p_dir;
  update public.storyboard_shots sh
     set review = jsonb_build_object('reason', p_reason, 'at', now())
    from public.storyboard_sequences sq
   where sq.id = sh.sequence_id and sh.project_id = d.project_id and sh.archived_at is null and sh.state = 'approved' and sh.review is null
     and ((sh.look ->> 'mode' = 'direction' and sh.look ->> 'direction_id' = p_dir::text)
       or (coalesce(sh.look ->> 'mode', 'default') = 'default' and (sq.look_direction_id = p_dir or (sq.look_direction_id is null and d.is_default))));
  get diagnostics n = row_count;
  return n;
end $$;

/** Create or edit a direction. Content changes make a new version (kept) and flag affected
 *  approved frames for review. p_data.reference_ids (ordered) replaces its references. */
create or replace function public.look_direction_save(p_project uuid, p_dir uuid, p_data jsonb, p_expected_version int)
returns table (direction_id uuid, version int, flagged int)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare v_uid uuid; d public.look_directions; v_id uuid; v_before jsonb; v_after jsonb; v_flag int := 0; v_status text;
begin
  v_uid := public.studio_require(p_project, 3, 'edit visual directions');
  if p_data is null or jsonb_typeof(p_data) <> 'object' or length(p_data::text) > 30000 then raise exception 'Unexpected direction.' using errcode = '22023'; end if;
  v_status := p_data ->> 'status';
  if v_status is not null and v_status not in ('draft', 'approved', 'archived') then raise exception 'Unknown status.' using errcode = '22023'; end if;
  if p_data ? 'reference_ids' and (jsonb_typeof(p_data -> 'reference_ids') <> 'array' or jsonb_array_length(p_data -> 'reference_ids') > 60
       or exists (select 1 from jsonb_array_elements_text(p_data -> 'reference_ids') x
                   where not exists (select 1 from public.look_references r where r.id::text = x and r.project_id = p_project and r.archived_at is null))) then
    raise exception 'Choose references from this film''s Look & Feel.' using errcode = '22023';
  end if;
  if p_dir is null then
    if length(btrim(coalesce(p_data ->> 'name', ''))) not between 1 and 80 then raise exception 'Name the direction (up to 80 characters).' using errcode = '22023'; end if;
    if (select count(*) from public.look_directions where project_id = p_project) >= 40 then raise exception 'Up to 40 directions.' using errcode = '22023'; end if;
    insert into public.look_directions (project_id, name, intention, notes, palette, scope, status, position, created_by)
    values (p_project, btrim(p_data ->> 'name'), left(coalesce(p_data ->> 'intention', ''), 600), left(coalesce(p_data ->> 'notes', ''), 2000),
            public.look_check_palette(p_data -> 'palette'), public.look_check_applies(p_project, p_data -> 'scope'), coalesce(v_status, 'draft'),
            (select coalesce(max(position), 0) + 1000 from public.look_directions where project_id = p_project), v_uid)
    returning id into v_id;
    if p_data ? 'reference_ids' then
      insert into public.look_direction_refs (direction_id, reference_id, project_id, position)
      select v_id, x::uuid, p_project, (row_number() over ())::int from jsonb_array_elements_text(p_data -> 'reference_ids') x on conflict do nothing;
    end if;
    insert into public.look_direction_versions (direction_id, project_id, version, snapshot, created_by)
    values (v_id, p_project, 1, public.look_direction_snapshot(v_id), v_uid);
    perform public.studio_audit(p_project, v_uid, 'user', 'look.direction_created', 'look_direction', v_id, '{}'::jsonb);
    return query select v_id, 1, 0;
    return;
  end if;

  select * into d from public.look_directions where id = p_dir and project_id = p_project for update;
  if d.id is null then raise exception 'Direction not found.' using errcode = 'PT404'; end if;
  if p_expected_version is not null and p_expected_version <> d.version then
    raise exception 'This direction changed somewhere else. Reload to see the latest.' using errcode = 'PT409';
  end if;
  v_before := public.look_direction_snapshot(p_dir);
  update public.look_directions set
    name = case when p_data ? 'name' then coalesce(nullif(left(btrim(p_data ->> 'name'), 80), ''), name) else name end,
    intention = case when p_data ? 'intention' then left(coalesce(p_data ->> 'intention', ''), 600) else intention end,
    notes = case when p_data ? 'notes' then left(coalesce(p_data ->> 'notes', ''), 2000) else notes end,
    palette = case when p_data ? 'palette' then public.look_check_palette(p_data -> 'palette') else palette end,
    scope = case when p_data ? 'scope' then public.look_check_applies(p_project, p_data -> 'scope') else scope end,
    status = coalesce(v_status, status),
    is_default = case when coalesce(v_status, status) = 'approved' then is_default else false end
  where id = p_dir;
  if p_data ? 'reference_ids' then
    delete from public.look_direction_refs where look_direction_refs.direction_id = p_dir;
    insert into public.look_direction_refs (direction_id, reference_id, project_id, position)
    select p_dir, x::uuid, p_project, (row_number() over ())::int from jsonb_array_elements_text(p_data -> 'reference_ids') x on conflict do nothing;
  end if;
  v_after := public.look_direction_snapshot(p_dir);
  if v_after is not distinct from v_before then
    return query select p_dir, d.version, 0;
    return;
  end if;
  update public.look_directions set version = d.version + 1, updated_at = now() where id = p_dir;
  insert into public.look_direction_versions (direction_id, project_id, version, snapshot, created_by)
  values (p_dir, p_project, d.version + 1, v_after, v_uid);
  v_flag := public.look_flag_frames(p_dir, format('The Look & Feel direction “%s” changed (version %s → %s). Check that this approved frame still fits.',
                                                 v_after ->> 'name', d.version, d.version + 1));
  return query select p_dir, d.version + 1, v_flag;
end $$;

/** Make an approved direction the film's default (p_dir null clears it). */
create or replace function public.look_direction_set_default(p_project uuid, p_dir uuid)
returns int
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; d public.look_directions; v_old uuid; n int := 0;
begin
  v_uid := public.studio_require(p_project, 3, 'choose the film''s look');
  select id into v_old from public.look_directions where project_id = p_project and is_default;
  if p_dir is not null then
    select * into d from public.look_directions where id = p_dir and project_id = p_project;
    if d.id is null then raise exception 'Direction not found.' using errcode = 'PT404'; end if;
    if d.status <> 'approved' then raise exception 'Approve this direction before making it the film''s default.' using errcode = '22023'; end if;
  end if;
  if v_old is not distinct from p_dir then return 0; end if;
  update public.look_directions set is_default = false where project_id = p_project and is_default;
  if p_dir is not null then update public.look_directions set is_default = true where id = p_dir; end if;
  -- Frames following the film default now follow a different direction.
  if v_old is not null then n := n + public.look_flag_frames(v_old, 'The film''s default Look & Feel direction changed. Check that this approved frame still fits.'); end if;
  if p_dir is not null then n := n + public.look_flag_frames(p_dir, 'The film''s default Look & Feel direction changed. Check that this approved frame still fits.'); end if;
  perform public.studio_audit(p_project, v_uid, 'user', 'look.default_set', 'look_direction', p_dir, jsonb_build_object('previous', v_old));
  return n;
end $$;

create or replace function public.look_direction_move(p_dir uuid, p_position double precision)
returns void
language plpgsql security definer set search_path = '' as $$
declare d public.look_directions; v_uid uuid;
begin
  select * into d from public.look_directions where id = p_dir;
  v_uid := public.studio_require(d.project_id, 3, 'reorder directions');
  if p_position is null or p_position <> p_position then raise exception 'Unexpected position.' using errcode = '22023'; end if;
  update public.look_directions set position = p_position where id = p_dir;
end $$;

/** Remove a reference from the collection. Shared images stay where else they're used. */
create or replace function public.look_reference_remove(p_ref uuid)
returns int
language plpgsql security definer set search_path = '' as $$
declare r public.look_references; v_uid uuid; v_dir uuid; n int := 0;
begin
  select * into r from public.look_references where id = p_ref;
  v_uid := public.studio_require(r.project_id, 3, 'remove references');
  for v_dir in select dr.direction_id from public.look_direction_refs dr where dr.reference_id = p_ref loop
    perform public.look_direction_save(r.project_id, v_dir,
      jsonb_build_object('reference_ids', coalesce((select jsonb_agg(x.reference_id order by x.position) from public.look_direction_refs x
                                                    where x.direction_id = v_dir and x.reference_id <> p_ref), '[]'::jsonb)), null);
    n := n + 1;
  end loop;
  update public.look_references set archived_at = now(), updated_at = now() where id = p_ref;
  perform public.studio_audit(r.project_id, v_uid, 'user', 'look.reference_removed', 'look_reference', p_ref, jsonb_build_object('directions', n));
  return n;
end $$;

-- ---- Storyboard assignments -------------------------------------------------------------
create or replace function public.storyboard_sequence_look(p_sequence uuid, p_direction uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare s public.storyboard_sequences; v_uid uuid;
begin
  select * into s from public.storyboard_sequences where id = p_sequence;
  v_uid := public.studio_require(s.project_id, 3, 'choose the storyboard''s look');
  if p_direction is not null and not exists (select 1 from public.look_directions d where d.id = p_direction and d.project_id = s.project_id and d.status <> 'archived') then
    raise exception 'Choose a direction from this film.' using errcode = '22023';
  end if;
  update public.storyboard_sequences set look_direction_id = p_direction, updated_at = now() where id = p_sequence;
end $$;

/** A frame's Look & Feel: follow the default, a chosen direction, or chosen references.
 *  Records the direction version it was set against. */
create or replace function public.storyboard_shot_look(p_shot uuid, p_look jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare sh public.storyboard_shots; v_uid uuid; v_mode text; v_dir uuid; v_ver int; v_refs jsonb;
begin
  select * into sh from public.storyboard_shots where id = p_shot;
  v_uid := public.studio_require(sh.project_id, 3, 'choose a frame''s look');
  if sh.locked then raise exception 'This frame is locked. Unlock it to change it.' using errcode = '22023'; end if;
  if p_look is null then update public.storyboard_shots set look = null, updated_at = now() where id = p_shot; return; end if;
  v_mode := coalesce(p_look ->> 'mode', 'default');
  if v_mode not in ('default', 'direction', 'references') then raise exception 'Unknown choice.' using errcode = '22023'; end if;
  v_dir := nullif(p_look ->> 'direction_id', '')::uuid;
  if v_dir is not null then
    select version into v_ver from public.look_directions where id = v_dir and project_id = sh.project_id and status <> 'archived';
    if v_ver is null then raise exception 'Choose a direction from this film.' using errcode = '22023'; end if;
  elsif v_mode = 'direction' then raise exception 'Choose a direction.' using errcode = '22023';
  end if;
  v_refs := coalesce(p_look -> 'reference_ids', '[]'::jsonb);
  if jsonb_typeof(v_refs) <> 'array' or jsonb_array_length(v_refs) > 30 or exists (select 1 from jsonb_array_elements_text(v_refs) x
       where not exists (select 1 from public.look_references r where r.id::text = x and r.project_id = sh.project_id and r.archived_at is null)) then
    raise exception 'Choose references from this film''s Look & Feel.' using errcode = '22023';
  end if;
  if v_mode = 'references' and jsonb_array_length(v_refs) = 0 then raise exception 'Choose at least one reference.' using errcode = '22023'; end if;
  update public.storyboard_shots
     set look = jsonb_strip_nulls(jsonb_build_object('mode', v_mode, 'direction_id', v_dir, 'version', v_ver,
                  'reference_ids', case when v_mode = 'references' then v_refs end)), updated_at = now()
   where id = p_shot;
end $$;

-- ---- For a future renderer --------------------------------------------------------------
/** One direction's reference bundle (a given version, or the current one): its references,
 *  their roles and her notes, permissions, and asset IDs — not the whole library. */
create or replace function public.look_bundle(p_dir uuid, p_version int default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare d public.look_directions; v_uid uuid; v_snap jsonb; v_ver int;
begin
  select * into d from public.look_directions where id = p_dir;
  if d.id is null then raise exception 'Direction not found.' using errcode = 'PT404'; end if;
  if coalesce(public.studio_level(d.project_id), 0) < 2 then raise exception 'You don''t have access to this film.' using errcode = '42501'; end if;
  v_ver := coalesce(p_version, d.version);
  select snapshot into v_snap from public.look_direction_versions where direction_id = p_dir and version = v_ver;
  if v_snap is null then raise exception 'That version isn''t available.' using errcode = 'PT404'; end if;
  return jsonb_build_object('kind', 'studio.look_bundle', 'format', 1, 'project_id', d.project_id, 'direction_id', d.id, 'version', v_ver,
    'current_version', d.version, 'role', 'look_and_feel',
    'note', 'Visual references with the director''s own notes. Not a trained model or calibrated style profile. Use each image only for its "use_for" qualities; ignore its "leave_out" elements.',
    'direction', v_snap - 'references',
    'references', (select coalesce(jsonb_agg(x || jsonb_build_object('role', 'look_and_feel',
        'access', case when x ->> 'asset_id' is not null then 'image' when x -> 'crop' is not null and x -> 'crop' <> 'null'::jsonb then 'treatment_crop'
                       when x ->> 'source_url' is not null then 'link_only' else 'missing' end)), '[]'::jsonb)
      from jsonb_array_elements(v_snap -> 'references') x));
end $$;

-- ---- Grants -----------------------------------------------------------------------------
do $$ declare f text;
begin
  foreach f in array array[
    'look_owner_entity(uuid)', 'look_find_asset(uuid, text)', 'look_reference_save(uuid, uuid, jsonb)', 'look_reference_move(uuid, double precision)',
    'look_reference_remove(uuid)', 'look_direction_save(uuid, uuid, jsonb, int)', 'look_direction_set_default(uuid, uuid)',
    'look_direction_move(uuid, double precision)', 'storyboard_sequence_look(uuid, uuid)', 'storyboard_shot_look(uuid, jsonb)',
    'look_bundle(uuid, int)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['look_check_applies(uuid, jsonb)', 'look_check_palette(jsonb)', 'look_check_crop(jsonb)',
                           'look_direction_snapshot(uuid)', 'look_flag_frames(uuid, text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

commit;
