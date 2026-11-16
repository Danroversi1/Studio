-- STUDIO — Local renderer: pairing, tokens, one explicit job, claim/progress/cancel, results.
\set ON_ERROR_STOP 1
\pset footer off
set client_min_messages = warning;

\set as_dir      'reset role; select tests.claims(''dir'');      set role authenticated;'
\set as_viewer   'reset role; select tests.claims(''viewer'');   set role authenticated;'
\set as_reviewer 'reset role; select tests.claims(''reviewer''); set role authenticated;'
\set as_owner    'reset role;'

:as_owner
delete from tests.results;
create table if not exists tests.ctx_text (k text primary key, v text);
grant select, insert, update on tests.ctx_text to authenticated, service_role;
create or replace function tests.put_text(p text, val text) returns text language sql as $$
  insert into tests.ctx_text values (p, val) on conflict (k) do update set v = excluded.v returning v;
$$;
create or replace function tests.v_text(p text) returns text language sql stable as $$ select v from tests.ctx_text where k = p $$;

-- Pairing: a code is shown once; only its hash is stored; it works once.
:as_dir
select tests.put_text('code', public.renderer_pair_start());
select tests.ok(length(tests.v_text('code')) = 10 and tests.v_text('code') ~ '^[A-HJ-NP-Z2-9]{10}$', 'a 10-character pairing code');
:as_owner
select tests.ok(not exists (select 1 from public.renderer_pairings where code_hash = tests.v_text('code')), 'the code itself is not stored');
select tests.put('dev', public.renderer_pair_complete(encode(sha256(convert_to(tests.v_text('code'), 'UTF8')), 'hex'), repeat('7', 64), 'Studio PC',
  '{"os":"Windows 11","backend":"cuda"}'));
select tests.throws(format($q$select public.renderer_pair_complete(%L, %L, 'x', '{}')$q$, encode(sha256(convert_to(tests.v_text('code'), 'UTF8')), 'hex'), repeat('8', 64)),
  '22023', 'a code works only once');
select tests.ok((select device_id from public.renderer_auth(repeat('7', 64), null)) = tests.v('dev'), 'the token identifies the computer');
select tests.ok(not exists (select 1 from public.renderer_auth(repeat('9', 64), null)), 'an unknown token is refused');
:as_dir
select tests.throws($q$select token_hash from public.renderer_devices$q$, '42501', 'she cannot read token hashes');
select tests.ok((select count(*) from public.renderer_devices where id = tests.v('dev')) = 1, 'she sees her computer');
:as_reviewer
select tests.ok((select count(*) from public.renderer_devices) = 0, 'others do not see her computer');
select tests.throws($q$select public.renderer_pair_complete('a', 'b', 'c', '{}')$q$, '42501', 'pairing completion is server-only');

:as_dir
select public.renderer_set_manual(tests.v('dev'), '{"gpu":"RTX 4070","vramGb":"12"}');
:as_owner
select public.renderer_auth(repeat('7', 64), '{"os":"Windows 11","gpus":[]}');
select tests.ok((select report -> 'manual' ->> 'gpu' = 'RTX 4070' and report ->> 'os' = 'Windows 11' from public.renderer_devices where id = tests.v('dev')),
  'her own hardware notes survive the companion''s reports');
:as_dir
-- One explicit job.
:as_dir
select tests.put('lsb', public.storyboard_create(tests.v('A'), 'Local test', '', '{}'));
select tests.put('lf1', public.storyboard_shot_save(tests.v('lsb'), null, '{"action":"Johnny at the cafe."}', 'director', null, null, null));
:as_owner
insert into public.assets (id, project_id, entity_id, kind, origin, display_name, storage_bucket, storage_key, created_by, upload_status, mime_type, file_extension)
values (gen_random_uuid(), tests.v('A'), (select entity_id from public.storyboard_sequences where id = tests.v('lsb')), 'image', 'upload', 'comp.png', 'b', 'lr-1', tests.v('dir'), 'ready', 'image/png', 'png')
returning tests.put('comp', id) is null;
insert into public.assets (id, project_id, entity_id, kind, origin, display_name, storage_bucket, storage_key, created_by, upload_status, mime_type, file_extension)
values (gen_random_uuid(), tests.v('A'), (select entity_id from public.storyboard_sequences where id = tests.v('lsb')), 'image', 'upload', 'johnny.png', 'b', 'lr-2', tests.v('dir'), 'ready', 'image/png', 'png')
returning tests.put('castpic', id) is null;
:as_dir
select tests.put('job1', public.local_job_request(tests.v('lf1'), tests.v('dev'), 'flux2-klein-4b-refs', 'Johnny at the cafe.', '{"preset":"draft","seed":7}',
  jsonb_build_object('inputs', jsonb_build_array(jsonb_build_object('role', 'composition', 'asset_id', tests.v('comp')), jsonb_build_object('role', 'cast', 'asset_id', tests.v('castpic')))),
  tests.v('comp'), 'local-key-0001'));
select tests.ok(public.local_job_request(tests.v('lf1'), tests.v('dev'), 'flux2-klein-4b-refs', 'x', '{}', '{"inputs":[]}', null, 'local-key-0001') = tests.v('job1'), 'the same submission makes no second job');
select tests.throws(format($q$select public.local_job_request(%L, %L, 'w', 'p', '{}', '{"inputs":[{"role":"cast","asset_id":"%s"}]}', null, 'local-key-0002')$q$, tests.v('lf1'), tests.v('dev'), tests.v('castpic')),
  '22023', 'a job needs exactly one composition or starting frame');
select tests.throws(format($q$select public.local_job_request(%L, %L, 'w', 'p', '{}', '{"inputs":[{"role":"composition","asset_id":"%s"}]}', null, 'local-key-0003')$q$, tests.v('lf1'), tests.v('dev'), gen_random_uuid()),
  '22023', 'unknown images are refused');
select tests.throws(format($q$select public.local_job_request(%L, %L, 'bad workflow!', 'p', '{}', '{"inputs":[{"role":"composition","asset_id":"%s"}]}', null, 'local-key-0004')$q$, tests.v('lf1'), tests.v('dev'), tests.v('comp')),
  '22023', 'workflow ids are validated');
:as_reviewer
select tests.throws(format($q$select public.local_job_request(%L, %L, 'w', 'p', '{}', '{}', null, 'local-key-0005')$q$, tests.v('lf1'), tests.v('dev')), '42501', 'review access cannot generate');

-- Her computer: claim, progress, result.
:as_owner
select tests.ok(public.local_job_claim(tests.v('dev'), '{}') = tests.v('job1'), 'the computer gets the job');
select tests.ok(public.local_job_claim(tests.v('dev'), array[tests.v('job1')]) is null, 'one job at a time');
select tests.ok(public.local_job_progress(tests.v('job1'), tests.v('dev'), '{"stage":"generating","pct":40}') = false, 'progress, no cancel yet');
:as_dir
select public.storyboard_shot_state(tests.v('lf1'), 'approved', null);
:as_owner
select tests.put('out1', (select asset_id from public.local_job_reserve_output(tests.v('job1'), tests.v('dev'), 'image/png', 1000)));
select tests.throws(format($q$select public.local_job_complete(%L, %L, %L, '{}')$q$, tests.v('job1'), tests.v('dev'), tests.v('out1')), '22023', 'a result must finish uploading first');
update public.assets set upload_status = 'ready' where id = tests.v('out1');
select tests.ok(public.local_job_complete(tests.v('job1'), tests.v('dev'), tests.v('out1'), '{"seed":7,"workflow_version":"1"}') = false, 'an approved frame is not changed');
select tests.ok((select illustration_asset_id is null from public.storyboard_shots where id = tests.v('lf1')), 'the approved frame keeps what it showed');
select tests.ok((select status = 'succeeded' and output_asset_id = tests.v('out1') from public.storyboard_jobs where id = tests.v('job1')), 'the result is kept in its history');
select tests.ok((select origin = 'generated' and created_by = tests.v('dir') from public.assets where id = tests.v('out1')), 'results are marked generated, owned by her');

-- Cancel and restart handling; no automatic retries.
:as_dir
select public.storyboard_shot_state(tests.v('lf1'), 'proposed', null);
select tests.put('job2', public.local_job_request(tests.v('lf1'), tests.v('dev'), 'flux2-klein-4b-refs', 'Again.', '{}',
  jsonb_build_object('inputs', jsonb_build_array(jsonb_build_object('role', 'composition', 'asset_id', tests.v('comp')))), null, 'local-key-0006'));
select tests.ok(public.local_job_cancel(tests.v('job2')) = 'cancelled', 'a waiting job cancels at once');
select tests.put('job3', public.local_job_request(tests.v('lf1'), tests.v('dev'), 'flux2-klein-4b-refs', 'Third.', '{}',
  jsonb_build_object('inputs', jsonb_build_array(jsonb_build_object('role', 'composition', 'asset_id', tests.v('comp')))), null, 'local-key-0007'));
:as_owner
select public.local_job_claim(tests.v('dev'), '{}');
:as_dir
select tests.ok(public.local_job_cancel(tests.v('job3')) = 'stop_requested', 'a running job asks the computer to stop');
:as_owner
select tests.ok(public.local_job_progress(tests.v('job3'), tests.v('dev'), '{"stage":"generating"}') = true, 'the computer hears the cancel');
select public.local_job_fail(tests.v('job3'), tests.v('dev'), 'cancelled', 'Stopped on your computer.', null);
select tests.ok((select status from public.storyboard_jobs where id = tests.v('job3')) = 'cancelled', 'the stop is recorded');
:as_dir
select tests.put('job4', public.local_job_request(tests.v('lf1'), tests.v('dev'), 'flux2-klein-4b-refs', 'Fourth.', '{}',
  jsonb_build_object('inputs', jsonb_build_array(jsonb_build_object('role', 'composition', 'asset_id', tests.v('comp')))), null, 'local-key-0008'));
:as_owner
select public.local_job_claim(tests.v('dev'), '{}');
select tests.ok(public.local_job_claim(tests.v('dev'), '{}') is null, 'after a restart the lost job is not handed out again');
select tests.ok((select status = 'failed' and attempts = 1 from public.storyboard_jobs where id = tests.v('job4')), 'a job lost in a restart fails once; nothing retries');
-- Upload failure keeps the result recoverable.
:as_dir
select tests.put('job5', public.local_job_request(tests.v('lf1'), tests.v('dev'), 'flux2-klein-4b-refs', 'Fifth.', '{}',
  jsonb_build_object('inputs', jsonb_build_array(jsonb_build_object('role', 'composition', 'asset_id', tests.v('comp')))), null, 'local-key-0009'));
:as_owner
select public.local_job_claim(tests.v('dev'), '{}');
select public.local_job_fail(tests.v('job5'), tests.v('dev'), 'upload_failed', 'Saved on your computer; upload failed.', '{"local_file":"job5.png"}');
select tests.put('out5', (select asset_id from public.local_job_reserve_output(tests.v('job5'), tests.v('dev'), 'image/png', 1000)));
update public.assets set upload_status = 'ready' where id = tests.v('out5');
select public.local_job_complete(tests.v('job5'), tests.v('dev'), tests.v('out5'), '{}');
select tests.ok((select status = 'succeeded' and output_asset_id = tests.v('out5') and applied from public.storyboard_jobs where id = tests.v('job5')),
  'a result that failed to upload can still be sent later');

-- Revoking disconnects the computer.
:as_dir
select public.renderer_revoke(tests.v('dev'));
:as_owner
select tests.ok(not exists (select 1 from public.renderer_auth(repeat('7', 64), null)), 'a disconnected computer is refused');

:as_owner
select n, case when passed then 'PASS' else 'FAIL' end as result, label, detail from tests.results order by n;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from tests.results;
do $$ begin
  if exists (select 1 from tests.results where not passed) then
    raise exception 'Local renderer test suite FAILED';
  end if;
end $$;
