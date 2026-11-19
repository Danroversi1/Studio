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

select tests.put('s1', public.world_search_request(tests.v('W'), 'AI chip export rules and reactions', 'both', 'month'));
select tests.throws(format($q$select public.world_search_request(%L, 'again', 'both', 'month')$q$, tests.v('W')), 'PT409', 'one search at a time');
select tests.throws(format($q$select public.world_search_complete(%L, '[]', '[]', 0, '{}', 0, 'x')$q$, tests.v('s1')), '42501', 'only the server completes searches');
:as_service
select public.world_search_complete(tests.v('s1'), jsonb_build_array(
  jsonb_build_object('id', 'r1', 'kind', 'news', 'title', 'Export rules tighten', 'url', 'https://news.example/a', 'source', 'Example News', 'published', '2026-11-10', 'summary', 'Rules tightened.', 'why', 'Johnny works in chips.'),
  jsonb_build_object('id', 'r2', 'kind', 'reaction', 'title', 'Engineers react', 'url', 'https://blog.example/b', 'source', 'A blog', 'published', '', 'summary', 'Mixed feelings.', 'why', '')),
  '["chip export rules"]', 2, '{}', 0.03, 'test');
:as_dir
select tests.ok(public.world_search_keep(tests.v('W'), tests.v('s1'), array['r1', 'r2']) = 2, 'kept two findings');
select tests.ok((select count(*) from public.kb_collection_items(tests.v('W'), array[tests.v('world')])) = 2, 'they are in World');
select tests.ok((select content_status from public.knowledge_items i join public.knowledge_sources s on s.id = i.source_id where s.url = 'https://news.example/a') = 'ai_summary'
  and (select published_at::date from public.knowledge_items i join public.knowledge_sources s on s.id = i.source_id where s.url = 'https://news.example/a') = date '2026-11-10'
  and (select published_at from public.knowledge_items i join public.knowledge_sources s on s.id = i.source_id where s.url = 'https://blog.example/b') is null,
  'summaries are labeled; a missing date stays unknown');
select tests.ok(public.world_search_keep(tests.v('W'), tests.v('s1'), array['r1']) = 1
  and (select count(*) from public.knowledge_sources where project_id = tests.v('W') and url = 'https://news.example/a') = 1, 'keeping twice does not duplicate');

select tests.put('item', (select i.id from public.knowledge_items i join public.knowledge_sources s on s.id = i.source_id where s.url = 'https://news.example/a'));
select tests.put('run', public.impression_request(tests.v('W'), tests.v('wa'), tests.v('item')));
:as_service
select tests.put('imp', public.impression_complete(tests.v('run'), 'It feels like the ground moved.', 1, 0, '{}', 0.002, 'test'));
:as_dir
select tests.ok((select status from public.character_impressions where id = tests.v('imp')) = 'proposed', 'an impression is proposed');
select public.impression_decide(tests.v('W'), tests.v('imp'), true, 'It feels like the floor tilted.');
select tests.ok((select status || ':' || text from public.character_impressions where id = tests.v('imp')) = 'accepted:It feels like the floor tilted.', 'accepted with her edit');
:as_outsider
select tests.ok((select count(*) from public.world_searches where project_id = tests.v('W')) = 0
  and (select count(*) from public.character_impressions where project_id = tests.v('W')) = 0, 'outsiders see nothing');
select tests.throws(format($q$select public.world_search_request(%L, 'x y z', 'both', 'month')$q$, tests.v('W')), 'PT404', 'outsiders cannot search');
:as_owner
select n, label from tests.results where not passed order by n;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from tests.results;
do $$ begin if exists (select 1 from tests.results where not passed) then raise exception 'World test suite FAILED'; end if; end $$;
