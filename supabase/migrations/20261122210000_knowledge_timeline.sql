-- STUDIO — The Knowledge Timeline: who can know what, on which story day.
--
-- The world's collected material runs ahead of the story. Day 1 is the world as of a real
-- date (the anchor); every collected item falls on a story day by its date. Then:
--   • Antagonist: an individually enabled permission to see the collected buffer ahead of
--     the current world day (a set number of days), from the film's sources.
--   • Protagonist: routine world and media knowledge through the PREVIOUS story day. No
--     buffer access, ever. Discoveries (observation, conversations, research, tests,
--     patterns) close particular gaps; they are append-only and never taken away.
--   • Supporting / Featured / unset: through the current story day.
-- Supporting characters never query the buffer; an antagonist can pass them a recorded
-- claim, warning or briefing. Interventions flag buffered developments for reassessment
-- (the original is kept); an antagonist learns a revised future only by an updated briefing.
-- Daily event limits, approval, history and the dialogue gate are untouched.
begin;

alter table public.sim_settings add column if not exists buffer_anchor date;

-- Day 1 = the world as of this real date: hers if set, else when the film's coverage began.
create or replace function public.timeline_anchor(p_project uuid)
returns date language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select buffer_anchor from public.sim_settings where project_id = p_project),
    (select min(b.run_date) from public.bubble_snapshots b join public.entities e on e.id = b.character_id where e.project_id = p_project),
    (current_date at time zone 'UTC')::date)
$$;
create or replace function public.timeline_world_day(p_project uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce((select clock_day from public.sim_settings where project_id = p_project), 0) + 1
$$;
create or replace function public.timeline_item_day(p_item uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select ((coalesce(i.published_at, i.retrieved_at) at time zone 'UTC')::date - public.timeline_anchor(i.project_id)) + 1
    from public.knowledge_items i where i.id = p_item
$$;
create or replace function public.timeline_role(p_character uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(metadata ->> 'cast_role', '') from public.entities where id = p_character and kind = 'character'
$$;

-- ---- Antagonist future access (individual permission) -------------------------------------
create table if not exists public.knowledge_future_access (
  character_id uuid primary key references public.entities(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  enabled boolean not null default false,
  ahead_days integer not null default 4 check (ahead_days between 1 and 30),
  version integer not null default 1,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

-- ---- Discoveries: gaps a character closed by their own means (append-only) ---------------
create table if not exists public.knowledge_discoveries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  character_id uuid not null references public.entities(id) on delete cascade,
  day integer not null check (day >= 1),
  method text not null check (method in ('observation', 'conversation', 'research', 'forensic', 'hypothesis', 'pattern')),
  what text not null check (length(btrim(what)) between 3 and 600),
  how text check (how is null or length(how) <= 600),
  item_id uuid references public.knowledge_items(id) on delete set null,
  item_day integer,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists knowledge_discoveries_idx on public.knowledge_discoveries (project_id, character_id, day);

-- ---- Predictions: from evidence the character has actually encountered ---------------------
create table if not exists public.knowledge_predictions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  character_id uuid not null references public.entities(id) on delete cascade,
  day integer not null check (day >= 1),
  prediction text not null check (length(btrim(prediction)) between 3 and 600),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'), -- {discovery_ids:[], item_ids:[]}
  status text not null default 'open' check (status in ('open', 'borne_out', 'wrong', 'changed')),
  outcome_note text check (outcome_note is null or length(outcome_note) <= 600),
  resolved_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- ---- Interventions and the developments they may change ------------------------------------
create table if not exists public.knowledge_interventions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  character_id uuid not null references public.entities(id) on delete cascade,
  day integer not null check (day >= 1),
  action text not null check (length(btrim(action)) between 3 and 600),
  expected_change text check (expected_change is null or length(expected_change) <= 600),
  prediction_id uuid references public.knowledge_predictions(id) on delete set null,
  discovery_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(discovery_ids) = 'array'),
  outcome text check (outcome is null or length(outcome) <= 800),
  outcome_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create table if not exists public.knowledge_trajectory_flags (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  item_id uuid references public.knowledge_items(id) on delete set null,
  intervention_id uuid not null references public.knowledge_interventions(id) on delete cascade,
  -- What the buffer said before the intervention, and who could see it then. Never edited.
  original jsonb not null check (jsonb_typeof(original) = 'object'),
  status text not null default 'needs_reassessment' check (status in ('needs_reassessment', 'reassessed')),
  revised text check (revised is null or length(revised) <= 800),
  reassessed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (intervention_id, item_id)
);

-- ---- Briefings: recorded interactions that pass information on -----------------------------
create table if not exists public.knowledge_briefings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  from_character uuid references public.entities(id) on delete cascade,   -- null: an updated briefing on a revised future
  to_character uuid not null references public.entities(id) on delete cascade,
  day integer not null check (day >= 1),
  kind text not null check (kind in ('claim', 'warning', 'briefing', 'update')),
  content text not null check (length(btrim(content)) between 3 and 1200),
  item_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(item_ids) = 'array'),
  flag_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(flag_ids) = 'array'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (from_character is null or from_character <> to_character)
);

do $$ declare t text;
begin
  foreach t in array array['knowledge_future_access', 'knowledge_discoveries', 'knowledge_predictions', 'knowledge_interventions',
                           'knowledge_trajectory_flags', 'knowledge_briefings'] loop
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
create or replace function public.timeline_character(p_character uuid, p_action text)
returns public.entities language plpgsql security definer set search_path = '' as $$
declare e public.entities;
begin
  select * into e from public.entities where id = p_character and kind = 'character' and archived_at is null and status <> 'archived';
  if e.id is null then raise exception 'Character not found.' using errcode = 'PT404'; end if;
  perform public.studio_require(e.project_id, 3, p_action);
  return e;
end $$;

-- The furthest day a character may see, on day p_day: antagonist with access → ahead; else
-- protagonist → the day before; everyone else → that day.
create or replace function public.timeline_reach(p_character uuid, p_day integer)
returns integer language sql stable security definer set search_path = '' as $$
  select case
    when public.timeline_role(p_character) = 'antagonist' and coalesce(a.enabled, false) then p_day + a.ahead_days
    when public.timeline_role(p_character) = 'protagonist' then p_day - 1
    else p_day end
  from (select 1) x left join public.knowledge_future_access a on a.character_id = p_character
$$;

-- Could this character draw on this item on day p_day (routine reach or a discovery)?
create or replace function public.timeline_can_see(p_character uuid, p_item uuid, p_day integer)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.timeline_item_day(p_item) <= public.timeline_reach(p_character, p_day), false)
      or exists (select 1 from public.knowledge_discoveries d where d.character_id = p_character and d.item_id = p_item and d.day <= p_day)
$$;

-- ---- Writes -----------------------------------------------------------------------------------
create or replace function public.timeline_set_anchor(p_project uuid, p_date date)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'set the knowledge timeline');
  if p_date is null or p_date > (current_date at time zone 'UTC')::date then
    raise exception 'Day 1 has to be a date that has already happened.' using errcode = '22023';
  end if;
  if coalesce((select clock_day from public.sim_settings where project_id = p_project), 0) > 0 then
    raise exception 'Day 1 is fixed once a story day has been closed.' using errcode = '22023';
  end if;
  insert into public.sim_settings (project_id, buffer_anchor, updated_by) values (p_project, p_date, v_uid)
  on conflict (project_id) do update set buffer_anchor = excluded.buffer_anchor, updated_by = v_uid, updated_at = now();
end $$;

create or replace function public.timeline_access_set(p_character uuid, p_enabled boolean, p_ahead integer)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.entities;
begin
  e := public.timeline_character(p_character, 'set future access');
  if p_enabled and public.timeline_role(p_character) <> 'antagonist' then
    raise exception 'Only an antagonist can see ahead. Make them the antagonist first.' using errcode = '22023';
  end if;
  if p_ahead is null or p_ahead not between 1 and 30 then raise exception 'Choose 1 to 30 days ahead.' using errcode = '22023'; end if;
  insert into public.knowledge_future_access (character_id, project_id, enabled, ahead_days, updated_by)
  values (p_character, e.project_id, coalesce(p_enabled, false), p_ahead, auth.uid())
  on conflict (character_id) do update set enabled = excluded.enabled, ahead_days = excluded.ahead_days,
    version = public.knowledge_future_access.version + 1, updated_by = excluded.updated_by, updated_at = now();
end $$;

create or replace function public.timeline_discovery_add(p_character uuid, p_method text, p_what text, p_how text, p_item uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare e public.entities; v_day integer; v_item_day integer; v_id uuid;
begin
  e := public.timeline_character(p_character, 'record a discovery');
  v_day := public.timeline_world_day(e.project_id);
  if p_method not in ('observation', 'conversation', 'research', 'forensic', 'hypothesis', 'pattern') then
    raise exception 'Choose how they found out.' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_what, ''))) < 3 then raise exception 'Say what they found out.' using errcode = '22023'; end if;
  if p_item is not null then
    if not exists (select 1 from public.knowledge_items where id = p_item and project_id = e.project_id) then
      raise exception 'That item isn''t in this film''s knowledge base.' using errcode = '22023';
    end if;
    v_item_day := public.timeline_item_day(p_item);
    -- Discoveries reach the present, never the future buffer.
    if v_item_day > v_day then
      raise exception 'That development hasn''t happened yet on day %. Discoveries can only close gaps up to the current day.', v_day using errcode = '22023';
    end if;
  end if;
  insert into public.knowledge_discoveries (project_id, character_id, day, method, what, how, item_id, item_day, created_by)
  values (e.project_id, p_character, v_day, p_method, btrim(p_what), nullif(btrim(coalesce(p_how, '')), ''), p_item, v_item_day, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.timeline_prediction_add(p_character uuid, p_prediction text, p_discoveries uuid[], p_items uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare e public.entities; v_day integer; v_id uuid; x uuid;
begin
  e := public.timeline_character(p_character, 'record a prediction');
  v_day := public.timeline_world_day(e.project_id);
  if length(btrim(coalesce(p_prediction, ''))) < 3 then raise exception 'Write the prediction.' using errcode = '22023'; end if;
  if coalesce(array_length(p_discoveries, 1), 0) + coalesce(array_length(p_items, 1), 0) = 0 then
    raise exception 'A prediction needs evidence they have encountered: a discovery or an item they can draw on.' using errcode = '22023';
  end if;
  foreach x in array coalesce(p_discoveries, '{}') loop
    if not exists (select 1 from public.knowledge_discoveries where id = x and character_id = p_character and day <= v_day) then
      raise exception 'That discovery isn''t theirs.' using errcode = '22023';
    end if;
  end loop;
  foreach x in array coalesce(p_items, '{}') loop
    if not exists (select 1 from public.knowledge_items where id = x and project_id = e.project_id) or not public.timeline_can_see(p_character, x, v_day) then
      raise exception 'They haven''t encountered that item yet, so it can''t be their evidence.' using errcode = '22023';
    end if;
  end loop;
  insert into public.knowledge_predictions (project_id, character_id, day, prediction, evidence, created_by)
  values (e.project_id, p_character, v_day, btrim(p_prediction),
          jsonb_build_object('discovery_ids', to_jsonb(coalesce(p_discoveries, '{}')), 'item_ids', to_jsonb(coalesce(p_items, '{}'))), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.timeline_prediction_resolve(p_prediction uuid, p_status text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.knowledge_predictions;
begin
  select * into p from public.knowledge_predictions where id = p_prediction;
  if p.id is null then raise exception 'Prediction not found.' using errcode = 'PT404'; end if;
  perform public.studio_require(p.project_id, 3, 'resolve a prediction');
  if p_status not in ('open', 'borne_out', 'wrong', 'changed') then raise exception 'Unknown outcome.' using errcode = '22023'; end if;
  update public.knowledge_predictions set status = p_status, outcome_note = nullif(btrim(coalesce(p_note, '')), ''),
    resolved_at = case when p_status = 'open' then null else now() end where id = p_prediction;
end $$;

-- An intervention flags the buffered developments it may change. The originals are kept,
-- with who could see them at the time.
create or replace function public.timeline_intervention_add(p_character uuid, p_action text, p_expected text, p_prediction uuid, p_discoveries uuid[], p_items uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare e public.entities; v_day integer; v_id uuid; x uuid; it public.knowledge_items; v_knew jsonb;
begin
  e := public.timeline_character(p_character, 'record an intervention');
  v_day := public.timeline_world_day(e.project_id);
  if length(btrim(coalesce(p_action, ''))) < 3 then raise exception 'Say what they did.' using errcode = '22023'; end if;
  if p_prediction is not null and not exists (select 1 from public.knowledge_predictions where id = p_prediction and character_id = p_character) then
    raise exception 'That prediction isn''t theirs.' using errcode = '22023';
  end if;
  foreach x in array coalesce(p_discoveries, '{}') loop
    if not exists (select 1 from public.knowledge_discoveries where id = x and character_id = p_character) then
      raise exception 'That discovery isn''t theirs.' using errcode = '22023';
    end if;
  end loop;
  insert into public.knowledge_interventions (project_id, character_id, day, action, expected_change, prediction_id, discovery_ids, created_by)
  values (e.project_id, p_character, v_day, btrim(p_action), nullif(btrim(coalesce(p_expected, '')), ''), p_prediction,
          to_jsonb(coalesce(p_discoveries, '{}')), auth.uid())
  returning id into v_id;
  foreach x in array coalesce(p_items, '{}') loop
    select * into it from public.knowledge_items where id = x and project_id = e.project_id;
    if it.id is null then raise exception 'That item isn''t in this film''s knowledge base.' using errcode = '22023'; end if;
    if public.timeline_item_day(x) <= v_day then
      raise exception 'Only developments still ahead (after day %) can be flagged for reassessment.', v_day using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(c.name order by c.name), '[]'::jsonb) into v_knew
      from public.entities c where c.project_id = e.project_id and c.kind = 'character' and c.archived_at is null and c.status <> 'archived'
       and public.timeline_role(c.id) = 'antagonist' and public.timeline_reach(c.id, v_day) >= public.timeline_item_day(x);
    insert into public.knowledge_trajectory_flags (project_id, item_id, intervention_id, original)
    values (e.project_id, x, v_id, jsonb_build_object('title', it.title, 'item_day', public.timeline_item_day(x), 'version', it.version,
            'url', it.url, 'flagged_on_day', v_day, 'known_by', v_knew))
    on conflict do nothing;
  end loop;
  return v_id;
end $$;

create or replace function public.timeline_intervention_outcome(p_intervention uuid, p_outcome text)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.knowledge_interventions;
begin
  select * into i from public.knowledge_interventions where id = p_intervention;
  if i.id is null then raise exception 'Intervention not found.' using errcode = 'PT404'; end if;
  perform public.studio_require(i.project_id, 3, 'record what happened');
  update public.knowledge_interventions set outcome = nullif(btrim(coalesce(p_outcome, '')), ''), outcome_at = now() where id = p_intervention;
end $$;

create or replace function public.timeline_flag_reassess(p_flag uuid, p_revised text)
returns void language plpgsql security definer set search_path = '' as $$
declare f public.knowledge_trajectory_flags;
begin
  select * into f from public.knowledge_trajectory_flags where id = p_flag;
  if f.id is null then raise exception 'Not found.' using errcode = 'PT404'; end if;
  perform public.studio_require(f.project_id, 3, 'reassess a development');
  if length(btrim(coalesce(p_revised, ''))) < 3 then raise exception 'Describe the revised expectation.' using errcode = '22023'; end if;
  update public.knowledge_trajectory_flags set status = 'reassessed', revised = btrim(p_revised), reassessed_at = now() where id = p_flag;
end $$;

-- A recorded interaction. From an antagonist: only items within their access window on that
-- day. An 'update' (from no one) tells an antagonist about reassessed developments.
create or replace function public.timeline_briefing_add(p_from uuid, p_to uuid, p_kind text, p_content text, p_items uuid[], p_flags uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare t public.entities; v_day integer; v_id uuid; x uuid;
begin
  t := public.timeline_character(p_to, 'record a briefing');
  v_day := public.timeline_world_day(t.project_id);
  if p_kind not in ('claim', 'warning', 'briefing', 'update') then raise exception 'Choose claim, warning or briefing.' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_content, ''))) < 3 then raise exception 'Write what was said.' using errcode = '22023'; end if;
  if p_kind = 'update' then
    if p_from is not null then raise exception 'An updated briefing isn''t from a character.' using errcode = '22023'; end if;
    if public.timeline_role(p_to) <> 'antagonist' then raise exception 'Updated briefings are for an antagonist.' using errcode = '22023'; end if;
    if coalesce(array_length(p_flags, 1), 0) = 0 then raise exception 'Choose the reassessed developments to brief them on.' using errcode = '22023'; end if;
    foreach x in array p_flags loop
      if not exists (select 1 from public.knowledge_trajectory_flags where id = x and project_id = t.project_id and status = 'reassessed') then
        raise exception 'Only reassessed developments can be briefed.' using errcode = '22023';
      end if;
    end loop;
  else
    if p_from is null then raise exception 'Who is passing it on?' using errcode = '22023'; end if;
    perform public.timeline_character(p_from, 'record a briefing');
    if (select project_id from public.entities where id = p_from) <> t.project_id then raise exception 'Character not found.' using errcode = 'PT404'; end if;
    foreach x in array coalesce(p_items, '{}') loop
      if not exists (select 1 from public.knowledge_items where id = x and project_id = t.project_id) or not public.timeline_can_see(p_from, x, v_day) then
        raise exception 'They can only pass on what they can see themselves.' using errcode = '22023';
      end if;
    end loop;
    if coalesce(array_length(p_flags, 1), 0) > 0 then raise exception 'Flags go in an updated briefing.' using errcode = '22023'; end if;
  end if;
  insert into public.knowledge_briefings (project_id, from_character, to_character, day, kind, content, item_ids, flag_ids, created_by)
  values (t.project_id, p_from, p_to, v_day, p_kind, btrim(p_content), to_jsonb(coalesce(p_items, '{}')), to_jsonb(coalesce(p_flags, '{}')), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Changing a character's role away from antagonist turns their future access off.
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
  if p_role is distinct from 'antagonist' then
    update public.knowledge_future_access set enabled = false, version = version + 1, updated_by = v_uid, updated_at = now()
     where character_id = p_entity and enabled;
  end if;
end $$;

revoke all on function public.timeline_anchor(uuid), public.timeline_world_day(uuid), public.timeline_item_day(uuid), public.timeline_role(uuid),
  public.timeline_character(uuid, text), public.timeline_reach(uuid, integer), public.timeline_can_see(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.timeline_set_anchor(uuid, date), public.timeline_access_set(uuid, boolean, integer),
  public.timeline_discovery_add(uuid, text, text, text, uuid), public.timeline_prediction_add(uuid, text, uuid[], uuid[]),
  public.timeline_prediction_resolve(uuid, text, text), public.timeline_intervention_add(uuid, text, text, uuid, uuid[], uuid[]),
  public.timeline_intervention_outcome(uuid, text), public.timeline_flag_reassess(uuid, text),
  public.timeline_briefing_add(uuid, uuid, text, text, uuid[], uuid[]) to authenticated;
revoke all on function public.timeline_set_anchor(uuid, date), public.timeline_access_set(uuid, boolean, integer),
  public.timeline_discovery_add(uuid, text, text, text, uuid), public.timeline_prediction_add(uuid, text, uuid[], uuid[]),
  public.timeline_prediction_resolve(uuid, text, text), public.timeline_intervention_add(uuid, text, text, uuid, uuid[], uuid[]),
  public.timeline_intervention_outcome(uuid, text), public.timeline_flag_reassess(uuid, text),
  public.timeline_briefing_add(uuid, uuid, text, text, uuid[], uuid[]) from public, anon;
grant execute on function public.timeline_anchor(uuid), public.timeline_world_day(uuid), public.timeline_reach(uuid, integer) to service_role;

commit;
