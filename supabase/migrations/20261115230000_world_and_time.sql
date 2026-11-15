-- STUDIO — World & Time: where the story happens, when, and how much time it spans,
-- plus the World Builder partner.
--
-- One record per film (story_world). Its data keeps what she confirmed apart from
-- suggestions she hasn't accepted:
--   { "confirmed": { section: { value, source, at } }, "proposals": { section: { value, source, at, why } } }
-- Sections: where, when, span, coverage, summary, deeper. Sources: director (she typed or
-- accepted it), conversation (she decided it while talking with the World Builder, and her
-- own words were checked). Suggestions come from the World Builder or from reading her
-- story; they never become confirmed on their own. Every change is kept in
-- story_world_history, with who/what made it. Film runtime stays in projects.settings.
begin;

create table if not exists public.story_world (
  project_id uuid primary key references public.projects(id) on delete cascade,
  data jsonb not null default '{"confirmed": {}, "proposals": {}}'::jsonb,
  version integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
alter table public.story_world enable row level security;
drop policy if exists story_world_read on public.story_world;
create policy story_world_read on public.story_world for select to authenticated
  using (public.studio_level(project_id) >= 2);
revoke all on public.story_world from anon;
revoke insert, update, delete, truncate, references, trigger on public.story_world from authenticated;
grant select on public.story_world to authenticated;
grant all on public.story_world to service_role;

create table if not exists public.story_world_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  version integer not null,
  section text not null,
  change text not null check (change in ('set', 'accept', 'dismiss', 'propose')),
  value jsonb,
  source text not null check (source in ('director', 'conversation', 'world_builder', 'story_read')),
  actor uuid references auth.users(id),
  agent_run_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists story_world_history_idx on public.story_world_history (project_id, created_at desc);
alter table public.story_world_history enable row level security;
drop policy if exists story_world_history_read on public.story_world_history;
create policy story_world_history_read on public.story_world_history for select to authenticated
  using (public.studio_level(project_id) >= 2);
revoke all on public.story_world_history from anon;
revoke insert, update, delete, truncate, references, trigger on public.story_world_history from authenticated;
grant select on public.story_world_history to authenticated;
grant all on public.story_world_history to service_role;

-- Shape checks. The app cleans values first; this keeps anything else out.
create or replace function public.studio_world_check(p_section text, p_value jsonb)
returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_section not in ('where', 'when', 'span', 'coverage', 'summary', 'deeper') then
    raise exception 'Unknown part of World & Time.' using errcode = '22023';
  end if;
  if p_value is null or length(p_value::text) > 20000 then
    raise exception 'That is too long to save here.' using errcode = '22023';
  end if;
  if p_section = 'coverage' then
    if jsonb_typeof(p_value) <> 'string' or p_value #>> '{}' not in ('continuous', 'selected', 'mixed', 'undecided') then
      raise exception 'Unknown coverage.' using errcode = '22023';
    end if;
    return;
  end if;
  if jsonb_typeof(p_value) <> 'object' then
    raise exception 'Unexpected value.' using errcode = '22023';
  end if;
  if p_section = 'where' and (jsonb_typeof(coalesce(p_value -> 'places', '[]')) <> 'array' or jsonb_array_length(coalesce(p_value -> 'places', '[]')) > 30
      or exists (select 1 from jsonb_array_elements(coalesce(p_value -> 'places', '[]')) p
                  where length(coalesce(p ->> 'name', '')) not between 1 and 120
                     or coalesce(p ->> 'kind', '') not in ('real', 'invented', 'mixed', 'unknown'))) then
    raise exception 'Each place needs a name (and a kind).' using errcode = '22023';
  end if;
  if p_section = 'when' and (jsonb_typeof(coalesce(p_value -> 'periods', '[]')) <> 'array' or jsonb_array_length(coalesce(p_value -> 'periods', '[]')) > 12
      or exists (select 1 from jsonb_array_elements(coalesce(p_value -> 'periods', '[]')) p
                  where length(coalesce(p ->> 'label', '')) not between 1 and 120
                     or coalesce(p ->> 'precision', '') not in ('exact', 'year', 'approximate', 'era', 'relative', 'invented', 'undecided'))) then
    raise exception 'Each period needs a description.' using errcode = '22023';
  end if;
  if p_section = 'span' and (length(coalesce(p_value ->> 'text', '')) > 200 or coalesce(p_value ->> 'basis', '') not in ('creator', 'undecided')) then
    raise exception 'Unexpected time span.' using errcode = '22023';
  end if;
  if p_section = 'summary' and length(coalesce(p_value ->> 'text', '')) not between 1 and 600 then
    raise exception 'The sentence must be 1–600 characters.' using errcode = '22023';
  end if;
end $$;

-- Internal: write one section as confirmed, keep history, add review notes, audit.
create or replace function public.studio_world_put(
  p_project uuid, p_section text, p_value jsonb, p_source text, p_actor uuid, p_run uuid, p_reviews text[], p_change text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_version integer; v_note text;
begin
  perform public.studio_world_check(p_section, p_value);
  insert into public.story_world (project_id) values (p_project) on conflict (project_id) do nothing;
  update public.story_world w
     set data = jsonb_set(jsonb_set(w.data, array['confirmed', p_section],
                  jsonb_build_object('value', p_value, 'source', p_source, 'at', now())), '{proposals}', (w.data -> 'proposals') - p_section),
         version = w.version + 1, updated_at = now(), updated_by = p_actor
   where w.project_id = p_project
  returning version into v_version;
  insert into public.story_world_history (project_id, version, section, change, value, source, actor, agent_run_id)
  values (p_project, v_version, p_section, p_change, p_value, p_source, p_actor, p_run);
  -- What may need a look elsewhere: open questions in the story notebook. Nothing else changes.
  if array_length(p_reviews, 1) > 3 then raise exception 'Too many review notes.' using errcode = '22023'; end if;
  foreach v_note in array coalesce(p_reviews, array[]::text[]) loop
    continue when length(btrim(v_note)) = 0;
    insert into public.story_notebook (project_id, kind, body, status, source, created_by, agent_run_id)
    values (p_project, 'question', left(btrim(v_note), 2000), 'open', case when p_run is null then 'creator' else 'agent' end, p_actor, p_run);
  end loop;
  perform public.studio_audit(p_project, p_actor, case when p_run is null then 'user' else 'agent' end, 'world.changed', 'project', p_project,
    jsonb_build_object('section', p_section, 'source', p_source, 'version', v_version));
  return v_version;
end $$;
revoke all on function public.studio_world_put(uuid, text, jsonb, text, uuid, uuid, text[], text) from public, anon, authenticated;

-- Her edit (Edit access). p_base_version guards against overwriting a newer change.
create or replace function public.save_world_section(p_project uuid, p_section text, p_value jsonb, p_base_version integer, p_reviews text[])
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_cur integer;
begin
  v_uid := public.studio_require(p_project, 3, 'edit World & Time');
  select version into v_cur from public.story_world where project_id = p_project for update;
  if p_base_version is not null and coalesce(v_cur, 0) <> p_base_version then
    raise exception 'World & Time changed since you opened it (maybe in the World Builder). Your text is still here: reload, then save again.' using errcode = 'PT409';
  end if;
  return public.studio_world_put(p_project, p_section, p_value, 'director', v_uid, null, p_reviews, 'set');
end $$;

-- Accept a suggestion as hers.
create or replace function public.accept_world_proposal(p_project uuid, p_section text, p_reviews text[])
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_val jsonb;
begin
  v_uid := public.studio_require(p_project, 3, 'edit World & Time');
  select data -> 'proposals' -> p_section -> 'value' into v_val from public.story_world where project_id = p_project for update;
  if v_val is null then
    raise exception 'That suggestion is no longer there.' using errcode = 'PT404';
  end if;
  return public.studio_world_put(p_project, p_section, v_val, 'director', v_uid, null, p_reviews, 'accept');
end $$;

create or replace function public.dismiss_world_proposal(p_project uuid, p_section text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_version integer; v_val jsonb;
begin
  v_uid := public.studio_require(p_project, 3, 'edit World & Time');
  select data -> 'proposals' -> p_section -> 'value' into v_val from public.story_world where project_id = p_project for update;
  if v_val is null then return null; end if;
  update public.story_world set data = jsonb_set(data, '{proposals}', (data -> 'proposals') - p_section),
         version = version + 1, updated_at = now(), updated_by = v_uid
   where project_id = p_project returning version into v_version;
  insert into public.story_world_history (project_id, version, section, change, value, source, actor)
  values (p_project, v_version, p_section, 'dismiss', v_val, 'director', v_uid);
  return v_version;
end $$;

-- Internal: a suggestion (never touches what she confirmed).
create or replace function public.studio_world_propose(p_project uuid, p_section text, p_value jsonb, p_source text, p_why text, p_run uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_version integer;
begin
  perform public.studio_world_check(p_section, p_value);
  insert into public.story_world (project_id) values (p_project) on conflict (project_id) do nothing;
  update public.story_world w
     set data = jsonb_set(w.data, array['proposals', p_section],
                  jsonb_build_object('value', p_value, 'source', p_source, 'at', now(), 'why', left(coalesce(p_why, ''), 300))),
         version = w.version + 1, updated_at = now()
   where w.project_id = p_project
  returning version into v_version;
  insert into public.story_world_history (project_id, version, section, change, value, source, agent_run_id)
  values (p_project, v_version, p_section, 'propose', p_value, p_source, p_run);
end $$;
revoke all on function public.studio_world_propose(uuid, text, jsonb, text, text, uuid) from public, anon, authenticated;

-- SERVICE ROLE ONLY. The World Builder's changes for a running turn.
-- p_ops: [{section, value, her_words?, why?, reviews?: text[]}] (max 6). With her own words
-- from her latest message it is her decision; otherwise it is a suggestion.
create or replace function public.apply_world_notes(p_run uuid, p_ops jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare r public.agent_runs; v_msg text; op jsonb; v_words text; n integer := 0; v_reviews text[];
begin
  select * into r from public.agent_runs where id = p_run;
  if r.id is null or r.task_type <> 'conversation_turn' or r.input_payload ->> 'agent' <> 'world' then
    raise exception 'Run not found.' using errcode = 'PT404';
  end if;
  if r.status <> 'running' then raise exception 'Run is not running.' using errcode = 'PT409'; end if;
  if jsonb_typeof(coalesce(p_ops, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_ops, '[]'::jsonb)) > 6 then
    raise exception 'Too many changes.' using errcode = '22023';
  end if;
  select lower(content) into v_msg from public.agent_messages where id = (r.input_payload ->> 'message_id')::uuid;
  for op in select * from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
    v_words := nullif(btrim(coalesce(op ->> 'her_words', '')), '');
    if v_words is not null and length(v_words) <= 500 and position(lower(v_words) in coalesce(v_msg, '')) > 0 then
      select coalesce(array_agg(x), array[]::text[]) into v_reviews from jsonb_array_elements_text(coalesce(op -> 'reviews', '[]')) x;
      perform public.studio_world_put(r.project_id, op ->> 'section', op -> 'value', 'conversation', r.requested_by, r.id, v_reviews, 'set');
    else
      perform public.studio_world_propose(r.project_id, op ->> 'section', op -> 'value', 'world_builder', op ->> 'why', r.id);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Reading her story for a setting she has already written down.
create or replace function public.request_world_read(p_project uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_run uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'read the story for World & Time');
  if exists (select 1 from public.agent_runs ar where ar.project_id = p_project and ar.task_type = 'world_read'
              and (ar.status in ('queued', 'running') and ar.created_at > now() - interval '5 minutes'
                   or ar.created_at > now() - interval '10 minutes')) then
    return null;
  end if;
  if public.studio_ai_budget_usd(p_project) - public.studio_ai_spent_month_usd(p_project) < 0.10 then
    raise exception 'The team has used this month''s AI budget. Ask your Executive Producer.' using errcode = 'PT402';
  end if;
  insert into public.agent_runs (project_id, domain, status, task_type, input_payload, model_provider, prompt_version, requested_by)
  values (p_project, 'writer', 'queued', 'world_read', '{}'::jsonb, 'anthropic', 'world-read-v1', v_uid)
  returning id into v_run;
  perform public.studio_audit(p_project, v_uid, 'user', 'agent_run.requested', 'agent_run', v_run, jsonb_build_object('task', 'world_read'));
  return v_run;
end $$;

-- SERVICE ROLE ONLY. p_proposals: {section: {value, why}}; only for sections she hasn't
-- confirmed and that have no suggestion yet.
create or replace function public.complete_world_read(p_run uuid, p_proposals jsonb, p_usage jsonb, p_cost_usd numeric, p_model text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare r public.agent_runs; k text; v jsonb; n integer := 0; d jsonb;
begin
  select * into r from public.agent_runs where id = p_run for update;
  if r.id is null or r.task_type <> 'world_read' then raise exception 'Run not found.' using errcode = 'PT404'; end if;
  if r.status <> 'running' then raise exception 'Run is %, not running.', r.status using errcode = 'PT409'; end if;
  if jsonb_typeof(coalesce(p_proposals, '{}')) <> 'object' then raise exception 'Unexpected suggestions.' using errcode = '22023'; end if;
  perform public.studio_record_ai_charge(r, p_usage, p_cost_usd);
  select data into d from public.story_world where project_id = r.project_id;
  for k, v in select * from jsonb_each(coalesce(p_proposals, '{}')) loop
    continue when k not in ('where', 'when', 'span', 'coverage');
    continue when d is not null and ((d -> 'confirmed') ? k or (d -> 'proposals') ? k);
    perform public.studio_world_propose(r.project_id, k, v -> 'value', 'story_read', v ->> 'why', r.id);
    n := n + 1;
  end loop;
  update public.agent_runs set status = 'succeeded', completed_at = now(), model_name = left(p_model, 100),
         token_usage = coalesce(p_usage, '{}'::jsonb), output_payload = jsonb_build_object('proposals', p_proposals)
   where id = p_run;
  perform public.studio_audit(r.project_id, null, 'agent', 'agent_run.completed', 'agent_run', p_run,
    jsonb_build_object('task', 'world_read', 'suggestions', n, 'cost_usd', p_cost_usd));
  return n;
end $$;

-- The World Builder joins the partners.
alter table public.agent_threads drop constraint if exists agent_threads_agent_check;
alter table public.agent_threads add constraint agent_threads_agent_check check (agent in ('story', 'design', 'world'));

create or replace function public.start_agent_thread(p_project uuid, p_agent text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_id uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'talk with the creative partners');
  if p_agent not in ('story', 'design', 'world') then
    raise exception 'Unknown partner.' using errcode = '22023';
  end if;
  insert into public.agent_threads (project_id, agent, created_by) values (p_project, p_agent, v_uid)
  returning id into v_id;
  perform public.studio_audit(p_project, v_uid, 'user', 'agent_thread.started', 'agent_thread', v_id,
    jsonb_build_object('agent', p_agent));
  return v_id;
end $$;

create or replace function public.post_agent_message(p_thread uuid, p_content text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; t public.agent_threads; v_text text := btrim(coalesce(p_content, ''));
        v_story uuid; v_msg uuid; v_run uuid;
begin
  select * into t from public.agent_threads where id = p_thread;
  v_uid := public.studio_require(t.project_id, 3, 'talk with the creative partners');
  if length(v_text) = 0 then
    raise exception 'Write a message first.' using errcode = '22023';
  end if;
  if length(v_text) > 6000 then
    raise exception 'That message is too long (6,000 characters at most).' using errcode = '22023';
  end if;
  -- One reply at a time per conversation.
  if exists (select 1 from public.agent_runs r
              where r.project_id = t.project_id and r.task_type = 'conversation_turn'
                and r.status in ('queued', 'running') and r.created_at > now() - interval '5 minutes'
                and r.input_payload ->> 'thread_id' = p_thread::text) then
    raise exception 'Your partner is still answering. Wait for the reply, then send your next message.' using errcode = 'PT409';
  end if;
  -- A runaway guard on top of the money budget.
  if (select count(*) from public.agent_runs r where r.project_id = t.project_id
        and r.task_type = 'conversation_turn' and r.created_at > now() - interval '1 day') >= 300 then
    raise exception 'That''s a lot of conversation for one day. Your partners will be back tomorrow.' using errcode = 'PT402';
  end if;
  if public.studio_ai_budget_usd(t.project_id) - public.studio_ai_spent_month_usd(t.project_id) < 0.25 then
    raise exception 'The team has used this month''s AI budget. Ask your Executive Producer.' using errcode = 'PT402';
  end if;

  select id into v_story from public.entities where project_id = t.project_id and kind = 'story' order by created_at limit 1;
  insert into public.agent_messages (project_id, thread_id, role, content, author_id)
  values (t.project_id, t.id, 'user', v_text, v_uid) returning id into v_msg;
  insert into public.agent_runs (project_id, domain, status, task_type, input_payload, model_provider, prompt_version, requested_by)
  values (t.project_id, case t.agent when 'design' then 'production_designer' else 'writer' end::public.agent_domain,
          'queued', 'conversation_turn',
          jsonb_build_object('thread_id', t.id, 'agent', t.agent, 'message_id', v_msg, 'entity_id', v_story),
          'anthropic', case t.agent when 'story' then 'story-partner-v2.0' when 'world' then 'world-builder-v1.0' else 'design-partner-v1.0' end, v_uid)
  returning id into v_run;
  update public.agent_threads
     set last_message_at = now(), title = coalesce(title, left(regexp_replace(v_text, '\s+', ' ', 'g'), 80))
   where id = t.id;
  return v_run;
end $$;

create or replace function public.apply_partner_notes(p_run uuid, p_ops jsonb, p_runtime text, p_runtime_words text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare r public.agent_runs; v_msg text; op jsonb; v_kind text; v_body text; v_words text; v_status text; n integer := 0;
begin
  select * into r from public.agent_runs where id = p_run;
  if r.id is null or r.task_type <> 'conversation_turn' or r.input_payload ->> 'agent' not in ('story', 'world') then
    raise exception 'Run not found.' using errcode = 'PT404';
  end if;
  if r.status <> 'running' then
    raise exception 'Run is not running.' using errcode = 'PT409';
  end if;
  select lower(content) into v_msg from public.agent_messages where id = (r.input_payload ->> 'message_id')::uuid;

  if p_runtime is not null then
    if not public.studio_runtime_ok(p_runtime) then
      raise exception 'Unknown film length.' using errcode = '22023';
    end if;
    -- Only when she said it herself this turn.
    if length(btrim(coalesce(p_runtime_words, ''))) >= 1 and position(lower(btrim(p_runtime_words)) in coalesce(v_msg, '')) > 0 then
      update public.projects set settings = settings || jsonb_build_object('runtime', p_runtime) where id = r.project_id;
      perform public.studio_audit(r.project_id, r.requested_by, 'agent', 'runtime.changed', 'project', r.project_id,
        jsonb_build_object('to', p_runtime, 'via_run', p_run, 'her_words', left(p_runtime_words, 200)));
    end if;
  end if;

  if jsonb_typeof(coalesce(p_ops, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_ops, '[]'::jsonb)) > 8 then
    raise exception 'Too many notebook changes.' using errcode = '22023';
  end if;
  for op in select * from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
    if op ->> 'op' = 'add' then
      v_kind := op ->> 'kind';
      v_body := btrim(coalesce(op ->> 'body', ''));
      v_words := nullif(btrim(coalesce(op ->> 'her_words', '')), '');
      continue when v_kind not in ('decision', 'idea', 'question', 'for_later', 'beginning', 'middle', 'ending', 'next_action')
                 or length(v_body) = 0 or length(v_body) > 2000;
      -- Her decision only if her cited words really are in her message; otherwise a proposal.
      if v_words is not null and (length(v_words) > 500 or position(lower(v_words) in coalesce(v_msg, '')) = 0) then
        v_words := null;
      end if;
      v_status := case
        when v_kind in ('question', 'next_action') then 'open'
        when v_kind = 'for_later' then case when v_words is not null then 'confirmed' else 'proposed' end
        when v_words is not null then 'confirmed'
        else 'proposed' end;
      if v_kind = 'decision' and v_status = 'proposed' then v_kind := 'idea'; end if;
      if v_kind = 'next_action' then
        update public.story_notebook set status = 'archived', updated_at = now()
         where project_id = r.project_id and kind = 'next_action' and status in ('open', 'proposed', 'confirmed');
      end if;
      insert into public.story_notebook (project_id, kind, body, status, source, her_words, agent_run_id, created_by)
      values (r.project_id, v_kind, v_body, v_status, 'agent', v_words, r.id, null);
      n := n + 1;
    elsif op ->> 'op' = 'resolve' then
      update public.story_notebook set status = 'done', updated_at = now()
       where id::text = op ->> 'id' and project_id = r.project_id and kind = 'question' and status = 'open';
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

revoke all on function public.save_world_section(uuid, text, jsonb, integer, text[]) from public, anon;
grant execute on function public.save_world_section(uuid, text, jsonb, integer, text[]) to authenticated;
revoke all on function public.accept_world_proposal(uuid, text, text[]) from public, anon;
grant execute on function public.accept_world_proposal(uuid, text, text[]) to authenticated;
revoke all on function public.dismiss_world_proposal(uuid, text) from public, anon;
grant execute on function public.dismiss_world_proposal(uuid, text) to authenticated;
revoke all on function public.request_world_read(uuid) from public, anon;
grant execute on function public.request_world_read(uuid) to authenticated;
revoke all on function public.apply_world_notes(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_world_notes(uuid, jsonb) to service_role;
revoke all on function public.complete_world_read(uuid, jsonb, jsonb, numeric, text) from public, anon, authenticated;
grant execute on function public.complete_world_read(uuid, jsonb, jsonb, numeric, text) to service_role;
revoke all on function public.studio_world_check(text, jsonb) from public, anon;

commit;
