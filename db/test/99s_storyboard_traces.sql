-- STUDIO — Storyboard traces (vector paths, validated) and the film's treatment preset.
\set ON_ERROR_STOP 1
\pset footer off
set client_min_messages = warning;
\set as_dir      'reset role; select tests.claims(''dir'');      set role authenticated;'
\set as_reviewer 'reset role; select tests.claims(''reviewer''); set role authenticated;'
\set as_outsider 'reset role; select tests.claims(''outsider''); set role authenticated;'
\set as_owner    'reset role;'

:as_owner
delete from tests.results;

:as_dir
select tests.put('TR', public.create_project('Trace film', 'x'));
select tests.put('tsb', public.storyboard_create(tests.v('TR'), 'Board', '', '{}'));
select tests.put('tsh', public.storyboard_shot_save(tests.v('tsb'), null, '{"action":"A door."}', 'director', null, null, null));
select tests.put('t1', public.storyboard_trace_save(tests.v('TR'), tests.v('tsh'), 'outline', '{"detail":0.5}',
  '[{"layerId":"a","assetId":null}]', 160, 100, '[{"d":"M1 2L3 4","s":"#111111","w":2},{"d":"M0 0L5 0L5 5Z","f":"#8a8a8a"}]'));
select tests.ok((select path_count = 2 and treatment = 'outline' from public.storyboard_traces where id = tests.v('t1')), 'a trace is saved with its paths');
select tests.throws(format($q$select public.storyboard_trace_save(%L, null, 'ink', '{}', '[]', 10, 10, '[{"d":"M0 0<script>"}]')$q$, tests.v('TR')), '22023', 'markup in path data is refused');
select tests.throws(format($q$select public.storyboard_trace_save(%L, null, 'ink', '{}', '[]', 10, 10, '[{"d":"M0 0L1 1","f":"url(javascript:x)"}]')$q$, tests.v('TR')), '22023', 'only plain colours');
select tests.throws(format($q$select public.storyboard_trace_save(%L, null, 'ink', '{}', '[]', 10, 10, '[{"d":"M0 0L1 1","onload":"x"}]')$q$, tests.v('TR')), '22023', 'no extra attributes');
select tests.throws(format($q$select public.storyboard_trace_save(%L, null, 'ink', '{}', '[]', 10, 10, '[{"d":"M0 0L1 1","s":"#000000","w":90}]')$q$, tests.v('TR')), '22023', 'stroke width is bounded');
select tests.throws(format($q$select public.storyboard_trace_save(%L, null, 'ink', '{}', '[]', 10, 10, '[]')$q$, tests.v('TR')), '22023', 'an empty trace is refused');
select tests.throws(format($q$select public.storyboard_trace_save(%L, null, 'ink', '{}', '[]', 10, 10, (select jsonb_agg(jsonb_build_object('d','M0 0L1 1')) from generate_series(1, 6001)))$q$, tests.v('TR')), '22023', 'too many paths is refused');
select tests.throws(format($q$select public.storyboard_trace_save(%L, null, 'watercolour', '{}', '[]', 10, 10, '[{"d":"M0 0L1 1"}]')$q$, tests.v('TR')), '22023', 'known treatments only');

select tests.ok(public.storyboard_treatment_save(tests.v('TR'), '{"contrast":0.6,"palette":["#111111"]}', null) = 1, 'first treatment preset');
select tests.ok(public.storyboard_treatment_save(tests.v('TR'), '{"contrast":0.7}', 1) = 2, 'updated with the expected version');
select tests.throws(format($q$select public.storyboard_treatment_save(%L, '{}', 1)$q$, tests.v('TR')), 'PT409', 'a stale version is refused');
select tests.throws($q$insert into public.storyboard_traces (project_id, treatment, settings, source, width, height, paths, path_count) values (gen_random_uuid(), 'ink', '{}', '[]', 1, 1, '[]', 0)$q$, '42501', 'no direct writes');

:as_outsider
select tests.ok((select count(*) from public.storyboard_traces where project_id = tests.v('TR')) = 0, 'outsiders can''t read traces');
select tests.throws(format($q$select public.storyboard_trace_save(%L, null, 'ink', '{}', '[]', 10, 10, '[{"d":"M0 0L1 1"}]')$q$, tests.v('TR')), 'PT404', 'outsiders can''t trace');

:as_owner
select n, label from tests.results where not passed order by n;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from tests.results;
do $$ begin if exists (select 1 from tests.results where not passed) then raise exception 'Trace test suite FAILED'; end if; end $$;
