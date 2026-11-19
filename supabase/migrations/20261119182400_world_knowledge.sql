-- STUDIO — The World knowledge base, free World watches and character impressions (qualia).
-- Additive and backward compatible.
--
-- * World: one special collection per film for the world outside the story (news, events,
--   how people react). It's research: nothing in it becomes story fact unless she decides.
-- * World watches: she types what to follow; Studio follows it with FREE public sources
--   (GDELT news index, Hacker News discussion search) as feeds checked once a day. No model,
--   no tokens. At most 10 watches per film, and each watch keeps only its newest 15 items per
--   source (items she keeps, or that a character has an impression of, are never trimmed).
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

alter table public.knowledge_sources drop constraint if exists knowledge_sources_adapter_check;
alter table public.knowledge_sources add constraint knowledge_sources_adapter_check check (adapter in ('manual', 'rss', 'bluesky', 'mastodon', 'gdelt', 'hn'));
alter table public.knowledge_sources add column if not exists watch_query text check (watch_query is null or length(btrim(watch_query)) between 2 and 200);
alter table public.knowledge_items add column if not exists pinned boolean not null default false;
grant select (watch_query) on public.knowledge_sources to authenticated;

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
  foreach t in array array['character_impressions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.studio_level(project_id) >= 2)', t || '_read', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

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

/** Follow something in the world for free: one feed per chosen free source (news / reactions),
 *  checked once a day. p_feeds: [{adapter: gdelt|hn, feed_url, title}] built by the server. */
create or replace function public.kb_world_watch_add(p_project uuid, p_query text, p_feeds jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_world uuid; f jsonb; v_id uuid; n integer := 0; v_q text := btrim(coalesce(p_query, ''));
begin
  v_uid := public.studio_require(p_project, 3, 'follow the world');
  if length(v_q) not between 2 and 200 then raise exception 'Type a few words to follow (up to 200 characters).' using errcode = '22023'; end if;
  if jsonb_typeof(p_feeds) <> 'array' or jsonb_array_length(p_feeds) not between 1 and 2 then raise exception 'Choose news, reactions or both.' using errcode = '22023'; end if;
  if exists (select 1 from public.knowledge_sources where project_id = p_project and archived_at is null and lower(watch_query) = lower(v_q)) then
    raise exception 'You''re already following that.' using errcode = '23505';
  end if;
  if (select count(distinct lower(watch_query)) from public.knowledge_sources where project_id = p_project and archived_at is null and watch_query is not null) >= 10 then
    raise exception 'You can follow up to 10 things. Remove one first.' using errcode = '22023';
  end if;
  select collection_id into v_world from public.kb_world_collection(p_project, false);
  for f in select * from jsonb_array_elements(p_feeds) loop
    if f ->> 'adapter' = 'gdelt' and (f ->> 'feed_url') !~ '^https://api\.gdeltproject\.org/api/v2/doc/doc\?' then raise exception 'Unexpected news address.' using errcode = '22023'; end if;
    if f ->> 'adapter' = 'hn' and (f ->> 'feed_url') !~ '^https://hn\.algolia\.com/api/v1/search_by_date\?' then raise exception 'Unexpected discussion address.' using errcode = '22023'; end if;
    if f ->> 'adapter' not in ('gdelt', 'hn') then raise exception 'Unknown free source.' using errcode = '22023'; end if;
    insert into public.knowledge_sources (project_id, kind, adapter, status, title, feed_url, origin, refresh_hours, next_refresh_at, watch_query, created_by)
    values (p_project, 'feed', f ->> 'adapter', 'pending', left(coalesce(nullif(f ->> 'title', ''), v_q), 300), f ->> 'feed_url',
            case f ->> 'adapter' when 'gdelt' then 'GDELT news index' else 'Hacker News' end, 24, now(), v_q, v_uid)
    returning id into v_id;
    insert into public.knowledge_collection_members (project_id, collection_id, source_id, created_by) values (p_project, v_world, v_id, v_uid);
    n := n + 1;
  end loop;
  perform public.studio_audit(p_project, v_uid, 'user', 'knowledge.world_watch_added', 'project', p_project, jsonb_build_object('query', v_q));
  return n;
end $$;

/** Stops following: the watch stops refreshing and its items are trimmed away, except items
 *  she kept or that a character has an impression of, which stay in World. Frees the slot. */
create or replace function public.kb_world_watch_remove(p_project uuid, p_query text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; r record;
begin
  v_uid := public.studio_require(p_project, 3, 'follow the world');
  for r in select id from public.knowledge_sources where project_id = p_project and archived_at is null and lower(watch_query) = lower(btrim(p_query)) loop
    update public.knowledge_items i set archived_at = now()
     where i.source_id = r.id and i.archived_at is null and not i.pinned
       and not exists (select 1 from public.character_impressions c where c.item_id = i.id and c.status <> 'dismissed');
    update public.knowledge_sources set disconnected_at = coalesce(disconnected_at, now()), watch_query = null,
           title = left('Stopped: ' || title, 300), updated_at = now() where id = r.id;
  end loop;
end $$;

/** Keep (pin) an item so trimming never removes it. */
create or replace function public.kb_item_pin(p_project uuid, p_item uuid, p_pinned boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'keep research');
  update public.knowledge_items set pinned = coalesce(p_pinned, false), updated_at = now() where id = p_item and project_id = p_project;
  if not found then raise exception 'Research not found.' using errcode = 'PT404'; end if;
end $$;

/** SERVICE ROLE ONLY. Keeps a watch feed small: only the newest 15 items stay in the library
 *  (kept items and ones with impressions are never trimmed; trimmed rows are archived, not
 *  deleted, so earlier drafts keep their record). */
create or replace function public.kb_trim_watch(p_source uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  with ranked as (
    select i.id, row_number() over (order by coalesce(i.published_at, i.retrieved_at) desc) rn
      from public.knowledge_items i
     where i.source_id = p_source and i.archived_at is null and not i.pinned
       and not exists (select 1 from public.character_impressions c where c.item_id = i.id and c.status <> 'dismissed'))
  update public.knowledge_items set archived_at = now() where id in (select id from ranked where rn > 15);
  get diagnostics n = row_count;
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
  foreach f in array array['kb_world_collection(uuid, boolean)', 'kb_world_watch_add(uuid, text, jsonb)', 'kb_world_watch_remove(uuid, text)',
    'kb_item_pin(uuid, uuid, boolean)', 'impression_request(uuid, uuid, uuid)', 'impression_decide(uuid, uuid, boolean, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  foreach f in array array['kb_trim_watch(uuid)', 'impression_complete(uuid, text, integer, integer, jsonb, numeric, text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

commit;
