-- STUDIO — runtime + story notebook. Runs after 10_–70_.
\set ON_ERROR_STOP 1
\pset footer off
set client_min_messages = warning;

\set as_dir      'reset role; select tests.claims(''dir'');      set role authenticated;'
\set as_viewer   'reset role; select tests.claims(''viewer'');   set role authenticated;'
\set as_reviewer 'reset role; select tests.claims(''reviewer''); set role authenticated;'
\set as_outsider 'reset role; select tests.claims(''outsider''); set role authenticated;'
\set as_anon     'reset role; select set_config(''request.jwt.claims'', '''', false); set role anon;'
\set as_service  'reset role; select set_config(''request.jwt.claims'', '''', false); set role service_role;'
\set as_owner    'reset role;'

:as_owner
delete from tests.results;

-- Runtime
:as_anon
select tests.throws($$select public.set_film_runtime(tests.v('A'), '1')$$, '42501', 'anon cannot set runtime');
:as_reviewer
select tests.throws($$select public.set_film_runtime(tests.v('A'), '1')$$, '42501', 'review access cannot set runtime');
:as_dir
select tests.throws($$select public.set_film_runtime(tests.v('A'), '45')$$, '22023', 'unknown runtime refused');
select public.set_film_runtime(tests.v('A'), '3-5');
select tests.ok((select settings ->> 'runtime' from public.projects where id = tests.v('A')) = '3-5', 'runtime saved');
select tests.ok((select settings ->> 'ai_monthly_budget_usd' from public.projects where id = tests.v('A')) is not null, 'budget setting untouched');
select public.set_film_runtime(tests.v('A'), null);
select tests.ok((select settings ? 'runtime' from public.projects where id = tests.v('A')) = false, 'runtime can be cleared');

-- Her notebook
:as_outsider
select tests.throws($$select public.add_notebook_item(tests.v('A'), 'idea', 'x')$$, 'PT404', 'outsider cannot add notes');
:as_reviewer
select tests.throws($$select public.add_notebook_item(tests.v('A'), 'idea', 'x')$$, '42501', 'review access cannot add notes');
:as_dir
select tests.throws($$select public.add_notebook_item(tests.v('A'), 'villain', 'x')$$, '22023', 'unknown section refused');
select tests.put('d1', public.add_notebook_item(tests.v('A'), 'decision', 'The robot wants to dance.'));
select tests.ok((select status from public.story_notebook where id = tests.v('d1')) = 'confirmed', 'her decision is confirmed');
select tests.put('na1', public.add_notebook_item(tests.v('A'), 'next_action', 'Sketch the switch moment.'));
select tests.put('na2', public.add_notebook_item(tests.v('A'), 'next_action', 'Write the opening.'));
select tests.ok((select status from public.story_notebook where id = tests.v('na1')) = 'archived', 'only one next step at a time');
select public.update_notebook_item(tests.v('d1'), null, 'for_later', null);
select tests.ok((select kind from public.story_notebook where id = tests.v('d1')) = 'for_later', 'moved to For later');
select public.update_notebook_item(tests.v('d1'), 'archived', null, null);
select tests.ok(tests.n($$select 1 from public.story_notebook where id = tests.v('d1')$$) = 1, 'removing keeps the item (archived)');
select tests.throws($$insert into public.story_notebook (project_id, kind, body, status, source) values (tests.v('A'), 'idea', 'x', 'confirmed', 'agent')$$,
  '42501', 'clients cannot write the notebook directly');
:as_reviewer
select tests.ok(tests.n($$select 1 from public.story_notebook where project_id = tests.v('A')$$) >= 3, 'review access can read the notebook');
:as_viewer
select tests.ok(tests.n($$select 1 from public.story_notebook$$) = 0, 'view access cannot');

-- Story partner's changes
:as_dir
select tests.put('sth', public.start_agent_thread(tests.v('A'), 'story'));
select tests.put('srun', public.post_agent_message(tests.v('sth'), 'One minute. It wants to dance, and she dances with it.'));
select tests.put('q1', public.add_notebook_item(tests.v('A'), 'question', 'What does the robot want?'));
select tests.throws(format($q$select public.apply_partner_notes(%L, '[]', null, null)$q$, tests.v('srun')), '42501', 'clients cannot apply partner notes');
:as_service
select tests.throws(format($q$select public.apply_partner_notes(%L, '[]', null, null)$q$, tests.v('srun')), 'PT409', 'only a running turn');
select public.start_agent_run(tests.v('srun'));
select public.apply_partner_notes(tests.v('srun'), jsonb_build_array(
  jsonb_build_object('op', 'add', 'kind', 'decision', 'body', 'The robot wants to dance.', 'her_words', 'It wants to dance'),
  jsonb_build_object('op', 'add', 'kind', 'decision', 'body', 'There is a rival team.', 'her_words', 'a rival team'),
  jsonb_build_object('op', 'add', 'kind', 'ending', 'body', 'She dances with it.', 'her_words', 'she dances with it'),
  jsonb_build_object('op', 'add', 'kind', 'middle', 'body', 'She reaches for the switch.'),
  jsonb_build_object('op', 'resolve', 'id', tests.v('q1')),
  jsonb_build_object('op', 'resolve', 'id', 'not-a-uuid')
), '1', 'One minute');
:as_dir
select tests.ok((select settings ->> 'runtime' from public.projects where id = tests.v('A')) = '1', 'runtime recorded from her words');
select tests.ok(tests.n($$select 1 from public.story_notebook where agent_run_id = tests.v('srun') and kind = 'decision' and status = 'confirmed' and body like '%dance%'$$) = 1,
  'decision in her words is recorded as confirmed');
select tests.ok(tests.n($$select 1 from public.story_notebook where agent_run_id = tests.v('srun') and body like '%rival%' and kind = 'idea' and status = 'proposed'$$) = 1,
  'a "decision" she never said stays a proposed idea');
select tests.ok((select status from public.story_notebook where agent_run_id = tests.v('srun') and kind = 'ending') = 'confirmed', 'her ending is confirmed');
select tests.ok((select status from public.story_notebook where agent_run_id = tests.v('srun') and kind = 'middle') = 'proposed', 'suggested beat stays proposed');
select tests.ok((select status from public.story_notebook where id = tests.v('q1')) = 'done', 'answered question resolved');
:as_service
select public.apply_partner_notes(tests.v('srun'), '[]', '10-15', 'ten minutes please');
:as_dir
select tests.ok((select settings ->> 'runtime' from public.projects where id = tests.v('A')) = '1', 'runtime not changed from words she did not say');
:as_owner
update public.agent_runs set status = 'cancelled' where id = tests.v('srun');

select n, case when passed then 'PASS' else 'FAIL' end as result, label, detail from tests.results order by n;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from tests.results;
do $$ begin
  if exists (select 1 from tests.results where not passed) then
    raise exception 'Story notebook test suite FAILED';
  end if;
end $$;
