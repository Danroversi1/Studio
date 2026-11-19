-- STUDIO — The World knowledge base, World searches and character impressions (qualia).
-- Additive and backward compatible.
--
-- * World: one special collection per film for the world outside the story (news, events,
--   how people react). It's research: nothing in it becomes story fact unless she decides.
-- * World searches: she writes a prompt; the server searches the web (Anthropic web search)
--   and proposes findings with their real links. Nothing is kept until she picks it.
--   Summaries are written by Studio's research assistant and labeled that way.
-- * Impressions: a character's first-person experience of one World item, written by the
--   character agent from her character profile. Proposed until she accepts; accepted ones
--   color that character's dialogue (only when the item is available in the scene).
begin;

alter table public.knowledge_collections add column if not exists kind text not null default 'topic';
alter table public.knowledge_collections drop constraint if exists knowledge_collections_kind_check;
alter table public.knowledge_collections add constraint knowledge_collections_kind_check check (kind in ('topic', 'character', 'world'));
update public.knowledge_collections set kind = 'character' where character_id is not null and kind = 'topic';
create unique index if not exists knowledge_collections_world_idx on public.knowledge_collections (project_id) where kind = 'world' and archived_at is null;

alter table public.knowledge_items drop constraint if exists knowledge_items_content_status_check;
alter table public.knowledge_items add constraint knowledge_items_content_status_check
  check (content_status in ('full_text', 'excerpt', 'summary', 'ai_summary', 'metadata_only'));

create table if not exists public.world_searches (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  prompt text not null check (length(btrim(prompt)) between 3 and 600),
  focus text not null default 'both' check (focus in ('news', 'reactions', 'both')),
  period text not null default 'month' check (period in ('week', 'month', 'year', 'any')),
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  -- [{id, kind, title, url, source, published, summary, why, kept}]
  results jsonb not null default '[]'::jsonb check (jsonb_typeof(results) = 'array' and length(results::text) <= 200000),
  queries jsonb not null default '[]'::jsonb,
  searches integer not null default 0,
  cost_usd numeric(10,4) not null default 0,
  error text check (error is null or length(error) <= 500),
  agent_run_id uuid references public.agent_runs(id) on delete set null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists world_searches_project_idx on public.world_searches (project_id, created_at desc);

alter table public.knowledge_sources add column if not exists search_id uuid references public.world_searches(id) on delete set null;

create table if not exists public.character_impressions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  character_id uuid not null references public.entities(id) on delete cascade,
  item_id uuid not null references public.knowledge_items(id) on delete cascade,
  item_version integer not null,
  profile_version integer not null default 0,
  text text not null check (length(btrim(text)) between 1 and 2000),
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'dismissed')),
  agent_run_id uuid references public.agent_runs(id) on delete set null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id)
);
create index if not exists character_impressions_idx on public.character_impressions (project_id, character_id, status);

do $$ declare t text;
begin
  foreach t in array array['world_searches', 'character_impressions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.studio_level(project_id) >= 2)', t || '_read', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
grant select (search_id) on public.knowledge_sources to authenticated;

-- ---- World --------------------------------------------------------------------------------
/** The film's World collection (made on first use). With p_connect_all, connects it to every
 *  character that has never had a connection to it (one she removed stays removed). */
create or replace function public.kb_world_collection(p_project uuid, p_connect_all boolean)
returns table (collection_id uuid, connected integer)
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_id uuid; v_new boolean := false; n integer := 0; c record;
begin
  v_uid := public.studio_require(p_project, 3, 'set up the World knowledge base');
  select id into v_id from public.knowledge_collections where project_id = p_project and kind = 'world' and archived_at is null;
  if v_id is null then
    if exists (select 1 from public.knowledge_collections where project_id = p_project and archived_at is null and lower(btrim(name)) = 'world') then
      raise exception 'There''s already a collection named World. Rename it first.' using errcode = '23505';
    end if;
    insert into public.knowledge_collections (project_id, name, description, kind, created_by)
    values (p_project, 'World', 'The world outside the story: news, events and how people react.', 'world', v_uid) returning id into v_id;
    v_new := true;
  end if;
  if v_new or p_connect_all then
    for c in select e.id from public.entities e where e.project_id = p_project and e.kind = 'character' and e.archived_at is null
               and e.status <> 'archived'
               and not exists (select 1 from public.character_knowledge k where k.character_id = e.id and k.collection_id = v_id) loop
      insert into public.character_knowledge (project_id, character_id, collection_id, purpose, temporal, note, created_by)
      values (p_project, c.id, v_id, 'story_info', 'story_dated', 'The world they live in: they can know what has happened by each scene''s date.', v_uid);
      n := n + 1;
    end loop;
  end if;
  return query select v_id, n;
end $$;

/** Starts a World search (budget-checked, one at a time, at most 30 a day per film). */
create or replace function public.world_search_request(p_project uuid, p_prompt text, p_focus text, p_period text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_run uuid; v_id uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'search the world');
  if coalesce(length(btrim(p_prompt)), 0) not between 3 and 600 then raise exception 'Write what you want to follow (up to 600 characters).' using errcode = '22023'; end if;
  if p_focus not in ('news', 'reactions', 'both') or p_period not in ('week', 'month', 'year', 'any') then raise exception 'Unknown search option.' using errcode = '22023'; end if;
  if exists (select 1 from public.world_searches where project_id = p_project and status = 'running' and created_at > now() - interval '4 minutes') then
    raise exception 'A World search is already running. Wait for it to finish.' using errcode = 'PT409';
  end if;
  if (select count(*) from public.world_searches where project_id = p_project and created_at > now() - interval '1 day') >= 30 then
    raise exception 'That''s 30 World searches today. Try again tomorrow.' using errcode = 'PT409';
  end if;
  if public.studio_ai_budget_usd(p_project) - public.studio_ai_spent_month_usd(p_project) < 0.20 then
    raise exception 'The team has used this month''s AI budget. Ask your Executive Producer.' using errcode = 'PT402';
  end if;
  insert into public.agent_runs (project_id, domain, status, task_type, input_payload, model_provider, prompt_version, requested_by, started_at)
  values (p_project, 'writer', 'running', 'world_search', jsonb_build_object('prompt', left(btrim(p_prompt), 600)), 'anthropic', 'world-search-v1', v_uid, now())
  returning id into v_run;
  insert into public.world_searches (project_id, prompt, focus, period, agent_run_id, created_by)
  values (p_project, btrim(p_prompt), p_focus, p_period, v_run, v_uid) returning id into v_id;
  return v_id;
end $$;

/** SERVICE ROLE ONLY. */
create or replace function public.world_search_complete(p_search uuid, p_results jsonb, p_queries jsonb, p_searches integer, p_usage jsonb, p_cost_usd numeric, p_model text)
returns void
language plpgsql security definer set search_path = '' as $$
declare s public.world_searches; r public.agent_runs;
begin
  select * into s from public.world_searches where id = p_search for update;
  if s.id is null or s.status <> 'running' then raise exception 'Search isn''t running.' using errcode = 'PT409'; end if;
  if jsonb_typeof(p_results) <> 'array' or jsonb_array_length(p_results) > 25 then raise exception 'Unexpected results.' using errcode = '22023'; end if;
  select * into r from public.agent_runs where id = s.agent_run_id for update;
  if r.id is not null then
    perform public.studio_record_ai_charge(r, p_usage, p_cost_usd);
    update public.agent_runs set status = 'succeeded', completed_at = now(), model_name = left(p_model, 100), token_usage = coalesce(p_usage, '{}'::jsonb),
           output_payload = jsonb_build_object('search_id', s.id, 'results', jsonb_array_length(p_results)) where id = r.id;
  end if;
  update public.world_searches set status = 'done', results = p_results, queries = coalesce(p_queries, '[]'::jsonb),
         searches = coalesce(p_searches, 0), cost_usd = coalesce(p_cost_usd, 0), finished_at = now() where id = s.id;
end $$;

/** SERVICE ROLE ONLY. */
create or replace function public.world_search_fail(p_search uuid, p_error text, p_usage jsonb, p_cost_usd numeric)
returns void
language plpgsql security definer set search_path = '' as $$
declare s public.world_searches; r public.agent_runs;
begin
  select * into s from public.world_searches where id = p_search for update;
  if s.id is null then return; end if;
  select * into r from public.agent_runs where id = s.agent_run_id for update;
  if r.id is not null then
    if coalesce(p_cost_usd, 0) > 0 then perform public.studio_record_ai_charge(r, p_usage, p_cost_usd); end if;
    update public.agent_runs set status = 'failed', completed_at = now(), error_message = left(coalesce(p_error, ''), 1000) where id = r.id;
  end if;
  update public.world_searches set status = 'failed', error = left(coalesce(p_error, 'The search failed.'), 500), cost_usd = coalesce(p_cost_usd, 0), finished_at = now()
   where id = s.id and status = 'running';
end $$;

/** Keeps chosen findings in World: each becomes a saved link with the research assistant's
 *  summary (labeled as such). A link already in the film is reused, not duplicated. */
create or replace function public.world_search_keep(p_project uuid, p_search uuid, p_result_ids text[])
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; s public.world_searches; v_world uuid; f jsonb; v_src uuid; v_pub timestamptz; n integer := 0; v_results jsonb;
begin
  v_uid := public.studio_require(p_project, 3, 'keep World findings');
  select * into s from public.world_searches where id = p_search and project_id = p_project for update;
  if s.id is null or s.status <> 'done' then raise exception 'Search not found.' using errcode = 'PT404'; end if;
  select collection_id into v_world from public.kb_world_collection(p_project, false);
  for f in select x from jsonb_array_elements(s.results) x where x ->> 'id' = any(p_result_ids) loop
    continue when coalesce(f ->> 'url', '') !~ '^https?://' or coalesce(btrim(f ->> 'title'), '') = '';
    select id into v_src from public.knowledge_sources where project_id = p_project and archived_at is null and kind = 'link' and url = f ->> 'url' limit 1;
    if v_src is null then
      v_pub := case when (f ->> 'published') ~ '^\d{4}-\d{2}-\d{2}$' then ((f ->> 'published') || 'T12:00:00Z')::timestamptz end;
      insert into public.knowledge_sources (project_id, kind, status, title, url, origin, search_id, created_by)
      values (p_project, 'link', 'link_saved', left(f ->> 'title', 300), left(f ->> 'url', 2000), left(nullif(f ->> 'source', ''), 200), s.id, v_uid)
      returning id into v_src;
      perform public.kb_put_item(p_project, v_src, 'main', left(f ->> 'title', 500), left(f ->> 'url', 2000), null, v_pub,
        left(concat_ws(E'\n\n', nullif(f ->> 'summary', ''), case when nullif(f ->> 'why', '') is not null then 'Why it may matter: ' || (f ->> 'why') end), 4000), 'ai_summary');
      update public.knowledge_items set verification = 'unverified',
             verification_note = 'Found by a World search ("' || left(s.prompt, 120) || '"). The summary was written by Studio''s research assistant'
               || case when v_pub is not null then ' and the date is as reported for the page' else '' end || '. Open the link to check it.'
       where source_id = v_src and dedupe_key = 'main';
    end if;
    insert into public.knowledge_collection_members (project_id, collection_id, source_id, created_by)
    values (p_project, v_world, v_src, v_uid) on conflict do nothing;
    n := n + 1;
  end loop;
  select coalesce(jsonb_agg(case when x ->> 'id' = any(p_result_ids) then x || '{"kept": true}'::jsonb else x end), '[]'::jsonb)
    into v_results from jsonb_array_elements(s.results) x;
  update public.world_searches set results = v_results where id = s.id;
  perform public.studio_audit(p_project, v_uid, 'user', 'knowledge.world_kept', 'world_search', s.id, jsonb_build_object('kept', n));
  return n;
end $$;

-- ---- Impressions (qualia) ---------------------------------------------------------------------
create or replace function public.impression_request(p_project uuid, p_character uuid, p_item uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_run uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'develop a character');
  perform public.character_check(p_project, p_character);
  if not exists (select 1 from public.knowledge_items where id = p_item and project_id = p_project and archived_at is null) then
    raise exception 'Research not found.' using errcode = 'PT404';
  end if;
  if exists (select 1 from public.agent_runs where project_id = p_project and task_type = 'impression' and status in ('queued', 'running')
             and created_at > now() - interval '2 minutes' and input_payload ->> 'character_id' = p_character::text) then
    raise exception 'That character is still forming an impression.' using errcode = 'PT409';
  end if;
  if public.studio_ai_budget_usd(p_project) - public.studio_ai_spent_month_usd(p_project) < 0.05 then
    raise exception 'The team has used this month''s AI budget. Ask your Executive Producer.' using errcode = 'PT402';
  end if;
  insert into public.agent_runs (project_id, domain, status, task_type, input_payload, model_provider, prompt_version, requested_by, started_at)
  values (p_project, 'writer', 'running', 'impression', jsonb_build_object('character_id', p_character, 'item_id', p_item), 'anthropic', 'impression-v1', v_uid, now())
  returning id into v_run;
  return v_run;
end $$;

/** SERVICE ROLE ONLY. */
create or replace function public.impression_complete(p_run uuid, p_text text, p_item_version integer, p_profile_version integer, p_usage jsonb, p_cost_usd numeric, p_model text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.agent_runs; v_id uuid;
begin
  select * into r from public.agent_runs where id = p_run for update;
  if r.id is null or r.task_type <> 'impression' or r.status <> 'running' then raise exception 'Run not running.' using errcode = 'PT409'; end if;
  insert into public.character_impressions (project_id, character_id, item_id, item_version, profile_version, text, agent_run_id, created_by)
  values (r.project_id, (r.input_payload ->> 'character_id')::uuid, (r.input_payload ->> 'item_id')::uuid, p_item_version, coalesce(p_profile_version, 0),
          left(btrim(p_text), 2000), r.id, r.requested_by) returning id into v_id;
  perform public.studio_record_ai_charge(r, p_usage, p_cost_usd);
  update public.agent_runs set status = 'succeeded', completed_at = now(), model_name = left(p_model, 100), token_usage = coalesce(p_usage, '{}'::jsonb),
         output_payload = jsonb_build_object('impression_id', v_id) where id = r.id;
  return v_id;
end $$;

/** Accept (optionally edited) or dismiss an impression. Accepted ones feed dialogue. */
create or replace function public.impression_decide(p_project uuid, p_impression uuid, p_accept boolean, p_text text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'develop a character');
  update public.character_impressions set
    status = case when p_accept then 'accepted' else 'dismissed' end,
    text = case when p_accept and coalesce(btrim(p_text), '') <> '' then left(btrim(p_text), 2000) else text end,
    decided_at = now(), decided_by = v_uid
  where id = p_impression and project_id = p_project;
  if not found then raise exception 'Impression not found.' using errcode = 'PT404'; end if;
end $$;

do $$ declare f text;
begin
  foreach f in array array['kb_world_collection(uuid, boolean)', 'world_search_request(uuid, text, text, text)', 'world_search_keep(uuid, uuid, text[])',
    'impression_request(uuid, uuid, uuid)', 'impression_decide(uuid, uuid, boolean, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  foreach f in array array['world_search_complete(uuid, jsonb, jsonb, integer, jsonb, numeric, text)', 'world_search_fail(uuid, text, jsonb, numeric)',
    'impression_complete(uuid, text, integer, integer, jsonb, numeric, text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

commit;
