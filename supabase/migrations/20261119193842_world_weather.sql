-- World watches can bring in daily weather reports for the story's real cities
-- (Open-Meteo: free, no key). A watch holds one or two free feeds.
begin;

alter table public.knowledge_sources drop constraint if exists knowledge_sources_adapter_check;
alter table public.knowledge_sources add constraint knowledge_sources_adapter_check
  check (adapter in ('manual', 'rss', 'bluesky', 'mastodon', 'gdelt', 'hn', 'weather'));

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

revoke all on function public.kb_world_watch_add(uuid, text, jsonb) from public, anon;
grant execute on function public.kb_world_watch_add(uuid, text, jsonb) to authenticated, service_role;

commit;
