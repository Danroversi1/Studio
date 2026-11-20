-- STUDIO — Daily world simulation with simple emotional rules.
--
-- World updates → proposed events → emotional consequences and possible actions →
-- Director approval → story progression → (optional) dialogue development.
--
-- • Proposals never change canonical state. Approval commits an event and its consequences
--   atomically and exactly once (unique per event and character).
-- • Emotional state has two independent axes, each bounded -100..100: stress↔comfort and
--   sadness↔happiness. Writing controls for fiction, not clinical measures.
-- • Rules and controls are versioned and apply from a recorded fictional day onward.
-- • History (committed events and state changes) is append-only.
-- • Dialogue tied to events can only be requested for approved, current event versions:
--   enforced here, not just in the interface.
begin;

-- ---- Settings and fictional clock -----------------------------------------------------------
create table if not exists public.sim_settings (
  project_id uuid primary key references public.projects(id) on delete cascade,
  max_events integer not null default 3 check (max_events between 0 and 10),
  intensity integer not null default 2 check (intensity between 1 and 3),     -- response intensity: gentle / moderate / strong
  flexibility integer not null default 2 check (flexibility between 1 and 3), -- behavioral flexibility: steady / some / open
  paused boolean not null default false,
  auto_daily boolean not null default false,     -- prepare a new day each morning (server schedule)
  auto_dialogue boolean not null default false,  -- draft dialogue after approval (only for events with a scene)
  start_date date,                               -- fictional date of day 1 (her choice; see advancement policy)
  clock_day integer not null default 0 check (clock_day >= 0), -- last closed fictional day (0 = none yet)
  version integer not null default 1,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
create table if not exists public.sim_settings_versions (
  project_id uuid not null references public.projects(id) on delete cascade,
  version integer not null,
  data jsonb not null,
  effective_day integer not null,
  saved_by uuid references auth.users(id),
  saved_at timestamptz not null default now(),
  primary key (project_id, version)
);

-- ---- Simple rules: When… / They feel… / They tend to… / Relief comes from… -----------------
create table if not exists public.sim_rules (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  family text not null check (family in ('world', 'character', 'story')),
  character_id uuid references public.entities(id) on delete cascade,
  when_text text not null check (length(btrim(when_text)) between 2 and 300),
  stress integer not null default 0 check (stress between -2 and 2),
  happiness integer not null default 0 check (happiness between -2 and 2),
  tend_text text check (tend_text is null or length(tend_text) <= 300),
  relief_text text check (relief_text is null or length(relief_text) <= 300),
  enabled boolean not null default true,
  version integer not null default 1,
  effective_day integer not null default 1,
  archived_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (family <> 'character' or character_id is not null)
);
create index if not exists sim_rules_project_idx on public.sim_rules (project_id) where archived_at is null;
create table if not exists public.sim_rule_versions (
  rule_id uuid not null references public.sim_rules(id) on delete cascade,
  version integer not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  data jsonb not null,
  effective_day integer not null,
  saved_by uuid references auth.users(id),
  saved_at timestamptz not null default now(),
  primary key (rule_id, version)
);

-- ---- Emotional state: a starting state per character + append-only changes ----------------
create table if not exists public.sim_char_states (
  character_id uuid primary key references public.entities(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  start_stress integer not null default 0 check (start_stress between -100 and 100),       -- -100 calm/comfortable … +100 very stressed
  start_happiness integer not null default 0 check (start_happiness between -100 and 100), -- -100 very sad … +100 very happy
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
create table if not exists public.sim_state_changes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  character_id uuid not null references public.entities(id) on delete cascade,
  day integer not null,
  kind text not null check (kind in ('event', 'director')),
  event_id uuid,
  event_version integer,
  d_stress integer not null check (d_stress between -200 and 200),
  d_happiness integer not null check (d_happiness between -200 and 200),
  note text check (note is null or length(note) <= 500),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check ((kind = 'event') = (event_id is not null))
);
-- Exactly once: an event changes each character at most one time, however often it's approved.
create unique index if not exists sim_state_changes_once_idx on public.sim_state_changes (event_id, character_id) where event_id is not null;
create index if not exists sim_state_changes_char_idx on public.sim_state_changes (project_id, character_id);

-- ---- Runs, events and versions ----------------------------------------------------------------
create table if not exists public.sim_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  day integer not null,
  trigger text not null check (trigger in ('manual', 'scheduled')),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'cancelled')),
  settings_version integer not null,
  settings jsonb not null,
  rules jsonb not null default '[]'::jsonb,
  inputs jsonb not null default '{}'::jsonb,
  proposed integer not null default 0,
  note text check (note is null or length(note) <= 1000),
  error text check (error is null or length(error) <= 1000),
  agent_run_id uuid references public.agent_runs(id) on delete set null,
  created_by uuid references auth.users(id),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
-- No overlapping runs per film.
create unique index if not exists sim_runs_one_running_idx on public.sim_runs (project_id) where status = 'running';
create index if not exists sim_runs_project_idx on public.sim_runs (project_id, started_at desc);

create table if not exists public.sim_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  run_id uuid references public.sim_runs(id) on delete set null,
  day integer not null check (day >= 1),
  status text not null default 'proposed' check (status in ('proposed', 'blocked', 'approved', 'rejected', 'deferred')),
  current_version integer not null default 1,
  approved_version integer,
  depends_on jsonb not null default '{}'::jsonb check (jsonb_typeof(depends_on) = 'object'), -- {event_id: version it assumed}
  target_scene_key text check (target_scene_key is null or target_scene_key ~ '^[bh]:[A-Za-z0-9_-]{1,120}:[0-9]{1,3}$'),
  origin text not null default 'simulation' check (origin in ('simulation', 'director')),
  revises_event uuid references public.sim_events(id) on delete set null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id)
);
create index if not exists sim_events_project_idx on public.sim_events (project_id, day, created_at);

create table if not exists public.sim_event_versions (
  event_id uuid not null references public.sim_events(id) on delete cascade,
  version integer not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  -- {title, description, relevance, basis: source|adaptation|fiction, sources:[{item_id, version, title, url, published_at, retrieved_at, source}],
  --  characters:[{character_id, name, d_stress, d_happiness, feel, movement, channel, rule_ids}], rationale}
  data jsonb not null check (jsonb_typeof(data) = 'object' and length(data::text) <= 40000),
  consequences_fresh boolean not null default true,
  author text not null check (author in ('simulation', 'director')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (event_id, version)
);

-- ---- Dialogue linked to approved event versions ---------------------------------------------
alter table public.dialogue_proposals add column if not exists event_refs jsonb not null default '[]'::jsonb;
alter table public.dialogue_proposals drop constraint if exists dialogue_proposals_trigger_check;
alter table public.dialogue_proposals add constraint dialogue_proposals_trigger_check check (trigger in ('on_demand', 'auto', 'revision', 'event'));

-- ---- Access: read for the creative team; all writes through the functions below ------------
do $$ declare t text;
begin
  foreach t in array array['sim_settings', 'sim_settings_versions', 'sim_rules', 'sim_rule_versions', 'sim_char_states', 'sim_state_changes',
                           'sim_runs', 'sim_events', 'sim_event_versions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.studio_level(project_id) >= 2)', t || '_read', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- ---- Helpers ----------------------------------------------------------------------------------
create or replace function public.sim_settings_row(p_project uuid)
returns public.sim_settings
language plpgsql security definer set search_path = '' as $$
declare r public.sim_settings;
begin
  insert into public.sim_settings (project_id) values (p_project) on conflict (project_id) do nothing;
  select * into r from public.sim_settings where project_id = p_project;
  if not exists (select 1 from public.sim_settings_versions where project_id = p_project) then
    insert into public.sim_settings_versions (project_id, version, data, effective_day)
    values (p_project, r.version, to_jsonb(r) - 'project_id' - 'updated_by' - 'updated_at', r.clock_day + 1) on conflict do nothing;
  end if;
  return r;
end $$;

/** A character's current state: starting state + committed changes, bounded. */
create or replace function public.sim_current_state(p_character uuid)
returns table (stress integer, happiness integer)
language sql stable security definer set search_path = '' as $$
  select greatest(-100, least(100, coalesce((select start_stress from public.sim_char_states where character_id = p_character), 0)
           + coalesce((select sum(d_stress) from public.sim_state_changes where character_id = p_character), 0)))::integer,
         greatest(-100, least(100, coalesce((select start_happiness from public.sim_char_states where character_id = p_character), 0)
           + coalesce((select sum(d_happiness) from public.sim_state_changes where character_id = p_character), 0)))::integer
$$;

-- The same, for the creative team of that film only.
create or replace function public.sim_state_of(p_project uuid, p_character uuid)
returns table (stress integer, happiness integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.studio_level(p_project) < 2 or not exists (select 1 from public.entities where id = p_character and project_id = p_project) then
    raise exception 'Character not found.' using errcode = 'PT404';
  end if;
  return query select * from public.sim_current_state(p_character);
end $$;

-- ---- Controls (versioned; apply from the next fictional day) ---------------------------------
create or replace function public.sim_settings_save(p_project uuid, p_data jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; r public.sim_settings; v_start date;
begin
  v_uid := public.studio_require(p_project, 3, 'change the simulation');
  r := public.sim_settings_row(p_project);
  select * into r from public.sim_settings where project_id = p_project for update;
  if p_data ? 'start_date' then
    v_start := nullif(p_data ->> 'start_date', '')::date;
    if r.clock_day > 0 and v_start is distinct from r.start_date then
      raise exception 'Day 1''s date can''t change after days have been committed.' using errcode = '22023';
    end if;
  else v_start := r.start_date; end if;
  update public.sim_settings set
    max_events = coalesce((p_data ->> 'max_events')::integer, max_events),
    intensity = coalesce((p_data ->> 'intensity')::integer, intensity),
    flexibility = coalesce((p_data ->> 'flexibility')::integer, flexibility),
    paused = coalesce((p_data ->> 'paused')::boolean, paused),
    auto_daily = coalesce((p_data ->> 'auto_daily')::boolean, auto_daily),
    auto_dialogue = coalesce((p_data ->> 'auto_dialogue')::boolean, auto_dialogue),
    start_date = v_start,
    version = version + 1, updated_by = v_uid, updated_at = now()
  where project_id = p_project returning * into r;
  insert into public.sim_settings_versions (project_id, version, data, effective_day, saved_by)
  values (p_project, r.version, to_jsonb(r) - 'project_id' - 'updated_by' - 'updated_at', r.clock_day + 1, v_uid);
  return r.version;
end $$;

-- ---- Rules -----------------------------------------------------------------------------------
create or replace function public.sim_rule_save(p_project uuid, p_rule uuid, p_data jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_id uuid := p_rule; v_family text := p_data ->> 'family'; v_char uuid := nullif(p_data ->> 'character_id', '')::uuid;
        v_day integer; r public.sim_rules;
begin
  v_uid := public.studio_require(p_project, 3, 'change the simulation');
  v_day := (public.sim_settings_row(p_project)).clock_day + 1;
  if v_family not in ('world', 'character', 'story') then raise exception 'Choose a kind of rule.' using errcode = '22023'; end if;
  if v_family = 'character' then
    if v_char is null then raise exception 'Choose the character this rule is about.' using errcode = '22023'; end if;
    perform public.character_check(p_project, v_char);
  elsif v_char is not null then perform public.character_check(p_project, v_char);
  end if;
  if length(btrim(coalesce(p_data ->> 'when_text', ''))) < 2 then raise exception 'Say when the rule applies.' using errcode = '22023'; end if;
  if v_id is null then
    insert into public.sim_rules (project_id, family, character_id, when_text, stress, happiness, tend_text, relief_text, enabled, effective_day, created_by)
    values (p_project, v_family, v_char, left(btrim(p_data ->> 'when_text'), 300),
            greatest(-2, least(2, coalesce((p_data ->> 'stress')::integer, 0))), greatest(-2, least(2, coalesce((p_data ->> 'happiness')::integer, 0))),
            nullif(left(btrim(coalesce(p_data ->> 'tend_text', '')), 300), ''), nullif(left(btrim(coalesce(p_data ->> 'relief_text', '')), 300), ''),
            coalesce((p_data ->> 'enabled')::boolean, true), v_day, v_uid)
    returning * into r;
  else
    update public.sim_rules set family = v_family, character_id = v_char, when_text = left(btrim(p_data ->> 'when_text'), 300),
      stress = greatest(-2, least(2, coalesce((p_data ->> 'stress')::integer, 0))), happiness = greatest(-2, least(2, coalesce((p_data ->> 'happiness')::integer, 0))),
      tend_text = nullif(left(btrim(coalesce(p_data ->> 'tend_text', '')), 300), ''), relief_text = nullif(left(btrim(coalesce(p_data ->> 'relief_text', '')), 300), ''),
      enabled = coalesce((p_data ->> 'enabled')::boolean, enabled), version = version + 1, effective_day = v_day, updated_at = now()
    where id = v_id and project_id = p_project and archived_at is null returning * into r;
    if r.id is null then raise exception 'Rule not found.' using errcode = 'PT404'; end if;
  end if;
  insert into public.sim_rule_versions (rule_id, version, project_id, data, effective_day, saved_by)
  values (r.id, r.version, p_project, to_jsonb(r) - 'project_id' - 'created_by' - 'created_at' - 'updated_at', v_day, v_uid);
  return r.id;
end $$;

create or replace function public.sim_rule_remove(p_project uuid, p_rule uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; r public.sim_rules;
begin
  v_uid := public.studio_require(p_project, 3, 'change the simulation');
  update public.sim_rules set archived_at = now(), enabled = false, version = version + 1,
         effective_day = (public.sim_settings_row(p_project)).clock_day + 1, updated_at = now()
   where id = p_rule and project_id = p_project and archived_at is null returning * into r;
  if r.id is null then raise exception 'Rule not found.' using errcode = 'PT404'; end if;
  insert into public.sim_rule_versions (rule_id, version, project_id, data, effective_day, saved_by)
  values (r.id, r.version, p_project, to_jsonb(r) - 'project_id' - 'created_by' - 'created_at' - 'updated_at', r.effective_day, v_uid);
end $$;

-- ---- Emotional state: starting state, or a present-day adjustment once history exists -------
create or replace function public.sim_state_set(p_project uuid, p_character uuid, p_stress integer, p_happiness integer, p_note text)
returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_s integer := greatest(-100, least(100, coalesce(p_stress, 0))); v_h integer := greatest(-100, least(100, coalesce(p_happiness, 0)));
        cur record; v_day integer;
begin
  v_uid := public.studio_require(p_project, 3, 'change the simulation');
  perform public.character_check(p_project, p_character);
  if not exists (select 1 from public.sim_state_changes where character_id = p_character) then
    insert into public.sim_char_states (character_id, project_id, start_stress, start_happiness, updated_by)
    values (p_character, p_project, v_s, v_h, v_uid)
    on conflict (character_id) do update set start_stress = excluded.start_stress, start_happiness = excluded.start_happiness, updated_by = v_uid, updated_at = now();
    return 'start';
  end if;
  -- History exists: never rewrite it. Record a present-day intervention instead.
  select * into cur from public.sim_current_state(p_character);
  if cur.stress = v_s and cur.happiness = v_h then return 'unchanged'; end if;
  v_day := (public.sim_settings_row(p_project)).clock_day;
  insert into public.sim_state_changes (project_id, character_id, day, kind, d_stress, d_happiness, note, created_by)
  values (p_project, p_character, greatest(v_day, 0), 'director', v_s - cur.stress, v_h - cur.happiness, nullif(left(btrim(coalesce(p_note, '')), 500), ''), v_uid);
  return 'adjusted';
end $$;

-- ---- Runs --------------------------------------------------------------------------------------
-- Starts a run for the open fictional day, or explains why there's nothing to do. Serialized per
-- film (settings row lock + one-running index). Manual: the caller; scheduled: service role.
create or replace function public.sim_run_open(p_project uuid, p_trigger text, p_uid uuid)
returns table (run_id uuid, day integer, remaining integer)
language plpgsql security definer set search_path = '' as $$
declare r public.sim_settings; v_day integer; v_used integer; v_run uuid; v_agent uuid; v_rules jsonb;
begin
  perform public.sim_settings_row(p_project);
  select * into r from public.sim_settings where project_id = p_project for update;
  if r.paused then raise exception 'The simulation is paused. Resume it to prepare a new day.' using errcode = 'PT409'; end if;
  if p_trigger = 'scheduled' and not r.auto_daily then raise exception 'Daily runs are off.' using errcode = 'PT409'; end if;
  v_day := r.clock_day + 1;
  -- Stale runs (a crashed request) don't block forever.
  update public.sim_runs set status = 'failed', error = 'Stopped responding.', finished_at = now()
   where project_id = p_project and status = 'running' and started_at < now() - interval '10 minutes';
  if exists (select 1 from public.sim_runs where project_id = p_project and status = 'running') then
    raise exception 'A day is already being prepared.' using errcode = 'PT409';
  end if;
  if exists (select 1 from public.sim_events e where e.project_id = p_project and e.day = v_day and e.status in ('proposed', 'blocked')) then
    raise exception 'Day % has proposals waiting for your review. Decide them, then close the day.', v_day using errcode = 'PT409';
  end if;
  -- The limit counts every event ever proposed for the day: retries and rejections don't refill it.
  select count(*) into v_used from public.sim_events e where e.project_id = p_project and e.day = v_day and e.origin = 'simulation';
  if exists (select 1 from public.sim_runs x where x.project_id = p_project and x.day = v_day and x.status = 'succeeded') then
    raise exception 'Day % was already prepared. Close it to move on.', v_day using errcode = 'PT409';
  end if;
  if public.studio_ai_budget_usd(p_project) - public.studio_ai_spent_month_usd(p_project) < 0.05 then
    raise exception 'The team has used this month''s AI budget. Ask your Executive Producer.' using errcode = 'PT402';
  end if;
  select coalesce(jsonb_agg(to_jsonb(x) - 'project_id' - 'created_by' - 'created_at' - 'updated_at' order by x.created_at), '[]'::jsonb) into v_rules
    from public.sim_rules x where x.project_id = p_project and x.archived_at is null and x.enabled;
  insert into public.agent_runs (project_id, domain, status, task_type, input_payload, model_provider, prompt_version, requested_by, started_at)
  values (p_project, 'writer', 'running', 'simulation', jsonb_build_object('day', v_day, 'trigger', p_trigger), 'anthropic', 'world-sim-v1',
          coalesce(p_uid, (select created_by from public.projects where id = p_project)), now())
  returning id into v_agent;
  insert into public.sim_runs (project_id, day, trigger, settings_version, settings, rules, agent_run_id, created_by)
  values (p_project, v_day, p_trigger, r.version, to_jsonb(r) - 'project_id' - 'updated_by' - 'updated_at', v_rules, v_agent, p_uid)
  returning id into v_run;
  return query select v_run, v_day, greatest(0, r.max_events - v_used);
end $$;

create or replace function public.sim_run_start(p_project uuid)
returns table (run_id uuid, day integer, remaining integer)
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'advance the simulation');
  return query select * from public.sim_run_open(p_project, 'manual', v_uid);
end $$;

create or replace function public.sim_run_start_scheduled(p_project uuid)
returns table (run_id uuid, day integer, remaining integer)
language plpgsql security definer set search_path = '' as $$
begin
  return query select * from public.sim_run_open(p_project, 'scheduled', null);
end $$;

-- Saves the run's proposals (service role). The daily limit is re-checked under the lock, so
-- overlapping or retried runs can never exceed it. Events reference each other by "ref".
create or replace function public.sim_run_complete(p_run uuid, p_events jsonb, p_inputs jsonb, p_note text, p_usage jsonb, p_cost_usd numeric, p_model text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_run public.sim_runs; v_max integer; v_used integer; e jsonb; v_id uuid; v_refs jsonb := '{}'::jsonb; v_deps jsonb; d text; n integer := 0;
        ar public.agent_runs;
begin
  select * into v_run from public.sim_runs where id = p_run for update;
  if v_run.id is null or v_run.status <> 'running' then raise exception 'Run not running.' using errcode = 'PT409'; end if;
  select max_events into v_max from public.sim_settings where project_id = v_run.project_id for update;
  select count(*) into v_used from public.sim_events where project_id = v_run.project_id and day = v_run.day and origin = 'simulation';
  for e in select * from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) loop
    exit when v_used + n >= v_max;
    v_deps := '{}'::jsonb;
    for d in select jsonb_array_elements_text(coalesce(e -> 'depends_on_refs', '[]'::jsonb)) loop
      if v_refs ? d then v_deps := v_deps || jsonb_build_object(v_refs ->> d, 1); end if;
    end loop;
    insert into public.sim_events (project_id, run_id, day, depends_on, created_by)
    values (v_run.project_id, p_run, v_run.day, v_deps, v_run.created_by) returning id into v_id;
    insert into public.sim_event_versions (event_id, version, project_id, data, consequences_fresh, author, created_by)
    values (v_id, 1, v_run.project_id, e -> 'data', true, 'simulation', v_run.created_by);
    if e ? 'ref' then v_refs := v_refs || jsonb_build_object(e ->> 'ref', v_id); end if;
    n := n + 1;
  end loop;
  update public.sim_runs set status = 'succeeded', inputs = coalesce(p_inputs, '{}'::jsonb), proposed = n,
         note = left(p_note, 1000), finished_at = now() where id = p_run;
  select * into ar from public.agent_runs where id = v_run.agent_run_id for update;
  if ar.id is not null then
    perform public.studio_record_ai_charge(ar, p_usage, p_cost_usd);
    update public.agent_runs set status = 'succeeded', completed_at = now(), model_name = left(p_model, 100), token_usage = coalesce(p_usage, '{}'::jsonb),
           output_payload = jsonb_build_object('events', n) where id = ar.id;
  end if;
  return n;
end $$;

create or replace function public.sim_run_fail(p_run uuid, p_error text, p_usage jsonb, p_cost_usd numeric)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_run public.sim_runs;
begin
  select * into v_run from public.sim_runs where id = p_run for update;
  if v_run.id is null or v_run.status <> 'running' then return; end if;
  update public.sim_runs set status = 'failed', error = left(coalesce(p_error, 'Failed.'), 1000), finished_at = now() where id = p_run;
  if v_run.agent_run_id is not null then
    perform public.fail_agent_run(v_run.agent_run_id, left(coalesce(p_error, 'Failed.'), 300), coalesce(p_usage, '{}'::jsonb), coalesce(p_cost_usd, 0));
  end if;
end $$;

create or replace function public.sim_run_cancel(p_project uuid, p_run uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'advance the simulation');
  update public.sim_runs set status = 'cancelled', error = 'Cancelled.', finished_at = now()
   where id = p_run and project_id = p_project and status = 'running';
end $$;

-- ---- Events: edit, reassess, decide ---------------------------------------------------------
create or replace function public.sim_event_edit(p_project uuid, p_event uuid, p_expected_version integer, p_data jsonb, p_confirm boolean)
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; ev public.sim_events; prev jsonb; v_fresh boolean; v_new integer;
begin
  v_uid := public.studio_require(p_project, 3, 'edit the simulation');
  select * into ev from public.sim_events where id = p_event and project_id = p_project for update;
  if ev.id is null then raise exception 'Event not found.' using errcode = 'PT404'; end if;
  if ev.status not in ('proposed', 'blocked', 'deferred') then
    raise exception 'Approved and rejected events are history. Add a new event for today instead.' using errcode = 'PT409';
  end if;
  if ev.current_version <> p_expected_version then raise exception 'This event changed. Reload to see the latest version.' using errcode = 'PT409'; end if;
  if length(btrim(coalesce(p_data ->> 'title', ''))) < 2 then raise exception 'Give the event a short title.' using errcode = '22023'; end if;
  select data into prev from public.sim_event_versions where event_id = p_event and version = ev.current_version;
  -- Her own consequence edits are current; a changed event with untouched consequences needs a fresh preview.
  v_fresh := coalesce(p_confirm, false)
          or (p_data -> 'characters') is distinct from (prev -> 'characters')
          or ((p_data ->> 'title') = (prev ->> 'title') and (p_data ->> 'description') is not distinct from (prev ->> 'description')
              and (p_data ->> 'basis') is not distinct from (prev ->> 'basis'));
  v_new := ev.current_version + 1;
  insert into public.sim_event_versions (event_id, version, project_id, data, consequences_fresh, author, created_by)
  values (p_event, v_new, p_project, p_data, v_fresh, 'director', v_uid);
  update public.sim_events set current_version = v_new where id = p_event;
  return v_new;
end $$;

-- A recomputed preview (service role, after the reassess model call) for exactly the version it was asked about.
create or replace function public.sim_event_reassessed(p_event uuid, p_version integer, p_data jsonb, p_clear_deps boolean)
returns integer
language plpgsql security definer set search_path = '' as $$
declare ev public.sim_events; v_new integer;
begin
  select * into ev from public.sim_events where id = p_event for update;
  if ev.id is null or ev.current_version <> p_version or ev.status not in ('proposed', 'blocked', 'deferred') then
    raise exception 'The event changed while its consequences were being worked out.' using errcode = 'PT409';
  end if;
  v_new := ev.current_version + 1;
  insert into public.sim_event_versions (event_id, version, project_id, data, consequences_fresh, author, created_by)
  values (p_event, v_new, ev.project_id, p_data, true, 'simulation', ev.created_by);
  update public.sim_events set current_version = v_new,
    depends_on = case when p_clear_deps then '{}'::jsonb else depends_on end,
    status = case when ev.status = 'blocked' then 'proposed' else ev.status end
  where id = p_event;
  return v_new;
end $$;

create or replace function public.sim_block_dependents(p_event uuid)
returns void
language sql security definer set search_path = '' as $$
  update public.sim_events set status = 'blocked' where depends_on ? p_event::text and status = 'proposed'
$$;

-- Approve / reject / defer / restore. Approval is the Director's (commit level), atomic and idempotent.
create or replace function public.sim_event_decide(p_project uuid, p_event uuid, p_action text, p_version integer)
returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; ev public.sim_events; ver public.sim_event_versions; c jsonb; cur record; ds integer; dh integer; dep text; v_day integer;
begin
  if p_action = 'approve' then v_uid := public.studio_require(p_project, 4, 'approve story events');
  else v_uid := public.studio_require(p_project, 3, 'decide simulation proposals'); end if;
  select * into ev from public.sim_events where id = p_event and project_id = p_project for update;
  if ev.id is null then raise exception 'Event not found.' using errcode = 'PT404'; end if;
  v_day := (public.sim_settings_row(p_project)).clock_day + 1;

  if p_action = 'approve' then
    if ev.status = 'approved' and ev.approved_version = p_version then return 'already'; end if; -- repeated click: nothing twice
    if ev.status <> 'proposed' then raise exception 'Only proposed events can be approved.' using errcode = 'PT409'; end if;
    if ev.current_version <> p_version then raise exception 'This event changed. Review the latest version before approving.' using errcode = 'PT409'; end if;
    select * into ver from public.sim_event_versions where event_id = p_event and version = p_version;
    if not ver.consequences_fresh then raise exception 'Update how they might feel for this version before approving.' using errcode = 'PT409'; end if;
    for dep in select jsonb_object_keys(ev.depends_on) loop
      if not exists (select 1 from public.sim_events d where d.id = dep::uuid and d.status = 'approved'
                       and d.approved_version = (ev.depends_on ->> dep)::integer) then
        update public.sim_events set status = 'blocked' where id = p_event;
        return 'blocked'; -- kept: it depends on an event that isn't approved as it was; reassess first
      end if;
    end loop;
    for c in select * from jsonb_array_elements(coalesce(ver.data -> 'characters', '[]'::jsonb)) loop
      perform public.character_check(p_project, (c ->> 'character_id')::uuid);
      select * into cur from public.sim_current_state((c ->> 'character_id')::uuid);
      ds := greatest(-100, least(100, cur.stress + coalesce((c ->> 'd_stress')::integer, 0))) - cur.stress;
      dh := greatest(-100, least(100, cur.happiness + coalesce((c ->> 'd_happiness')::integer, 0))) - cur.happiness;
      insert into public.sim_state_changes (project_id, character_id, day, kind, event_id, event_version, d_stress, d_happiness, created_by)
      values (p_project, (c ->> 'character_id')::uuid, ev.day, 'event', p_event, p_version, ds, dh, v_uid)
      on conflict (event_id, character_id) where event_id is not null do nothing;
    end loop;
    update public.sim_events set status = 'approved', approved_version = p_version, decided_at = now(), decided_by = v_uid where id = p_event;
    perform public.studio_audit(p_project, v_uid, 'user', 'sim.event_approved', 'sim_event', p_event, jsonb_build_object('version', p_version));
    return 'approved';
  elsif p_action in ('reject', 'defer') then
    if ev.status not in ('proposed', 'blocked', 'deferred') then raise exception 'That event was already decided.' using errcode = 'PT409'; end if;
    update public.sim_events set status = case p_action when 'reject' then 'rejected' else 'deferred' end, decided_at = now(), decided_by = v_uid where id = p_event;
    perform public.sim_block_dependents(p_event);
    return p_action;
  elsif p_action = 'restore' then
    if ev.status <> 'deferred' then raise exception 'Only deferred events can be brought back.' using errcode = 'PT409'; end if;
    update public.sim_events set status = 'proposed', day = greatest(ev.day, v_day), decided_at = null, decided_by = null where id = p_event;
    return 'restored';
  end if;
  raise exception 'Unknown action.' using errcode = '22023';
end $$;

create or replace function public.sim_event_scene(p_project uuid, p_event uuid, p_scene_key text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'edit the simulation');
  update public.sim_events set target_scene_key = nullif(p_scene_key, '') where id = p_event and project_id = p_project;
  if not found then raise exception 'Event not found.' using errcode = 'PT404'; end if;
end $$;

-- A present-day intervention from the Director (her own event for the open day).
create or replace function public.sim_event_add(p_project uuid, p_data jsonb, p_revises uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_id uuid; v_day integer;
begin
  v_uid := public.studio_require(p_project, 3, 'edit the simulation');
  if length(btrim(coalesce(p_data ->> 'title', ''))) < 2 then raise exception 'Give the event a short title.' using errcode = '22023'; end if;
  if p_revises is not null and not exists (select 1 from public.sim_events where id = p_revises and project_id = p_project) then
    raise exception 'Event not found.' using errcode = 'PT404';
  end if;
  v_day := (public.sim_settings_row(p_project)).clock_day + 1;
  insert into public.sim_events (project_id, day, origin, revises_event, created_by) values (p_project, v_day, 'director', p_revises, v_uid) returning id into v_id;
  insert into public.sim_event_versions (event_id, version, project_id, data, consequences_fresh, author, created_by)
  values (v_id, 1, p_project, p_data, jsonb_array_length(coalesce(p_data -> 'characters', '[]'::jsonb)) > 0, 'director', v_uid);
  return v_id;
end $$;

-- Close the open day: every proposal decided (deferred ones move to the next day). Director only.
create or replace function public.sim_day_close(p_project uuid, p_day integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; r public.sim_settings;
begin
  v_uid := public.studio_require(p_project, 4, 'close a story day');
  perform public.sim_settings_row(p_project);
  select * into r from public.sim_settings where project_id = p_project for update;
  if p_day <> r.clock_day + 1 then raise exception 'That day isn''t open.' using errcode = 'PT409'; end if;
  if exists (select 1 from public.sim_events where project_id = p_project and day = p_day and status in ('proposed', 'blocked')) then
    raise exception 'Decide every proposal for day % first (approve, reject or defer).', p_day using errcode = 'PT409';
  end if;
  update public.sim_events set day = p_day + 1 where project_id = p_project and day = p_day and status = 'deferred';
  update public.sim_settings set clock_day = p_day, updated_at = now() where project_id = p_project;
  perform public.studio_audit(p_project, v_uid, 'user', 'sim.day_closed', 'project', p_project, jsonb_build_object('day', p_day));
  return p_day;
end $$;

-- Before recomputing an event's consequences (a small model call): access, state and budget.
create or replace function public.sim_reassess_check(p_project uuid, p_event uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; ev public.sim_events;
begin
  v_uid := public.studio_require(p_project, 3, 'edit the simulation');
  select * into ev from public.sim_events where id = p_event and project_id = p_project;
  if ev.id is null then raise exception 'Event not found.' using errcode = 'PT404'; end if;
  if ev.status not in ('proposed', 'blocked', 'deferred') then raise exception 'Only open proposals can be reassessed.' using errcode = 'PT409'; end if;
  if public.studio_ai_budget_usd(p_project) - public.studio_ai_spent_month_usd(p_project) < 0.02 then
    raise exception 'The team has used this month''s AI budget. Ask your Executive Producer.' using errcode = 'PT402';
  end if;
  return ev.current_version;
end $$;

-- Records the cost of a small simulation model call (service role).
create or replace function public.sim_charge(p_project uuid, p_uid uuid, p_task text, p_usage jsonb, p_cost_usd numeric, p_model text, p_ok boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare ar public.agent_runs;
begin
  insert into public.agent_runs (project_id, domain, status, task_type, input_payload, model_provider, prompt_version, requested_by, started_at, completed_at, model_name, token_usage)
  values (p_project, 'writer', case when p_ok then 'succeeded' else 'failed' end, left(p_task, 60), '{}'::jsonb, 'anthropic', 'world-sim-v1',
          coalesce(p_uid, (select created_by from public.projects where id = p_project)), now(), now(), left(p_model, 100), coalesce(p_usage, '{}'::jsonb))
  returning * into ar;
  perform public.studio_record_ai_charge(ar, p_usage, p_cost_usd);
end $$;

-- ---- Dialogue gate: event-linked drafts need approved, current event versions ---------------
create or replace function public.sim_events_approved(p_project uuid, p_refs jsonb)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  if jsonb_typeof(coalesce(p_refs, '[]'::jsonb)) <> 'array' then return false; end if;
  for r in select * from jsonb_array_elements(coalesce(p_refs, '[]'::jsonb)) loop
    if not exists (select 1 from public.sim_events e where e.id = (r ->> 'id')::uuid and e.project_id = p_project and e.status = 'approved'
                     and e.approved_version = (r ->> 'version')::integer and e.current_version = (r ->> 'version')::integer) then
      return false;
    end if;
  end loop;
  return true;
end $$;

create or replace function public.dialogue_request(p_project uuid, p_scene_key text, p_data jsonb)
returns table (proposal_id uuid, existing boolean)
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_trigger text; v_hash text; v_id uuid; v_beat uuid; v_parent uuid; v_run uuid; v_live integer; v_events jsonb;
begin
  v_uid := public.studio_require(p_project, 3, 'develop dialogue');
  if p_scene_key !~ '^[bh]:[A-Za-z0-9_-]{1,120}:[0-9]{1,3}$' then raise exception 'Unknown scene.' using errcode = '22023'; end if;
  v_trigger := coalesce(p_data ->> 'trigger', 'on_demand');
  if v_trigger not in ('on_demand', 'auto', 'revision', 'event') then raise exception 'Unknown trigger.' using errcode = '22023'; end if;
  v_hash := p_data ->> 'request_hash';
  if v_hash is null or v_hash !~ '^[0-9a-f]{64}$' then raise exception 'Missing request fingerprint.' using errcode = '22023'; end if;
  if length(coalesce(p_data -> 'request', '{}'::jsonb)::text) > 200000 then raise exception 'That scene is too large for one draft.' using errcode = '22023'; end if;
  if v_trigger = 'auto' and not exists (select 1 from public.dialogue_settings where project_id = p_project and auto_draft and not paused) then
    raise exception 'Auto-draft is off.' using errcode = '22023';
  end if;
  -- The approval gate: drafts built on simulation events need every event approved, as approved.
  v_events := coalesce(p_data -> 'events', '[]'::jsonb);
  if jsonb_typeof(v_events) <> 'array' or jsonb_array_length(v_events) > 10 then raise exception 'Too many events for one scene.' using errcode = '22023'; end if;
  if jsonb_array_length(v_events) > 0 and not public.sim_events_approved(p_project, v_events) then
    raise exception 'Dialogue can only be developed from approved events (as approved). Approve them first.' using errcode = 'PT409';
  end if;
  if v_trigger = 'event' then
    if jsonb_array_length(v_events) = 0 then raise exception 'No approved events given.' using errcode = '22023'; end if;
    if not exists (select 1 from public.sim_settings where project_id = p_project and auto_dialogue) then
      raise exception 'Drafting after approval is off.' using errcode = '22023';
    end if;
  end if;
  v_beat := nullif(p_data ->> 'beat_id', '')::uuid;
  if v_beat is not null and not exists (select 1 from public.story_notebook where id = v_beat and project_id = p_project) then
    raise exception 'That outline beat isn''t in this film.' using errcode = '22023';
  end if;
  v_parent := nullif(p_data ->> 'parent_id', '')::uuid;
  if v_parent is not null and not exists (select 1 from public.dialogue_proposals where id = v_parent and project_id = p_project and scene_key = p_scene_key) then
    raise exception 'That draft isn''t from this scene.' using errcode = '22023';
  end if;

  select id into v_id from public.dialogue_proposals
   where project_id = p_project and request_hash = v_hash and status in ('queued', 'drafting', 'ready', 'accepted') limit 1;
  if v_id is not null then return query select v_id, true; return; end if;

  -- Bounded work: at most 3 waiting/drafting per film.
  select count(*) into v_live from public.dialogue_proposals where project_id = p_project and status in ('queued', 'drafting');
  if v_live >= 3 then raise exception 'Three drafts are already in progress. Wait for one to finish.' using errcode = 'PT409'; end if;
  if v_trigger in ('auto', 'event') then
    update public.dialogue_proposals set status = 'cancelled', finished_at = now()
     where project_id = p_project and scene_key = p_scene_key and trigger = v_trigger and status = 'queued';
  end if;
  if public.studio_ai_budget_usd(p_project) - public.studio_ai_spent_month_usd(p_project) < 0.10 then
    raise exception 'The team has used this month''s AI budget. Ask your Executive Producer.' using errcode = 'PT402';
  end if;

  insert into public.agent_runs (project_id, domain, status, task_type, input_payload, model_provider, prompt_version, requested_by)
  values (p_project, 'writer', 'queued', 'dialogue', jsonb_build_object('scene_key', p_scene_key, 'trigger', v_trigger),
          'anthropic', coalesce(left(p_data ->> 'workflow_version', 60), 'scene-dialogue-v1'), v_uid)
  returning id into v_run;
  insert into public.dialogue_proposals (project_id, scene_key, beat_id, parent_id, trigger, request_hash, request, director_note, agent_run_id, created_by, event_refs)
  values (p_project, p_scene_key, v_beat, v_parent, v_trigger, v_hash, coalesce(p_data -> 'request', '{}'::jsonb),
          public.kb_txt(p_data, 'director_note', 2000), v_run, v_uid, v_events)
  returning id into v_id;
  perform public.studio_audit(p_project, v_uid, 'user', 'dialogue.requested', 'dialogue_proposal', v_id, jsonb_build_object('trigger', v_trigger, 'scene', p_scene_key, 'events', v_events));
  return query select v_id, false;
end $$;

-- The drafter re-checks the gate when it picks a draft up (an approval can't be undone, but an
-- event can never be "un-approved" into a valid draft either way).
create or replace function public.dialogue_events_still_valid(p_proposal uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_array_length(event_refs) = 0 or public.sim_events_approved(project_id, event_refs)
                     from public.dialogue_proposals where id = p_proposal), false)
$$;

create or replace function public.dialogue_cancel_invalid(p_proposal uuid)
returns void
language sql security definer set search_path = '' as $$
  update public.dialogue_proposals set status = 'cancelled', error = 'Its events are no longer approved as they were.', finished_at = now()
   where id = p_proposal and status = 'queued'
$$;

-- ---- Grants -----------------------------------------------------------------------------------
do $$ declare f text;
begin
  foreach f in array array[
    'sim_settings_save(uuid, jsonb)', 'sim_rule_save(uuid, uuid, jsonb)', 'sim_rule_remove(uuid, uuid)',
    'sim_state_set(uuid, uuid, integer, integer, text)', 'sim_run_start(uuid)', 'sim_run_cancel(uuid, uuid)',
    'sim_event_edit(uuid, uuid, integer, jsonb, boolean)', 'sim_event_decide(uuid, uuid, text, integer)',
    'sim_event_scene(uuid, uuid, text)', 'sim_event_add(uuid, jsonb, uuid)', 'sim_day_close(uuid, integer)', 'sim_state_of(uuid, uuid)',
    'sim_reassess_check(uuid, uuid)',
    'dialogue_request(uuid, text, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  foreach f in array array[
    'sim_settings_row(uuid)', 'sim_current_state(uuid)', 'sim_run_open(uuid, text, uuid)', 'sim_run_start_scheduled(uuid)',
    'sim_run_complete(uuid, jsonb, jsonb, text, jsonb, numeric, text)', 'sim_run_fail(uuid, text, jsonb, numeric)',
    'sim_event_reassessed(uuid, integer, jsonb, boolean)', 'sim_block_dependents(uuid)', 'sim_events_approved(uuid, jsonb)',
    'dialogue_events_still_valid(uuid)', 'dialogue_cancel_invalid(uuid)', 'sim_charge(uuid, uuid, text, jsonb, numeric, text, boolean)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

commit;
