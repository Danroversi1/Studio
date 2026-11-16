-- STUDIO — characters the script calls out. Runs after 10_–99d_.
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
select tests.throws(format($q$select public.request_cast_scan(%L, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$q$, tests.v('A')), '42501', 'review access cannot start a read');
:as_dir
select tests.throws(format($q$select public.request_cast_scan(%L, 'nope')$q$, tests.v('A')), '22023', 'bad fingerprint refused');
select tests.put('cs', public.request_cast_scan(tests.v('A'), 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
select tests.ok(tests.v('cs') is not null, 'read requested');
select tests.ok(public.request_cast_scan(tests.v('A'), 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') is null, 'one at a time');
select tests.throws(format($q$select public.complete_cast_scan(%L, '[]', '{}', 0, 'm')$q$, tests.v('cs')), '42501', 'directors cannot complete runs');
:as_service
select public.start_agent_run(tests.v('cs'));
select public.complete_cast_scan(tests.v('cs'), '[{"name":"The President","description":"x","first_scene":2}]', '{}', 0.01, 'm');
select tests.ok((select output_payload -> 'people' -> 0 ->> 'name' from public.agent_runs where id = tests.v('cs')) = 'The President', 'people stored');
:as_dir
select tests.ok(public.request_cast_scan(tests.v('A'), 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') is null, 'same script is not read twice');
select tests.ok(public.request_cast_scan(tests.v('A'), 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb') is not null, 'a changed script is read');

:as_owner
select n, case when passed then 'PASS' else 'FAIL' end as result, label, detail from tests.results order by n;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from tests.results;
do $$ begin
  if exists (select 1 from tests.results where not passed) then
    raise exception 'Cast scan test suite FAILED';
  end if;
end $$;
