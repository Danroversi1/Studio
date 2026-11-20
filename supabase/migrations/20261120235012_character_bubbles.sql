-- STUDIO — Characters' daily media bubbles (a revision of World + the world simulation).
--
-- Each protagonist, antagonist and supporting character has a bubble: what they pay attention
-- to, what they avoid, and how much they take in a day. A daily refresh (server-scheduled,
-- shared per source) selects, by code, what's AVAILABLE to each of them that day and keeps a
-- dated snapshot. Availability is not exposure: nothing here commits knowledge, changes
-- feelings, advances time, creates events or drafts dialogue. Exposures are only ever
-- proposed through the World & Time event review, and only approval makes them story.
begin;

create table if not exists public.bubble_settings (
  project_id uuid primary key references public.projects(id) on delete cascade,
  paused boolean not null default false,
  timezone text not null default 'America/New_York' check (length(timezone) between 3 and 64),
  preferred_time text not null default '04:17' check (preferred_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  version integer not null default 1,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.character_bubbles (
  character_id uuid primary key references public.entities(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  topics text[] not null default '{}' check (cardinality(topics) <= 12),
  avoid text[] not null default '{}' check (cardinality(avoid) <= 12),
  attention integer not null default 5 check (attention between 1 and 15),
  active boolean not null default true,
  inactive_reason text check (inactive_reason is null or inactive_reason in ('role', 'director')),
  version integer not null default 1,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.bubble_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  run_date date not null,                 -- the project's local date (its timezone)
  trigger text not null check (trigger in ('manual', 'scheduled')),
  status text not null default 'running' check (status in ('running', 'succeeded', 'partial', 'failed', 'skipped')),
  sources jsonb not null default '{}'::jsonb,   -- {source_id: {ok, added, error, stale}}
  selected integer not null default 0,
  note text check (note is null or length(note) <= 500),
  error text check (error is null or length(error) <= 500),
  created_by uuid references auth.users(id),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index if not exists bubble_runs_one_running_idx on public.bubble_runs (project_id) where status = 'running';
create index if not exists bubble_runs_project_idx on public.bubble_runs (project_id, started_at desc);

create table if not exists public.bubble_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  character_id uuid not null references public.entities(id) on delete cascade,
  run_date date not null,
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 40),
  summary text not null default '' check (length(summary) <= 1500),
  profile jsonb not null default '{}'::jsonb,   -- the topics/avoid/attention used
  version integer not null default 1,
  last_run_id uuid references public.bubble_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (character_id, run_date)
);
create index if not exists bubble_snapshots_char_idx on public.bubble_snapshots (character_id, run_date desc);

do $$ declare t text;
begin
  foreach t in array array['bubble_settings', 'character_bubbles', 'bubble_runs', 'bubble_snapshots'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.studio_level(project_id) >= 2)', t || '_read', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

create or replace function public.bubble_tracked(p_character uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select metadata ->> 'cast_role' in ('protagonist', 'antagonist', 'supporting') from public.entities where id = p_character and kind = 'character'), false)
$$;

create or replace function public.bubble_settings_save(p_project uuid, p_data jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'change the daily refresh');
  if p_data ? 'timezone' and not exists (select 1 from pg_catalog.pg_timezone_names where name = p_data ->> 'timezone') then
    raise exception 'Unknown timezone.' using errcode = '22023';
  end if;
  insert into public.bubble_settings (project_id, updated_by) values (p_project, v_uid) on conflict (project_id) do nothing;
  update public.bubble_settings set
    paused = coalesce((p_data ->> 'paused')::boolean, paused),
    timezone = coalesce(p_data ->> 'timezone', timezone),
    preferred_time = coalesce(p_data ->> 'preferred_time', preferred_time),
    version = version + 1, updated_by = v_uid, updated_at = now()
  where project_id = p_project;
end $$;

create or replace function public.bubble_profile_save(p_project uuid, p_character uuid, p_topics text[], p_avoid text[], p_attention integer)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_topics text[]; v_avoid text[];
begin
  v_uid := public.studio_require(p_project, 3, 'develop a character');
  perform public.character_check(p_project, p_character);
  if not public.bubble_tracked(p_character) then
    raise exception 'Media bubbles are for protagonists, antagonists and supporting characters.' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct left(btrim(t), 60)) filter (where length(btrim(t)) >= 2), '{}') into v_topics from unnest(coalesce(p_topics, '{}')) t;
  select coalesce(array_agg(distinct left(btrim(t), 60)) filter (where length(btrim(t)) >= 2), '{}') into v_avoid from unnest(coalesce(p_avoid, '{}')) t;
  if cardinality(v_topics) > 12 or cardinality(v_avoid) > 12 then raise exception 'Up to 12 of each.' using errcode = '22023'; end if;
  insert into public.character_bubbles (character_id, project_id, topics, avoid, attention, updated_by)
  values (p_character, p_project, v_topics, v_avoid, greatest(1, least(15, coalesce(p_attention, 5))), v_uid)
  on conflict (character_id) do update set topics = excluded.topics, avoid = excluded.avoid, attention = excluded.attention,
    version = public.character_bubbles.version + 1, updated_by = v_uid, updated_at = now();
end $$;

-- Pause or resume one character's bubble. Resuming never back-fills missed days or exposures.
create or replace function public.bubble_set_active(p_project uuid, p_character uuid, p_active boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'develop a character');
  perform public.character_check(p_project, p_character);
  if p_active and not public.bubble_tracked(p_character) then
    raise exception 'Choose protagonist, antagonist or supporting first.' using errcode = '22023';
  end if;
  insert into public.character_bubbles (character_id, project_id, active, inactive_reason, updated_by)
  values (p_character, p_project, p_active, case when p_active then null else 'director' end, v_uid)
  on conflict (character_id) do update set active = p_active, inactive_reason = case when p_active then null else 'director' end,
    version = public.character_bubbles.version + 1, updated_by = v_uid, updated_at = now();
end $$;

-- A character becoming Featured pauses their bubble (history kept); an eligible role offers resumption.
create or replace function public.set_character_role(p_entity uuid, p_role text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; e public.entities;
begin
  select * into e from public.entities where id = p_entity;
  if e.id is null or e.kind <> 'character' then raise exception 'Character not found.' using errcode = 'PT404'; end if;
  v_uid := public.studio_require(e.project_id, 3, 'develop a character');
  if p_role is not null and p_role not in ('protagonist', 'antagonist', 'supporting', 'featured') then
    raise exception 'Choose protagonist, antagonist, supporting or featured.' using errcode = '22023';
  end if;
  update public.entities
     set metadata = case when p_role is null then metadata - 'cast_role' else metadata || jsonb_build_object('cast_role', p_role) end,
         updated_at = now()
   where id = p_entity;
  if p_role is null or p_role = 'featured' then
    update public.character_bubbles set active = false, inactive_reason = 'role', updated_at = now() where character_id = p_entity and active;
  end if;
end $$;

-- Runs: one at a time per film (manual and scheduled share this lock); stale runs expire.
create or replace function public.bubble_run_open(p_project uuid, p_trigger text, p_uid uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare s public.bubble_settings; v_run uuid; v_date date;
begin
  insert into public.bubble_settings (project_id) values (p_project) on conflict (project_id) do nothing;
  select * into s from public.bubble_settings where project_id = p_project for update;
  update public.bubble_runs set status = 'failed', error = 'Stopped responding.', finished_at = now()
   where project_id = p_project and status = 'running' and started_at < now() - interval '10 minutes';
  if exists (select 1 from public.bubble_runs where project_id = p_project and status = 'running') then
    raise exception 'A refresh is already running.' using errcode = 'PT409';
  end if;
  v_date := (now() at time zone s.timezone)::date;
  if p_trigger = 'scheduled' and s.paused then
    insert into public.bubble_runs (project_id, run_date, trigger, status, note, finished_at)
    values (p_project, v_date, 'scheduled', 'skipped', 'Daily refresh is paused.', now()) returning id into v_run;
    return null;
  end if;
  insert into public.bubble_runs (project_id, run_date, trigger, created_by) values (p_project, v_date, p_trigger, p_uid) returning id into v_run;
  return v_run;
end $$;

create or replace function public.bubble_refresh_start(p_project uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'refresh the world');
  return public.bubble_run_open(p_project, 'manual', v_uid);
end $$;

create or replace function public.bubble_refresh_start_scheduled(p_project uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  return public.bubble_run_open(p_project, 'scheduled', null);
end $$;

create or replace function public.bubble_run_finish(p_run uuid, p_status text, p_sources jsonb, p_selected integer, p_note text, p_error text)
returns void
language sql security definer set search_path = '' as $$
  update public.bubble_runs set status = p_status, sources = coalesce(p_sources, '{}'::jsonb), selected = coalesce(p_selected, 0),
         note = left(p_note, 500), error = left(p_error, 500), finished_at = now()
   where id = p_run and status = 'running'
$$;

-- A character's coverage for one local date. Entries are keyed by item and version ("key"), so a
-- corrected report is a new entry marked as an update, beside the earlier one. A second refresh the same day adds to it (never
-- removes or duplicates); earlier dates are untouched history.
create or replace function public.bubble_snapshot_put(p_run uuid, p_character uuid, p_items jsonb, p_summary text, p_profile jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare r public.bubble_runs; cur public.bubble_snapshots; merged jsonb;
begin
  select * into r from public.bubble_runs where id = p_run;
  if r.id is null or r.status <> 'running' then raise exception 'Run not running.' using errcode = 'PT409'; end if;
  if not exists (select 1 from public.entities where id = p_character and project_id = r.project_id and kind = 'character') then
    raise exception 'Character not found.' using errcode = 'PT404';
  end if;
  select * into cur from public.bubble_snapshots where character_id = p_character and run_date = r.run_date for update;
  if cur.id is null then
    insert into public.bubble_snapshots (project_id, character_id, run_date, items, summary, profile, last_run_id)
    values (r.project_id, p_character, r.run_date, coalesce(p_items, '[]'::jsonb), left(coalesce(p_summary, ''), 1500), coalesce(p_profile, '{}'::jsonb), p_run);
    return jsonb_array_length(coalesce(p_items, '[]'::jsonb));
  end if;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into merged from (
    select x from jsonb_array_elements(cur.items) x
    union all
    select y from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) y
     where not exists (select 1 from jsonb_array_elements(cur.items) z where z ->> 'key' = y ->> 'key')
    limit 40) q;
  update public.bubble_snapshots set items = merged, summary = left(coalesce(p_summary, summary), 1500), profile = coalesce(p_profile, profile),
         version = version + 1, last_run_id = p_run, updated_at = now() where id = cur.id;
  return jsonb_array_length(merged) - jsonb_array_length(cur.items);
end $$;

do $$ declare f text;
begin
  foreach f in array array['bubble_settings_save(uuid, jsonb)', 'bubble_profile_save(uuid, uuid, text[], text[], integer)',
    'bubble_set_active(uuid, uuid, boolean)', 'bubble_refresh_start(uuid)', 'set_character_role(uuid, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  foreach f in array array['bubble_tracked(uuid)', 'bubble_run_open(uuid, text, uuid)', 'bubble_refresh_start_scheduled(uuid)',
    'bubble_run_finish(uuid, text, jsonb, integer, text, text)', 'bubble_snapshot_put(uuid, uuid, jsonb, text, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

commit;
