-- STUDIO — World knowledge base, World searches, impressions.
\set ON_ERROR_STOP 1
\pset footer off
set client_min_messages = warning;
\set as_dir      'reset role; select tests.claims(''dir'');      set role authenticated;'
\set as_outsider 'reset role; select tests.claims(''outsider''); set role authenticated;'
\set as_service  'reset role; select set_config(''request.jwt.claims'', '''', false); set role service_role;'
\set as_owner    'reset role;'

:as_owner
delete from tests.results;
:as_dir
select tests.put('W', public.create_project('World film', 'x'));
select tests.put('wa', public.create_entity(tests.v('W'), 'character', 'Ada', '{"summary":"x"}'));
select tests.put('wb', public.create_entity(tests.v('W'), 'character', 'Bo', '{"summary":"x"}'));
select tests.put('world', (select collection_id from public.kb_world_collection(tests.v('W'), false)));
select tests.ok((select kind from public.knowledge_collections where id = tests.v('world')) = 'world', 'World collection made');
select tests.ok((select count(*) from public.character_knowledge where collection_id = tests.v('world') and archived_at is null
  and purpose = 'story_info' and temporal = 'story_dated') = 2, 'connected to every character as story-dated knowledge');
select tests.ok((select collection_id from public.kb_world_collection(tests.v('W'), false)) = tests.v('world'), 'one World per film');
select public.character_knowledge_remove(tests.v('W'), (select id from public.character_knowledge where collection_id = tests.v('world') and character_id = tests.v('wb')));
select tests.put('wc', public.create_entity(tests.v('W'), 'character', 'Cy', '{"summary":"x"}'));
select tests.ok((select connected from public.kb_world_collection(tests.v('W'), true)) = 1
  and not exists (select 1 from public.character_knowledge where collection_id = tests.v('world') and character_id = tests.v('wb') and archived_at is null),
  'connecting everyone adds new characters and respects one she removed');

select tests.ok(public.kb_world_watch_add(tests.v('W'), 'chip export rules', jsonb_build_array(
  jsonb_build_object('adapter', 'rss', 'feed_url', 'https://news.google.com/rss/search?q=x', 'title', 'News: chip export rules'),
  jsonb_build_object('adapter', 'hn', 'feed_url', 'https://hn.algolia.com/api/v1/search_by_date?query=x', 'title', 'Reactions: chip export rules'))) = 2, 'a watch adds free news and reaction feeds');
select tests.throws(format($q$select public.kb_world_watch_add(%L, 'x', jsonb_build_array(jsonb_build_object('adapter', 'rss', 'feed_url', 'https://evil.example/?', 'title', 't')))$q$, tests.v('W')),
  '22023', 'only the free sources Studio builds');
select tests.throws(format($q$select public.kb_world_watch_add(%L, 'Chip Export Rules', jsonb_build_array(jsonb_build_object('adapter', 'hn', 'feed_url', 'https://hn.algolia.com/api/v1/search_by_date?q', 'title', 't')))$q$, tests.v('W')),
  '23505', 'no duplicate watches');
select public.kb_world_watch_add(tests.v('W'), 'watch ' || g, jsonb_build_array(jsonb_build_object('adapter', 'hn', 'feed_url', 'https://hn.algolia.com/api/v1/search_by_date?query=' || g, 'title', 't')))
  from generate_series(2, 10) g;
select tests.throws(format($q$select public.kb_world_watch_add(%L, 'one more', jsonb_build_array(jsonb_build_object('adapter', 'hn', 'feed_url', 'https://hn.algolia.com/api/v1/search_by_date?q', 'title', 't')))$q$, tests.v('W')),
  '22023', 'at most 10 watches');
select tests.put('gsrc', (select id from public.knowledge_sources where project_id = tests.v('W') and adapter = 'rss'));
select tests.ok((select count(*) from public.kb_collection_items(tests.v('W'), array[tests.v('world')])) = 0, 'empty until refreshed');
:as_service
select public.kb_feed_ingest(tests.v('gsrc'), (select jsonb_agg(jsonb_build_object('key', 'k' || g, 'title', 'Story ' || g, 'url', 'https://news.example/' || g,
  'published_at', (timestamptz '2026-11-01' + g * interval '1 hour')::text)) from generate_series(1, 20) g), '{}');
:as_dir
select public.kb_item_pin(tests.v('W'), (select id from public.knowledge_items where source_id = tests.v('gsrc') and dedupe_key = 'k1'), true);
:as_service
select tests.ok(public.kb_trim_watch(tests.v('gsrc')) = 4, 'trimming keeps the newest 15 plus kept items');
:as_dir
select tests.ok((select count(*) from public.knowledge_items where source_id = tests.v('gsrc') and archived_at is null) = 16
  and exists (select 1 from public.knowledge_items where source_id = tests.v('gsrc') and dedupe_key = 'k1' and archived_at is null), 'the kept item survives');
select tests.put('item', (select id from public.knowledge_items where source_id = tests.v('gsrc') and dedupe_key = 'k20'));
select tests.put('run', public.impression_request(tests.v('W'), tests.v('wa'), tests.v('item')));
:as_service
select tests.put('imp', public.impression_complete(tests.v('run'), 'It feels like the ground moved.', 1, 0, '{}', 0.002, 'test'));
:as_dir
select tests.ok((select status from public.character_impressions where id = tests.v('imp')) = 'proposed', 'an impression is proposed');
select public.impression_decide(tests.v('W'), tests.v('imp'), true, 'It feels like the floor tilted.');
select tests.ok((select status || ':' || text from public.character_impressions where id = tests.v('imp')) = 'accepted:It feels like the floor tilted.', 'accepted with her edit');
select public.kb_world_watch_remove(tests.v('W'), 'chip export rules');
select tests.ok((select count(*) from public.kb_collection_items(tests.v('W'), array[tests.v('world')])) = 2,
  'removing a watch keeps the kept item and the one with an impression');
:as_outsider
select tests.ok((select count(*) from public.character_impressions where project_id = tests.v('W')) = 0, 'outsiders see nothing');
select tests.throws(format($q$select public.kb_world_watch_add(%L, 'x y z', '[]')$q$, tests.v('W')), 'PT404', 'outsiders cannot follow');
:as_owner
select n, label from tests.results where not passed order by n;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from tests.results;
do $$ begin if exists (select 1 from tests.results where not passed) then raise exception 'World test suite FAILED'; end if; end $$;
