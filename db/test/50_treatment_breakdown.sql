-- STUDIO — Story Lead reading the treatment. Runs after 10_–40_ (reuses harness, users, film A).
\set ON_ERROR_STOP 1
\pset footer off
set client_min_messages = warning;

\set as_dir      'reset role; select tests.claims(''dir'');      set role authenticated;'
\set as_reviewer 'reset role; select tests.claims(''reviewer''); set role authenticated;'
\set as_outsider 'reset role; select tests.claims(''outsider''); set role authenticated;'
\set as_anon     'reset role; select set_config(''request.jwt.claims'', '''', false); set role anon;'
\set as_ep       'reset role; select tests.claims(''ep'');       set role authenticated;'
\set as_owner    'reset role;'

:as_owner
delete from tests.results;

:as_dir
select tests.put('treat', public.add_reference(tests.v('story'), 'https://docs.google.com/presentation/d/SLIDES123/edit',
  'Treatment', 'Director (own work)', null, 'unknown'));
select tests.put('other', public.add_reference(tests.v('mira'), 'https://docs.google.com/document/d/OTHER/edit',
  'Not the story''s', 'Director (own work)', null, 'unknown'));
select tests.put('notmine', public.add_reference(tests.v('story'), 'https://example.org/x', 'Someone else', 'Example Museum', null, 'unknown'));
\set long_text '''Mira climbs the lighthouse stairs every night. At the top, the lamp hums and the sea is black and loud.'''

:as_anon
select tests.throws(format($q$select public.request_treatment_breakdown(%L, %L, %s)$q$, tests.v('story'), tests.v('treat'), :'long_text'),
  '42501', 'anon cannot request');
:as_outsider
select tests.throws(format($q$select public.request_treatment_breakdown(%L, %L, %s)$q$, tests.v('story'), tests.v('treat'), :'long_text'),
  'PT404', 'outsider cannot request (not found)');
:as_reviewer
select tests.throws(format($q$select public.request_treatment_breakdown(%L, %L, %s)$q$, tests.v('story'), tests.v('treat'), :'long_text'),
  '42501', 'review access cannot request');

:as_dir
select tests.throws(format($q$select public.request_treatment_breakdown(%L, %L, %s)$q$, tests.v('mira'), tests.v('other'), :'long_text'),
  '22023', 'only the story can be broken down');
select tests.throws(format($q$select public.request_treatment_breakdown(%L, %L, %s)$q$, tests.v('story'), tests.v('other'), :'long_text'),
  'PT404', 'a link from another item is refused');
select tests.throws(format($q$select public.request_treatment_breakdown(%L, %L, %s)$q$, tests.v('story'), tests.v('notmine'), :'long_text'),
  'PT404', 'a reference that is not the director''s treatment is refused');
select tests.throws(format($q$select public.request_treatment_breakdown(%L, %L, 'too short')$q$, tests.v('story'), tests.v('treat')),
  '22023', 'treatment needs real text');
select tests.throws(format($q$select public.request_treatment_breakdown(%L, %L, repeat('a', 150001))$q$, tests.v('story'), tests.v('treat')),
  '22023', 'very long treatments are refused');

select tests.put('trun', public.request_treatment_breakdown(tests.v('story'), tests.v('treat'), :'long_text'));
select tests.ok(public.request_treatment_breakdown(tests.v('story'), tests.v('treat'), :'long_text') = tests.v('trun'),
  'a second request reuses the run in progress');
select tests.ok(public.request_story_breakdown(tests.v('story')) = tests.v('trun'),
  'a synopsis request also waits for the treatment run');
:as_owner
select tests.ok((select input_payload ->> 'source' from public.agent_runs where id = tests.v('trun')) = 'treatment', 'run records its source');
select tests.ok((select input_payload ->> 'source_url' from public.agent_runs where id = tests.v('trun'))
  = 'https://docs.google.com/presentation/d/SLIDES123/edit', 'source link comes from the database, not the browser');
select tests.ok((select input_payload ->> 'text' from public.agent_runs where id = tests.v('trun')) like '%Mira climbs the lighthouse%', 'text snapshot is stored');
select tests.ok(exists (select 1 from public.audit_events where target_id = tests.v('trun') and event_type = 'agent_run.requested'
  and actor_user_id = tests.v('dir') and event_payload ->> 'source' = 'treatment'), 'request audited with its source');
-- Finish it so later suites start clean.
update public.agent_runs set status = 'cancelled' where id = tests.v('trun');

:as_ep
select public.set_ai_budget(tests.v('A'), 0.2);
:as_dir
select tests.throws(format($q$select public.request_treatment_breakdown(%L, %L, %s)$q$, tests.v('story'), tests.v('treat'), :'long_text'),
  'PT402', 'budget applies to treatment runs');
:as_ep
select public.set_ai_budget(tests.v('A'), 10);

:as_owner
select n, case when passed then 'PASS' else 'FAIL' end as result, label, detail from tests.results order by n;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from tests.results;
do $$ begin
  if exists (select 1 from tests.results where not passed) then
    raise exception 'Treatment breakdown test suite FAILED';
  end if;
end $$;
