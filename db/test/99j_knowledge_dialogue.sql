-- STUDIO — Knowledge Base, character knowledge connections, scene time, dialogue proposals.
\set ON_ERROR_STOP 1
\pset footer off
set client_min_messages = warning;

\set as_dir      'reset role; select tests.claims(''dir'');      set role authenticated;'
\set as_outsider 'reset role; select tests.claims(''outsider''); set role authenticated;'
\set as_service  'reset role; select set_config(''request.jwt.claims'', '''', false); set role service_role;'
\set as_owner    'reset role;'

:as_owner
delete from tests.results;

-- ---- Research library ----------------------------------------------------------------------
:as_dir
select tests.put('KA', public.create_project('Knowledge film A', 'x'));
select tests.put('KB', public.create_project('Knowledge film B', 'y'));
select tests.put('johnny', public.create_entity(tests.v('KA'), 'character', 'Johnny', '{"summary":"Analyst"}'));
select tests.put('marie', public.create_entity(tests.v('KA'), 'character', 'Marie', '{"summary":"Journalist"}'));
select tests.put('c_ai', public.kb_collection_save(tests.v('KA'), null, 'AI development', null));
select tests.put('c_chips', public.kb_collection_save(tests.v('KA'), null, 'Semiconductor industry', null));
select tests.throws(format($q$select public.kb_collection_save(%L, null, ' ai development ', null)$q$, tests.v('KA')), '23505', 'collection names are unique per film');

select tests.put('note1', public.kb_research_save(tests.v('KA'), null, jsonb_build_object('kind', 'note', 'title', 'Fab notes',
  'body', 'Chip fabs need extreme ultraviolet lithography.', 'collections', jsonb_build_array(tests.v('c_chips'), tests.v('c_ai')))));
select tests.ok((select status from public.knowledge_sources where id = tests.v('note1')) = 'imported', 'a note is imported content');
select tests.ok((select count(*) from public.knowledge_items where source_id = tests.v('note1')) = 1
  and (select count(*) from public.knowledge_collection_members where source_id = tests.v('note1')) = 2, 'one item in two collections, not duplicated');

select tests.put('link1', public.kb_research_save(tests.v('KA'), null, '{"kind":"link","url":"https://example.org/a","title":"An article"}'));
select tests.ok((select status from public.knowledge_sources where id = tests.v('link1')) = 'link_saved'
  and (select content_status from public.knowledge_items where source_id = tests.v('link1')) = 'metadata_only', 'a URL alone is only a saved link');
select public.kb_research_save(tests.v('KA'), tests.v('link1'), '{"body":"A short excerpt she is allowed to keep."}');
select tests.ok((select status from public.knowledge_sources where id = tests.v('link1')) = 'imported'
  and (select version from public.knowledge_items where source_id = tests.v('link1')) = 2, 'adding an excerpt imports it as a new version');
select tests.ok((select published_at from public.knowledge_items where source_id = tests.v('link1')) is null, 'an unknown date stays unknown');
select tests.throws(format($q$select public.kb_research_save(%L, null, '{"kind":"link","url":"javascript:alert(1)"}')$q$, tests.v('KA')), '22023', 'only web addresses');
select tests.throws(format($q$select public.kb_research_save(%L, null, jsonb_build_object('kind','note','body','x','collections',jsonb_build_array(%L)))$q$,
  tests.v('KB'), tests.v('c_ai')), '22023', 'a collection from another film cannot be used');

-- Documents: only the Knowledge Base accepts PDFs / Word / text; artwork stays PNG/JPEG.
select tests.throws(format($q$select * from public.begin_asset_upload(%L, 'a.pdf', 'application/pdf', 100)$q$, tests.v('johnny')), '22023', 'other parts of the film still accept only images');
select tests.put('kbowner', public.kb_owner_entity(tests.v('KA')));
select tests.put('doc1', (select asset_id from public.begin_asset_upload(tests.v('kbowner'), 'brief.pdf', 'application/pdf', 1000)));
:as_owner
select tests.ok((select kind::text from public.assets where id = tests.v('doc1')) = 'document', 'a research PDF is stored as a document');
:as_dir
select tests.throws(format($q$select * from public.begin_asset_upload(%L, 'big.pdf', 'application/pdf', 30000000)$q$, tests.v('kbowner')), '22023', 'documents are limited to 20 MB');

-- Isolation
:as_outsider
select tests.ok((select count(*) from public.knowledge_items where project_id = tests.v('KA')) = 0, 'outsiders see no research');
select tests.throws(format($q$select public.kb_research_save(%L, null, '{"kind":"note","body":"x"}')$q$, tests.v('KA')), 'PT404', 'outsiders cannot add research');
:as_dir
select tests.ok((select count(*) from public.kb_search(tests.v('KB'), array[tests.v('c_ai')], array['ultraviolet'], 5)) = 0, 'search is scoped to the film');
select tests.ok((select count(*) from public.kb_search(tests.v('KA'), array[tests.v('c_chips')], array['ultraviolet'], 5)) = 1, 'keyword search finds research');

-- ---- Feeds ------------------------------------------------------------------------------------
select tests.put('feed1', public.kb_feed_add(tests.v('KA'), jsonb_build_object('feed_url', 'https://news.example/rss', 'refresh_hours', 24,
  'collections', jsonb_build_array(tests.v('c_ai')))));
select tests.ok((select status from public.knowledge_sources where id = tests.v('feed1')) = 'pending', 'a new feed is pending until it refreshes');
select tests.throws(format($q$select public.kb_feed_ingest(%L, '[]', '{}')$q$, tests.v('feed1')), '42501', 'only the server stores feed items');
select tests.throws($q$select http_etag from public.knowledge_sources$q$, '42501', 'feed validators are server-only');

:as_service
select tests.ok((select count(*) from public.kb_feed_claim(tests.v('feed1'), false)) = 1, 'the server claims a due feed');
select tests.ok((select count(*) from public.kb_feed_claim(tests.v('feed1'), true)) = 0, 'no overlapping refreshes');
select public.kb_feed_ingest(tests.v('feed1'), jsonb_build_array(
  jsonb_build_object('key', 'g1', 'title', 'Lab releases model', 'content', 'A lab released a model.', 'published_at', '2026-11-10T09:00:00Z'),
  jsonb_build_object('key', 'g2', 'title', 'Chip export rule', 'content', 'New export rules.', 'published_at', '2026-11-18T09:00:00Z'),
  jsonb_build_object('key', 'g3', 'title', 'Undated post', 'content', 'No date given.')), '{"title":"Example News"}');
select tests.ok((select status from public.knowledge_sources where id = tests.v('feed1')) = 'connected'
  and (select last_success_at from public.knowledge_sources where id = tests.v('feed1')) is not null, 'a successful refresh is connected, with time');
select tests.ok((select public.kb_feed_ingest(tests.v('feed1'), jsonb_build_array(
  jsonb_build_object('key', 'g1', 'title', 'Lab releases model', 'content', 'A lab released a model.', 'published_at', '2026-11-10T09:00:00Z'),
  jsonb_build_object('key', 'g2', 'title', 'Chip export rule', 'content', 'New export rules, updated.', 'published_at', '2026-11-18T09:00:00Z')), '{}'))
  = '{"new": 0, "changed": 1}'::jsonb, 'duplicates are ignored; a changed item gets a new version');
select tests.ok((select count(*) from public.knowledge_item_versions v join public.knowledge_items i on i.id = v.item_id
  where i.source_id = tests.v('feed1') and i.dedupe_key = 'g2') = 2, 'earlier versions are kept');
update public.knowledge_sources set last_attempt_at = now() - interval '2 minutes' where id = tests.v('feed1');
select public.kb_feed_fail(tests.v('feed1'), 'HTTP 500', null);
select tests.ok((select status from public.knowledge_sources where id = tests.v('feed1')) = 'error'
  and (select count(*) from public.knowledge_items where source_id = tests.v('feed1') and archived_at is null) = 3,
  'a failed refresh keeps every collected item');
select tests.ok((select count(*) from public.dialogue_proposals where project_id = tests.v('KA')) = 0, 'feed refreshes create no dialogue');

:as_dir
select public.kb_feed_update(tests.v('KA'), tests.v('feed1'), '{"paused": true}');
:as_service
select tests.ok((select count(*) from public.kb_feed_claim(tests.v('feed1'), false)) = 0, 'a paused feed is not refreshed on schedule');
:as_dir
select public.kb_feed_update(tests.v('KA'), tests.v('feed1'), '{"paused": false, "disconnected": true}');
select tests.ok((select count(*) from public.knowledge_items where source_id = tests.v('feed1')) = 3, 'disconnecting keeps saved material');
select tests.throws(format($q$select public.kb_feed_request_refresh(%L, %L)$q$, tests.v('KA'), tests.v('feed1')), '22023', 'a disconnected feed must be reconnected first');
select public.kb_feed_update(tests.v('KA'), tests.v('feed1'), '{"disconnected": false}');

-- ---- Characters and connections -------------------------------------------------------------
select tests.ok(public.character_profile_save(tests.v('KA'), tests.v('johnny'), null, '{"expertise":"Semiconductor analyst","conceals":"His doubts"}') = 1, 'profile saved');
select tests.throws(format($q$select public.character_profile_save(%L, %L, 7, '{}')$q$, tests.v('KA'), tests.v('johnny')), 'PT409', 'stale profile edits are refused');
select tests.throws(format($q$select public.character_profile_save(%L, %L, 1, '{"ssn":"x"}')$q$, tests.v('KA'), tests.v('johnny')), '22023', 'only known fields');

select tests.put('link_j', public.character_knowledge_save(tests.v('KA'), null, jsonb_build_object('character_id', tests.v('johnny'),
  'collection_id', tests.v('c_ai'), 'purpose', 'story_info', 'temporal', 'story_dated', 'scope_terms', jsonb_build_array('model', 'chip'))));
select tests.throws(format($q$select public.character_knowledge_save(%L, null, jsonb_build_object('character_id', %L, 'collection_id', %L, 'purpose', 'story_info', 'temporal', 'story_dated'))$q$,
  tests.v('KA'), tests.v('johnny'), tests.v('c_ai')), '23505', 'one connection per character and collection');
select tests.throws(format($q$select public.character_knowledge_save(%L, null, jsonb_build_object('character_id', %L, 'collection_id', %L, 'purpose', 'story_info', 'temporal', 'story_dated'))$q$,
  tests.v('KB'), tests.v('johnny'), tests.v('c_ai')), 'PT404', 'a character from another film cannot be connected');
select public.character_knowledge_remove(tests.v('KA'), tests.v('link_j'));
select tests.ok(exists (select 1 from public.entities where id = tests.v('johnny')) and
  exists (select 1 from public.knowledge_collections where id = tests.v('c_ai') and archived_at is null), 'disconnecting deletes neither record');
select tests.put('link_j2', public.character_knowledge_save(tests.v('KA'), null, jsonb_build_object('character_id', tests.v('johnny'),
  'collection_id', tests.v('c_ai'), 'purpose', 'story_info', 'temporal', 'story_dated')));

-- ---- Scenes and dialogue ------------------------------------------------------------------
select tests.put('beat1', public.add_notebook_item(tests.v('KA'), 'beginning', 'Johnny reads the news and calls Marie.'));
select tests.ok(public.scene_context_save(tests.v('KA'), 'b:' || tests.v('beat1') || ':1', jsonb_build_object('beat_id', tests.v('beat1'),
  'story_date', '2026-11-12', 'objectives', jsonb_build_object(tests.v('johnny'), 'Get Marie to listen'))) = 1, 'scene context saved');
select tests.throws(format($q$select public.scene_context_save(%L, 'x', '{}')$q$, tests.v('KA')), '22023', 'scene keys are checked');

select tests.throws(format($q$select * from public.dialogue_request(%L, %L, jsonb_build_object('trigger','auto','request_hash', repeat('a', 64)))$q$,
  tests.v('KA'), 'b:' || tests.v('beat1') || ':1'), '22023', 'Auto-draft requests are refused while it is off');
select tests.put('p1', (select proposal_id from public.dialogue_request(tests.v('KA'), 'b:' || tests.v('beat1') || ':1',
  jsonb_build_object('request_hash', repeat('a', 64), 'beat_id', tests.v('beat1')))));
select tests.ok((select existing from public.dialogue_request(tests.v('KA'), 'b:' || tests.v('beat1') || ':1',
  jsonb_build_object('request_hash', repeat('a', 64)))) and (select count(*) from public.dialogue_proposals where project_id = tests.v('KA')) = 1,
  'an unchanged request is not generated twice');
select tests.put('p2', (select proposal_id from public.dialogue_request(tests.v('KA'), 'b:' || tests.v('beat1') || ':1', jsonb_build_object('request_hash', repeat('b', 64)))));
select tests.put('p3', (select proposal_id from public.dialogue_request(tests.v('KA'), 'b:' || tests.v('beat1') || ':1', jsonb_build_object('request_hash', repeat('c', 64)))));
select tests.throws(format($q$select * from public.dialogue_request(%L, %L, jsonb_build_object('request_hash', repeat('d', 64)))$q$,
  tests.v('KA'), 'b:' || tests.v('beat1') || ':1'), 'PT409', 'at most three drafts in progress');
select public.dialogue_cancel(tests.v('KA'), tests.v('p3'));
select tests.ok((select status from public.dialogue_proposals where id = tests.v('p3')) = 'cancelled', 'a waiting draft can be cancelled');

:as_service
select tests.ok(public.dialogue_claim(tests.v('p1')), 'the server claims a draft');
select tests.ok(not public.dialogue_claim(tests.v('p2')), 'one draft at a time per film');
select public.dialogue_complete(tests.v('p1'), '{"elements":[{"type":"dialogue","speaker":"JOHNNY","text":"Listen.","basis":"invention"}]}',
  jsonb_build_array(jsonb_build_object('item_id', (select id from public.knowledge_items where dedupe_key = 'g1' and source_id = tests.v('feed1')), 'version', 1)),
  '{"model":"test"}', '{}', 0, 'test');
select tests.ok((select status from public.dialogue_proposals where id = tests.v('p1')) = 'ready'
  and (select snapshot_id from public.dialogue_proposals where id = tests.v('p1')) is not null, 'a finished draft is ready, with its research snapshot');
select tests.ok(public.dialogue_claim(tests.v('p2')), 'the next draft can start');
select public.dialogue_fail(tests.v('p2'), 'Model unavailable', '{}', 0);
select tests.ok((select status from public.dialogue_proposals where id = tests.v('p2')) = 'failed'
  and (select status from public.dialogue_proposals where id = tests.v('p1')) = 'ready', 'a failure keeps the previous draft');

:as_dir
select tests.throws(format($q$select public.dialogue_decide(%L, %L, 'accept', null, null)$q$, tests.v('KA'), tests.v('p1')), '22023', 'accepting needs her saved script revision');
select tests.put('sp', public.open_screenplay(tests.v('KA')));
select tests.put('sp_v', public.create_revision(tests.v('sp'), '{"body":"INT. ROOM - DAY\n\nJOHNNY\nListen."}', 'accepted dialogue'));
select public.dialogue_decide(tests.v('KA'), tests.v('p1'), 'accept', tests.v('sp_v'), null);
select tests.ok((select status from public.dialogue_proposals where id = tests.v('p1')) = 'accepted', 'accepted');
-- Later research does not touch accepted dialogue.
:as_service
update public.knowledge_sources set last_attempt_at = null where id = tests.v('feed1');
select public.kb_feed_ingest(tests.v('feed1'), jsonb_build_array(jsonb_build_object('key', 'g1', 'title', 'Lab releases model', 'content', 'Correction: two models.')), '{}');
select tests.ok((select status from public.dialogue_proposals where id = tests.v('p1')) = 'accepted'
  and (select (items -> 0 ->> 'version')::int from public.knowledge_snapshots where id = (select snapshot_id from public.dialogue_proposals where id = tests.v('p1'))) = 1,
  'accepted dialogue and its pinned research version survive later updates');
:as_dir
select public.dialogue_decide(tests.v('KA'), tests.v('p2'), 'reject', null, null);
select public.dialogue_decide(tests.v('KA'), tests.v('p2'), 'restore', null, null);
select tests.ok((select status from public.dialogue_proposals where id = tests.v('p2')) = 'ready', 'an earlier draft can be restored for review');

select public.dialogue_settings_save(tests.v('KA'), true, false);
select tests.ok((select existing from public.dialogue_request(tests.v('KA'), 'b:' || tests.v('beat1') || ':1',
  jsonb_build_object('trigger','auto','request_hash', repeat('e', 64)))) = false, 'Auto-draft works once she turns it on');
select public.dialogue_settings_save(tests.v('KA'), null, true);
select tests.ok((select count(*) from public.dialogue_proposals where project_id = tests.v('KA') and trigger = 'auto' and status = 'queued') = 0,
  'pausing Auto-draft cancels its waiting jobs');

:as_outsider
select tests.ok((select count(*) from public.dialogue_proposals where project_id = tests.v('KA')) = 0, 'outsiders see no drafts');
select tests.throws(format($q$select public.dialogue_claim(%L)$q$, tests.v('p2')), '42501', 'drafting is server-only');

:as_owner
select n, case when passed then 'PASS' else 'FAIL' end as result, label, detail from tests.results where not passed order by n;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from tests.results;
do $$ begin
  if exists (select 1 from tests.results where not passed) then
    raise exception 'Knowledge & dialogue test suite FAILED';
  end if;
end $$;
