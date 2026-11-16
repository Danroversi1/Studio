-- STUDIO — Storyboards: stable shot IDs, revisions, approval, locking, references, jobs.
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
select tests.put('s1', public.storyboard_shot_save(tests.v('sb'), null, '{"action":"Johnny sips coffee.","size":"wide"}', 'director', null, null));
select tests.put('s2', public.storyboard_shot_save(tests.v('sb'), null, '{"action":"An explosion outside.","size":"medium"}', 'agent', null, null));
select tests.put('s3', public.storyboard_shot_save(tests.v('sb'), null, '{"action":"Johnny turns.","size":"close"}', 'director', null, null));
select tests.ok((select array_agg(id order by position) from public.storyboard_shots where sequence_id = tests.v('sb'))
  = array[tests.v('s1'), tests.v('s2'), tests.v('s3')], 'shots in order');
select tests.ok((select origin from public.storyboard_shots where id = tests.v('s2')) = 'agent', 'agent proposals are marked as such');

-- Reordering keeps identity and revision.
select public.storyboard_shot_move(tests.v('s3'), 500);
select tests.ok((select array_agg(id order by position) from public.storyboard_shots where sequence_id = tests.v('sb'))
  = array[tests.v('s3'), tests.v('s1'), tests.v('s2')], 'reordered');
select tests.ok((select revision from public.storyboard_shots where id = tests.v('s3')) = 1, 'reordering is not a revision');

-- Revisions, approval, conflicts, locking.
select public.storyboard_shot_state(tests.v('s1'), 'approved', null);
select tests.ok((select approved_revision from public.storyboard_shots where id = tests.v('s1')) = 1, 'approval records the revision');
select public.storyboard_shot_save(tests.v('sb'), tests.v('s1'), '{"action":"Johnny sips coffee.","size":"close"}', 'director', null, 1);
select tests.ok((select state || ':' || revision from public.storyboard_shots where id = tests.v('s1')) = 'proposed:2', 'editing an approved shot makes a new proposal');
select tests.ok((select approved_content ->> 'size' from public.storyboard_shots where id = tests.v('s1')) = 'wide', 'the approved choice is kept');
select tests.ok((select count(*) from public.storyboard_shot_revisions where shot_id = tests.v('s1')) = 2, 'history kept');
select tests.throws(format($q$select public.storyboard_shot_save(%L, %L, '{"action":"x"}', 'director', null, 1)$q$, tests.v('sb'), tests.v('s1')), 'PT409', 'stale edits refused');
select public.storyboard_shot_state(tests.v('s1'), null, true);
select tests.throws(format($q$select public.storyboard_shot_save(%L, %L, '{"action":"y"}', 'director', null, null)$q$, tests.v('sb'), tests.v('s1')), '22023', 'locked shots cannot be edited');
select tests.throws(format($q$select public.storyboard_shot_archive(%L)$q$, tests.v('s1')), '22023', 'locked shots cannot be removed');

-- References: access is decided by the database, not the browser.
:as_owner
insert into public.assets (id, project_id, entity_id, kind, origin, display_name, storage_bucket, storage_key, created_by, upload_status, mime_type, file_extension)
values (gen_random_uuid(), tests.v('A'), (select entity_id from public.storyboard_sequences where id = tests.v('sb')), 'image', 'upload', 'drawing.png', 'b',
        'sb-k1', tests.v('dir'), 'ready', 'image/png', 'png') returning tests.put('img', id) is null;
insert into public.assets (id, project_id, entity_id, kind, origin, display_name, storage_bucket, storage_key, created_by, upload_status, mime_type, file_extension)
values (gen_random_uuid(), tests.v('A'), (select entity_id from public.storyboard_sequences where id = tests.v('sb')), 'image', 'generated', 'frame.png', 'b',
        'sb-k2', tests.v('dir'), 'ready', 'image/png', 'png') returning tests.put('out1', id) is null;
insert into public.assets (id, project_id, entity_id, kind, origin, display_name, storage_bucket, storage_key, created_by, upload_status, mime_type, file_extension)
values (gen_random_uuid(), tests.v('A'), (select entity_id from public.storyboard_sequences where id = tests.v('sb')), 'image', 'generated', 'frame2.png', 'b',
        'sb-k3', tests.v('dir'), 'ready', 'image/png', 'png') returning tests.put('out2', id) is null;
:as_dir
select tests.put('r1', public.storyboard_ref_save(tests.v('sb'), null, jsonb_build_object('asset_id', tests.v('img'), 'role', 'drawing_style', 'borrow', 'line weight', 'ignore', 'colors', 'access', 'inaccessible')));
select tests.ok((select access from public.storyboard_refs where id = tests.v('r1')) = 'accessible', 'a stored image is accessible');
select tests.put('r2', public.storyboard_ref_save(tests.v('sb'), null, '{"url":"https://example.com/still.jpg","role":"lighting","access":"accessible"}'));
select tests.ok((select access from public.storyboard_refs where id = tests.v('r2')) = 'unverified', 'a pasted link is not proof of access');
select tests.put('r3', public.storyboard_ref_save(tests.v('sb'), null, '{"title":"Rainy neon street","role":"lighting"}'));
select tests.ok((select access from public.storyboard_refs where id = tests.v('r3')) = 'text_only', 'a description is text only');
select tests.throws(format($q$select public.storyboard_ref_save(%L, null, '{"title":"x","role":"vibes"}')$q$, tests.v('sb')), '23514', 'roles are explicit');

-- Jobs: idempotent, history-preserving, lock-respecting.
select tests.put('j1', (select job_id from public.storyboard_job_request(tests.v('s2'), 'frame', 'storyboard', 'openai', 'gpt-image-2', 'sb-v1', 'prompt', '{"style":"pencil"}',
  jsonb_build_array(jsonb_build_object('asset_id', tests.v('img'), 'role', 'drawing_style')), '[]', null, 'key-00000001')));
select tests.ok((select existing from public.storyboard_job_request(tests.v('s2'), 'frame', 'storyboard', 'openai', 'gpt-image-2', 'sb-v1', 'prompt', '{}', '[]', '[]', null, 'key-00000001')),
  'the same request does not make a duplicate job');
select tests.throws(format($q$select public.storyboard_job_complete(%L, %L, '{}', 'm')$q$, tests.v('j1'), tests.v('out1')), '42501', 'directors cannot complete jobs');
:as_service
select public.storyboard_job_start(tests.v('j1'));
select public.storyboard_job_complete(tests.v('j1'), tests.v('out1'), '{"total_tokens":10}', 'gpt-image-2');
select tests.ok((select frame_asset_id from public.storyboard_shots where id = tests.v('s2')) = tests.v('out1'), 'a result becomes the frame');
select tests.ok((select origin::text from public.assets where id = tests.v('out1')) = 'generated', 'generated images are marked');
:as_dir
select tests.put('j2', (select job_id from public.storyboard_job_request(tests.v('s2'), 'frame', 'storyboard', 'openai', 'gpt-image-2', 'sb-v1', 'prompt', '{}', '[]', '[]', null, 'key-00000002')));
:as_service
select public.storyboard_job_start(tests.v('j2'));
select public.storyboard_job_fail(tests.v('j2'), 'provider timeout', null);
select tests.ok((select frame_asset_id from public.storyboard_shots where id = tests.v('s2')) = tests.v('out1'), 'a failed job keeps the previous frame');
:as_dir
-- A variation never replaces the frame automatically; it can be picked from history.
select tests.put('j3', (select job_id from public.storyboard_job_request(tests.v('s2'), 'variation', 'storyboard', 'openai', 'gpt-image-2', 'sb-v1', 'prompt', '{}', '[]', '[]', tests.v('out1'), 'key-00000003')));
:as_service
select public.storyboard_job_start(tests.v('j3'));
select public.storyboard_job_complete(tests.v('j3'), tests.v('out2'), null, 'gpt-image-2');
select tests.ok((select frame_asset_id from public.storyboard_shots where id = tests.v('s2')) = tests.v('out1'), 'a variation does not replace the frame');
:as_dir
select public.storyboard_shot_pick(tests.v('s2'), 'frame', tests.v('out2'));
select tests.ok((select frame_asset_id from public.storyboard_shots where id = tests.v('s2')) = tests.v('out1') is false, 'an earlier result can be picked');
-- Locked shots are never replaced automatically.
select public.storyboard_shot_state(tests.v('s2'), 'approved', true);
select tests.put('j4', (select job_id from public.storyboard_job_request(tests.v('s2'), 'frame', 'storyboard', 'openai', 'gpt-image-2', 'sb-v1', 'prompt', '{}', '[]', '[]', null, 'key-00000004')));
:as_service
select public.storyboard_job_start(tests.v('j4'));
select public.storyboard_job_complete(tests.v('j4'), tests.v('out1'), null, 'gpt-image-2');
select tests.ok((select frame_asset_id from public.storyboard_shots where id = tests.v('s2')) = tests.v('out2'), 'a locked shot keeps its frame');
select tests.ok((select applied from public.storyboard_jobs where id = tests.v('j4')) = false, 'the result is kept in history, not applied');
:as_dir
-- Cancelling: a late result is kept but not applied.
select public.storyboard_shot_state(tests.v('s2'), null, false);
select tests.put('j5', (select job_id from public.storyboard_job_request(tests.v('s2'), 'frame', 'storyboard', 'openai', 'gpt-image-2', 'sb-v1', 'prompt', '{}', '[]', '[]', null, 'key-00000005')));
:as_service
select public.storyboard_job_start(tests.v('j5'));
:as_dir
select public.storyboard_job_cancel(tests.v('j5'));
:as_service
select public.storyboard_job_complete(tests.v('j5'), tests.v('out1'), null, 'gpt-image-2');
select tests.ok((select status || ':' || applied from public.storyboard_jobs where id = tests.v('j5')) = 'cancelled:false', 'a cancelled job never replaces the frame');
-- Review flags keep images.
:as_dir
select public.storyboard_shot_review(tests.v('s2'), '{"reason":"Scene 1 changed"}');
select tests.ok((select review ->> 'reason' from public.storyboard_shots where id = tests.v('s2')) = 'Scene 1 changed' and
  (select frame_asset_id from public.storyboard_shots where id = tests.v('s2')) is not null, 'a review flag keeps the frame');
:as_dir
-- Shot Builder: a partner whose proposals land in the open storyboard, marked as the agent's.
select tests.put('th', public.start_agent_thread(tests.v('A'), 'shots'));
select tests.put('run', public.post_agent_message(tests.v('th'), 'Help me shoot the opening', jsonb_build_object('storyboard_id', tests.v('sb'))));
select tests.ok((select input_payload -> 'focus' ->> 'storyboard_id' from public.agent_runs where id = tests.v('run')) = tests.v('sb')::text, 'the open storyboard travels with the message');
select tests.ok((select prompt_version || ':' || domain::text from public.agent_runs where id = tests.v('run')) = 'shot-builder-v1.0:cinematography', 'Shot Builder runs are labeled');
select tests.throws(format($q$select public.storyboard_apply_agent_shots(%L, %L, '[]')$q$, tests.v('run'), tests.v('sb')), '42501', 'directors cannot apply agent shots directly');
:as_service
select public.start_agent_run(tests.v('run'));
select tests.ok(public.storyboard_apply_agent_shots(tests.v('run'), tests.v('sb'), '[{"action":"Johnny sips coffee.","size":"wide"}]') = 1, 'agent shots added');
select tests.ok((select count(*) from public.storyboard_shots where sequence_id = tests.v('sb') and origin = 'agent' and state = 'proposed' and content ->> 'action' = 'Johnny sips coffee.') = 1, 'they arrive as proposals from the agent');
:as_viewer
select tests.ok((select count(*) from public.storyboard_stock_profiles) >= 4, 'stock library readable');
select tests.ok((select ei_tungsten from public.storyboard_stock_profiles where id = 'kodak-vision3-500t') = 500, '500T EI 500 tungsten');

:as_owner
select n, case when passed then 'PASS' else 'FAIL' end as result, label, detail from tests.results order by n;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from tests.results;
do $$ begin
  if exists (select 1 from tests.results where not passed) then
    raise exception 'Storyboards test suite FAILED';
  end if;
end $$;
