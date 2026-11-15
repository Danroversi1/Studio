-- STUDIO — scenes from the outline. Runs after 10_–97_.
\set ON_ERROR_STOP 1
\pset footer off
set client_min_messages = warning;

\set as_dir      'reset role; select tests.claims(''dir'');      set role authenticated;'
\set as_reviewer 'reset role; select tests.claims(''reviewer''); set role authenticated;'
\set as_service  'reset role; select set_config(''request.jwt.claims'', '''', false); set role service_role;'
\set as_owner    'reset role;'

:as_owner
delete from tests.results;

:as_reviewer
select tests.throws(format($q$select public.request_scene_plan(%L, '[{"id":"x","part":"beginning","text":"hi"}]')$q$, tests.v('A')), '42501', 'review access cannot lay out scenes');
:as_dir
select tests.throws(format($q$select public.request_scene_plan(%L, '[]')$q$, tests.v('A')), '22023', 'empty beats refused');
select tests.put('sp', public.request_scene_plan(tests.v('A'), '[{"id":"x","part":"beginning","text":"She climbs the tower."}]'));
select tests.ok(tests.v('sp') is not null, 'run requested');
select tests.ok(public.request_scene_plan(tests.v('A'), '[{"id":"x","part":"beginning","text":"again"}]') is null, 'one at a time');
select tests.throws(format($q$select public.complete_scene_plan(%L, '[]', '{}', 0, 'm')$q$, tests.v('sp')), '42501', 'directors cannot complete runs');
:as_service
select public.start_agent_run(tests.v('sp'));
select public.complete_scene_plan(tests.v('sp'), '[{"beat_id":"x","heading":"EXT. TOWER - NIGHT"}]', '{}', 0.01, 'm');
select tests.ok((select status from public.agent_runs where id = tests.v('sp')) = 'succeeded', 'run completed with plan');
select tests.ok((select output_payload -> 'scenes' -> 0 ->> 'heading' from public.agent_runs where id = tests.v('sp')) = 'EXT. TOWER - NIGHT', 'plan stored');

:as_owner
select n, case when passed then 'PASS' else 'FAIL' end as result, label, detail from tests.results order by n;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from tests.results;
do $$ begin
  if exists (select 1 from tests.results where not passed) then
    raise exception 'Scene plan test suite FAILED';
  end if;
end $$;
