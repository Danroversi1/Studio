-- STUDIO — Storyboards: frames with editable compositions, versions, duplicate, reorder,
-- shared library with scoped replacement, optional AI jobs, Shot Builder focus.
\set ON_ERROR_STOP 1
\pset footer off
set client_min_messages = warning;

\set as_dir      'reset role; select tests.claims(''dir'');      set role authenticated;'
\set as_viewer   'reset role; select tests.claims(''viewer'');   set role authenticated;'
\set as_reviewer 'reset role; select tests.claims(''reviewer''); set role authenticated;'
\set as_service  'reset role; select set_config(''request.jwt.claims'', '''', false); set role service_role;'
\set as_owner    'reset role;'

:as_owner
delete from tests.results;

:as_reviewer
select tests.throws(format($q$select public.storyboard_create(%L, 'Opening', '', '{}')$q$, tests.v('A')), '42501', 'review access cannot make storyboards');
:as_dir
select tests.put('sb', public.storyboard_create(tests.v('A'), 'Opening', 'Johnny in the coffee shop', '{"paths":["text"]}'));
select tests.ok((select e.kind::text from public.storyboard_sequences s join public.entities e on e.id = s.entity_id where s.id = tests.v('sb')) = 'storyboard',
  'a storyboard is a project entity of kind storyboard');
select tests.put('s1', public.storyboard_shot_save(tests.v('sb'), null, '{"action":"Johnny sips coffee."}', 'director', null, null,
  '{"v":1,"aspect":1.7777,"layers":[{"id":"a","type":"shape","shape":"person-stand","x":400,"y":300,"w":100,"h":280,"rot":0,"libraryId":"LIB"}]}'));
select tests.put('s2', public.storyboard_shot_save(tests.v('sb'), null, '{"action":"An explosion outside."}', 'director', null, null, null));
select tests.put('s3', public.storyboard_shot_save(tests.v('sb'), null, '{"action":"Johnny turns."}', 'director', null, null, null));
select tests.ok((select array_agg(id order by position) from public.storyboard_shots where sequence_id = tests.v('sb'))
  = array[tests.v('s1'), tests.v('s2'), tests.v('s3')], 'frames in order');

-- Autosave updates the composition without making versions; stale writes are refused.
select tests.ok(public.storyboard_shot_compose(tests.v('s2'), '{"v":1,"layers":[{"id":"x","type":"text","text":"BOOM"}]}', 0) = 1, 'autosave returns the new version');
select tests.ok((select count(*) from public.storyboard_shot_revisions where shot_id = tests.v('s2')) = 1, 'autosave makes no version row');
select tests.throws(format($q$select public.storyboard_shot_compose(%L, '{"layers":[]}', 0)$q$, tests.v('s2')), 'PT409', 'a stale autosave is refused');
select tests.throws(format($q$select public.storyboard_shot_compose(%L, jsonb_build_object('layers', (select jsonb_agg(jsonb_build_object('id', g)) from generate_series(1, 301) g)), 1)$q$, tests.v('s2')),
  '22023', 'layer limit enforced');
-- Save makes a version; saving again unchanged doesn't.
select tests.ok(public.storyboard_shot_snapshot(tests.v('s2')) = 2, 'Save records a version');
select tests.ok(public.storyboard_shot_snapshot(tests.v('s2')) = 2, 'saving unchanged adds nothing');
select tests.ok((select composition -> 'layers' -> 0 ->> 'text' from public.storyboard_shot_revisions where shot_id = tests.v('s2') and revision = 2) = 'BOOM',
  'the version holds the composition');

-- Reordering keeps identity, versions and layers.
select public.storyboard_shot_move(tests.v('s3'), 500);
select tests.ok((select array_agg(id order by position) from public.storyboard_shots where sequence_id = tests.v('sb'))
  = array[tests.v('s3'), tests.v('s1'), tests.v('s2')], 'reordered');
select tests.ok((select revision || ':' || composition_version from public.storyboard_shots where id = tests.v('s3')) = '1:0', 'reordering changes nothing else');

-- Duplicate: right after the original, independent composition, no source carried over.
select tests.put('d1', public.storyboard_shot_duplicate(tests.v('s1'), null));
select tests.ok((select array_agg(id order by position) from public.storyboard_shots where sequence_id = tests.v('sb'))
  = array[tests.v('s3'), tests.v('s1'), tests.v('d1'), tests.v('s2')], 'the copy comes right after');
select public.storyboard_shot_compose(tests.v('d1'), '{"v":1,"layers":[]}', 0);
select tests.ok((select jsonb_array_length(composition -> 'layers') from public.storyboard_shots where id = tests.v('s1')) = 1, 'editing the copy leaves the original alone');

-- Approval, edits, locking, restore.
select public.storyboard_shot_state(tests.v('s2'), 'approved', null);
select tests.ok((select state || ':' || approved_revision from public.storyboard_shots where id = tests.v('s2')) = 'approved:2', 'approval records the version');
select public.storyboard_shot_compose(tests.v('s2'), '{"v":1,"layers":[{"id":"x","type":"text","text":"BANG"}]}', 1);
select tests.ok((select state from public.storyboard_shots where id = tests.v('s2')) = 'proposed', 'changing an approved frame makes it a proposal');
select public.storyboard_shot_restore(tests.v('s2'), 2);
select tests.ok((select composition -> 'layers' -> 0 ->> 'text' from public.storyboard_shots where id = tests.v('s2')) = 'BOOM', 'an earlier version can be brought back');
select tests.ok((select count(*) from public.storyboard_shot_revisions where shot_id = tests.v('s2') and composition -> 'layers' -> 0 ->> 'text' = 'BANG') = 1,
  'the replaced version is kept');
select public.storyboard_shot_state(tests.v('s1'), null, true);
select tests.throws(format($q$select public.storyboard_shot_compose(%L, '{"layers":[]}', null)$q$, tests.v('s1')), '22023', 'locked frames cannot be edited');
select tests.throws(format($q$select public.storyboard_shot_archive(%L)$q$, tests.v('s1')), '22023', 'locked frames cannot be removed');

-- Library: link-only references stay reference-only; shared replacement needs the right scope.
:as_owner
insert into public.assets (id, project_id, entity_id, kind, origin, display_name, storage_bucket, storage_key, created_by, upload_status, mime_type, file_extension)
values (gen_random_uuid(), tests.v('A'), (select entity_id from public.storyboard_sequences where id = tests.v('sb')), 'image', 'upload', 'pose.png', 'b',
        'sb-k1', tests.v('dir'), 'ready', 'image/png', 'png') returning tests.put('img', id) is null;
insert into public.assets (id, project_id, entity_id, kind, origin, display_name, storage_bucket, storage_key, created_by, upload_status, mime_type, file_extension)
values (gen_random_uuid(), tests.v('A'), (select entity_id from public.storyboard_sequences where id = tests.v('sb')), 'image', 'upload', 'pose2.png', 'b',
        'sb-k2', tests.v('dir'), 'ready', 'image/png', 'png') returning tests.put('img2', id) is null;
:as_dir
select tests.put('lib', public.storyboard_library_save(tests.v('A'), null, jsonb_build_object('kind', 'pose', 'name', 'Johnny standing', 'asset_id', tests.v('img'), 'views', 'Front view only')));
select tests.put('link', public.storyboard_library_save(tests.v('A'), null, '{"kind":"reference","name":"Pinterest board","source_url":"https://pinterest.com/x","usage":"composition","purpose":"atmosphere","note":"the fog"}'));
select tests.ok((select usage || ':' || origin from public.storyboard_library where id = tests.v('link')) = 'reference_only:link', 'a link is reference-only, not an imported image');
:as_owner
update public.storyboard_shots set composition = jsonb_build_object('layers', jsonb_build_array(jsonb_build_object('id', 'a', 'type', 'image', 'libraryId', tests.v('lib'))))
 where id in (tests.v('s3'), tests.v('d1'));
:as_dir
select tests.ok((select count(*) from public.storyboard_library_usage(tests.v('lib'))) = 2, 'usage lists the frames that share it');
select tests.throws(format($q$select public.storyboard_library_replace(%L, %L, 1)$q$, tests.v('lib'), tests.v('img2')), 'PT409', 'replacing with the wrong scope is refused');
select tests.ok(public.storyboard_library_replace(tests.v('lib'), tests.v('img2'), 2) = 2, 'replacing with the confirmed scope works');
select tests.ok((select asset_id = tests.v('img2') and previous_asset_ids = array[tests.v('img')] and version = 2 from public.storyboard_library where id = tests.v('lib')),
  'the old image is kept');

-- Optional AI jobs: idempotent; illustration links to its frame and keeps the composition.
select tests.put('j1', (select job_id from public.storyboard_job_request(tests.v('A'), 'illustrate', tests.v('s3'), null, 'openai', 'gpt-image-2', 'v1', 'p', '{}', '[]', tests.v('img'), 'key-00000001')));
select tests.ok((select existing from public.storyboard_job_request(tests.v('A'), 'illustrate', tests.v('s3'), null, 'openai', 'gpt-image-2', 'v1', 'p', '{}', '[]', tests.v('img'), 'key-00000001')),
  'the same request does not make a duplicate job');
select tests.throws(format($q$select public.storyboard_job_complete(%L, %L, '{}', 'm')$q$, tests.v('j1'), tests.v('img2')), '42501', 'directors cannot complete jobs');
:as_service
select public.storyboard_job_start(tests.v('j1'));
select public.storyboard_job_complete(tests.v('j1'), tests.v('img2'), '{"total_tokens":10}', 'gpt-image-2');
select tests.ok((select illustration_asset_id = tests.v('img2') and composition -> 'layers' -> 0 ->> 'libraryId' = tests.v('lib')::text
  from public.storyboard_shots where id = tests.v('s3')), 'the illustration is linked; the editable composition is untouched');
:as_dir
select tests.put('j2', (select job_id from public.storyboard_job_request(tests.v('A'), 'asset', null, jsonb_build_object('kind', 'background', 'name', 'Café', 'sequence_id', tests.v('sb'), 'views', 'Wide, eye level'),
  'openai', 'gpt-image-2', 'v1', 'p', '{}', '[]', null, 'key-00000002')));
:as_service
select public.storyboard_job_start(tests.v('j2'));
select tests.put('newlib', public.storyboard_job_complete(tests.v('j2'), tests.v('img'), null, 'gpt-image-2'));
select tests.ok((select kind || ':' || origin || ':' || views from public.storyboard_library where id = tests.v('newlib')) = 'background:generated:Wide, eye level',
  'a created asset is saved in the library with the views it supplies');
:as_dir
select tests.put('j3', (select job_id from public.storyboard_job_request(tests.v('A'), 'illustrate', tests.v('s3'), null, 'openai', 'gpt-image-2', 'v1', 'p', '{}', '[]', tests.v('img'), 'key-00000003')));
:as_service
select public.storyboard_job_start(tests.v('j3'));
select public.storyboard_job_fail(tests.v('j3'), 'provider timeout', null);
select tests.ok((select illustration_asset_id from public.storyboard_shots where id = tests.v('s3')) = tests.v('img2'), 'a failed job keeps the previous result');

-- Shot suggestions are a separate text run; nothing is added until she picks them.
:as_dir
select tests.put('sug', public.storyboard_suggest_request(tests.v('sb'), '{"scene":1}'));
:as_service
select public.start_agent_run(tests.v('sug'));
select public.storyboard_suggest_complete(tests.v('sug'), '[{"action":"Cups rattle"}]', '{}', 0.001, 'm');
select tests.ok((select count(*) from public.storyboard_shots where sequence_id = tests.v('sb') and content ->> 'action' = 'Cups rattle') = 0, 'suggestions don''t create frames');

-- Shot Builder conversation carries the open storyboard.
:as_dir
select tests.put('th', public.start_agent_thread(tests.v('A'), 'shots'));
select tests.put('run', public.post_agent_message(tests.v('th'), 'Help me shoot the opening', jsonb_build_object('storyboard_id', tests.v('sb'))));
select tests.ok((select input_payload -> 'focus' ->> 'storyboard_id' from public.agent_runs where id = tests.v('run')) = tests.v('sb')::text, 'the open storyboard travels with the message');
:as_viewer
select tests.ok((select ei_tungsten from public.storyboard_stock_profiles where id = 'kodak-vision3-500t') = 500, 'stock reference data readable');

:as_owner
select n, case when passed then 'PASS' else 'FAIL' end as result, label, detail from tests.results order by n;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from tests.results;
do $$ begin
  if exists (select 1 from tests.results where not passed) then
    raise exception 'Storyboards test suite FAILED';
  end if;
end $$;
