-- STUDIO — What each main character is into: interests (and things they avoid) that the
-- Director types, prompts, or draws from a link or document. Each interest she keeps becomes a
-- free daily news search that belongs to that character (kept in their own collection), so
-- their daily coverage is loaded with it. Links that are feeds are followed by the character.
begin;

alter table public.knowledge_sources add column if not exists watch_character uuid references public.entities(id) on delete cascade;
grant select (watch_character) on public.knowledge_sources to authenticated;
create index if not exists knowledge_sources_watch_character_idx on public.knowledge_sources (watch_character) where watch_character is not null;

-- World topics stay the film's own (characters' interest searches don't count toward them).
create or replace function public.kb_world_watch_add(p_project uuid, p_query text, p_feeds jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_world uuid; f jsonb; v_id uuid; n integer := 0; v_q text := btrim(coalesce(p_query, ''));
begin
  v_uid := public.studio_require(p_project, 3, 'follow the world');
  if length(v_q) not between 2 and 200 then raise exception 'Type a few words to follow (up to 200 characters).' using errcode = '22023'; end if;
  if jsonb_typeof(p_feeds) <> 'array' or jsonb_array_length(p_feeds) not between 1 and 2 then raise exception 'Choose news, reactions or both.' using errcode = '22023'; end if;
  if exists (select 1 from public.knowledge_sources where project_id = p_project and archived_at is null and watch_character is null and lower(watch_query) = lower(v_q)) then
    raise exception 'You''re already following that.' using errcode = '23505';
  end if;
  if (select count(distinct lower(watch_query)) from public.knowledge_sources where project_id = p_project and archived_at is null and watch_query is not null and watch_character is null) >= 10 then
    raise exception 'You can follow up to 10 things. Remove one first.' using errcode = '22023';
  end if;
  for f in select * from jsonb_array_elements(p_feeds) loop
    if not ((f ->> 'adapter' = 'rss' and (f ->> 'feed_url') ~ '^https://news\.google\.com/rss/search\?')
         or (f ->> 'adapter' = 'hn' and (f ->> 'feed_url') ~ '^https://hn\.algolia\.com/api/v1/search_by_date\?')
         or (f ->> 'adapter' = 'weather' and (f ->> 'feed_url') ~ '^https://api\.open-meteo\.com/v1/forecast\?')) then
      raise exception 'Unknown free source.' using errcode = '22023';
    end if;
  end loop;
  select collection_id into v_world from public.kb_world_collection(p_project, false);
  for f in select * from jsonb_array_elements(p_feeds) loop
    insert into public.knowledge_sources (project_id, kind, adapter, status, title, feed_url, origin, refresh_hours, next_refresh_at, watch_query, created_by)
    values (p_project, 'feed', f ->> 'adapter', 'pending', left(coalesce(nullif(f ->> 'title', ''), v_q), 300), f ->> 'feed_url',
            case f ->> 'adapter' when 'hn' then 'Hacker News' when 'weather' then 'Open-Meteo' else 'Google News' end, 24, now(), v_q, v_uid)
    returning id into v_id;
    insert into public.knowledge_collection_members (project_id, collection_id, source_id, created_by) values (p_project, v_world, v_id, v_uid);
    n := n + 1;
  end loop;
  perform public.studio_audit(p_project, v_uid, 'user', 'knowledge.world_watch_added', 'project', p_project, jsonb_build_object('query', v_q));
  return n;
end $$;

create or replace function public.kb_world_watch_remove(p_project uuid, p_query text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; r record;
begin
  v_uid := public.studio_require(p_project, 3, 'follow the world');
  for r in select id from public.knowledge_sources where project_id = p_project and archived_at is null and watch_character is null and lower(watch_query) = lower(btrim(p_query)) loop
    update public.knowledge_items i set archived_at = now()
     where i.source_id = r.id and i.archived_at is null and not i.pinned
       and not exists (select 1 from public.character_impressions c where c.item_id = i.id and c.status <> 'dismissed');
    update public.knowledge_sources set disconnected_at = coalesce(disconnected_at, now()), watch_query = null,
           title = left('Stopped: ' || title, 300), updated_at = now() where id = r.id;
  end loop;
end $$;

create or replace function public.kb_feed_add(p_project uuid, p_data jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_id uuid; v_adapter text; v_hours integer; v_feed text;
begin
  v_uid := public.studio_require(p_project, 3, 'add an updating source');
  v_adapter := coalesce(p_data ->> 'adapter', 'rss');
  if v_adapter not in ('rss', 'bluesky', 'mastodon') then raise exception 'That kind of source isn''t supported.' using errcode = '22023'; end if;
  v_hours := coalesce((p_data ->> 'refresh_hours')::integer, 24);
  if v_hours not in (6, 12, 24, 72, 168) then raise exception 'Choose how often to check.' using errcode = '22023'; end if;
  v_feed := public.kb_check_url(public.kb_txt(p_data, 'feed_url', 2000));
  if v_feed is null then raise exception 'No feed address.' using errcode = '22023'; end if;
  if exists (select 1 from public.knowledge_sources where project_id = p_project and kind = 'feed' and feed_url = v_feed and archived_at is null) then
    raise exception 'That feed is already in the Knowledge Base.' using errcode = '23505';
  end if;
  -- Feeds she adds (World topics and characters' interest searches have their own limits).
  if (select count(*) from public.knowledge_sources where project_id = p_project and kind = 'feed' and archived_at is null and disconnected_at is null and watch_query is null) >= 40 then
    raise exception 'A film can follow up to 40 feeds you add yourself.' using errcode = '22023';
  end if;
  insert into public.knowledge_sources (project_id, kind, adapter, status, title, url, feed_url, origin, refresh_hours, next_refresh_at, director_note, created_by)
  values (p_project, 'feed', v_adapter, 'pending', coalesce(public.kb_txt(p_data, 'title', 300), v_feed),
          public.kb_check_url(public.kb_txt(p_data, 'url', 2000)), v_feed, public.kb_txt(p_data, 'origin', 200), v_hours, now(),
          public.kb_txt(p_data, 'director_note', 4000), v_uid)
  returning id into v_id;
  perform public.kb_collections_assign(p_project, v_uid, v_id, p_data -> 'collections');
  perform public.studio_audit(p_project, v_uid, 'user', 'knowledge.feed_added', 'knowledge_source', v_id, jsonb_build_object('adapter', v_adapter));
  return v_id;
end $$;

-- A character's interest: a topic in their bubble, searched daily in the news.
create or replace function public.kb_character_watch_add(p_project uuid, p_character uuid, p_query text, p_feeds jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_coll uuid; f jsonb; v_id uuid; n integer := 0; v_q text := btrim(coalesce(p_query, ''));
begin
  v_uid := public.studio_require(p_project, 3, 'develop a character');
  perform public.character_check(p_project, p_character);
  if not public.bubble_tracked(p_character) then
    raise exception 'Interests are for protagonists, antagonists and supporting characters.' using errcode = '22023';
  end if;
  if length(v_q) not between 2 and 60 then raise exception 'An interest is a few words (up to 60 characters).' using errcode = '22023'; end if;
  if jsonb_typeof(p_feeds) <> 'array' or jsonb_array_length(p_feeds) not between 0 and 2 then raise exception 'Bad searches.' using errcode = '22023'; end if;
  if exists (select 1 from public.knowledge_sources where project_id = p_project and archived_at is null and watch_character = p_character and lower(watch_query) = lower(v_q)) then
    raise exception 'They already follow that.' using errcode = '23505';
  end if;
  if (select count(distinct lower(watch_query)) from public.knowledge_sources where project_id = p_project and archived_at is null and watch_character = p_character) >= 12 then
    raise exception 'Up to 12 searched interests per character. Remove one first.' using errcode = '22023';
  end if;
  for f in select * from jsonb_array_elements(p_feeds) loop
    if not ((f ->> 'adapter' = 'rss' and (f ->> 'feed_url') ~ '^https://news\.google\.com/rss/search\?')
         or (f ->> 'adapter' = 'hn' and (f ->> 'feed_url') ~ '^https://hn\.algolia\.com/api/v1/search_by_date\?')) then
      raise exception 'Unknown free source.' using errcode = '22023';
    end if;
  end loop;
  v_coll := public.kb_character_collection(p_project, p_character);
  for f in select * from jsonb_array_elements(p_feeds) loop
    insert into public.knowledge_sources (project_id, kind, adapter, status, title, feed_url, origin, refresh_hours, next_refresh_at, watch_query, watch_character, created_by)
    values (p_project, 'feed', f ->> 'adapter', 'pending', left(coalesce(nullif(f ->> 'title', ''), v_q), 300), f ->> 'feed_url',
            case f ->> 'adapter' when 'hn' then 'Hacker News' else 'Google News' end, 24, now(), v_q, p_character, v_uid)
    returning id into v_id;
    insert into public.knowledge_collection_members (project_id, collection_id, source_id, created_by) values (p_project, v_coll, v_id, v_uid);
    n := n + 1;
  end loop;
  -- The interest is also one of the topics their coverage is picked by.
  insert into public.character_bubbles (character_id, project_id, topics, updated_by) values (p_character, p_project, array[left(v_q, 60)], v_uid)
  on conflict (character_id) do update
     set topics = case when exists (select 1 from unnest(public.character_bubbles.topics) t where lower(t) = lower(v_q)) or cardinality(public.character_bubbles.topics) >= 12
                       then public.character_bubbles.topics else public.character_bubbles.topics || left(v_q, 60) end,
         version = public.character_bubbles.version + 1, updated_by = v_uid, updated_at = now();
  return n;
end $$;

create or replace function public.kb_character_watch_remove(p_project uuid, p_character uuid, p_query text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; r record; v_q text := btrim(coalesce(p_query, ''));
begin
  v_uid := public.studio_require(p_project, 3, 'develop a character');
  perform public.character_check(p_project, p_character);
  for r in select id from public.knowledge_sources where project_id = p_project and archived_at is null and watch_character = p_character and lower(watch_query) = lower(v_q) loop
    update public.knowledge_items i set archived_at = now()
     where i.source_id = r.id and i.archived_at is null and not i.pinned
       and not exists (select 1 from public.character_impressions c where c.item_id = i.id and c.status <> 'dismissed');
    update public.knowledge_sources set disconnected_at = coalesce(disconnected_at, now()), watch_query = null,
           title = left('Stopped: ' || title, 300), updated_at = now() where id = r.id;
  end loop;
  update public.character_bubbles set topics = array(select t from unnest(topics) t where lower(t) <> lower(v_q)),
         version = version + 1, updated_by = v_uid, updated_at = now()
   where character_id = p_character;
end $$;

-- Before a small model call that suggests interests: access and budget.
create or replace function public.interests_ai_check(p_project uuid, p_character uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'develop a character');
  perform public.character_check(p_project, p_character);
  if public.studio_ai_budget_usd(p_project) - public.studio_ai_spent_month_usd(p_project) < 0.02 then
    raise exception 'The team has used this month''s AI budget. Ask your Executive Producer.' using errcode = 'PT402';
  end if;
  return v_uid;
end $$;

do $$ declare f text;
begin
  foreach f in array array['kb_character_watch_add(uuid, uuid, text, jsonb)', 'kb_character_watch_remove(uuid, uuid, text)', 'interests_ai_check(uuid, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

commit;
