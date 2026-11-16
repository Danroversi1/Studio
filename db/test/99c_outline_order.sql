-- STUDIO — outline order. Runs after 10_–99b_.
\set ON_ERROR_STOP 1
\pset footer off
set client_min_messages = warning;
\set as_dir      'reset role; select tests.claims(''dir'');      set role authenticated;'
\set as_reviewer 'reset role; select tests.claims(''reviewer''); set role authenticated;'
\set as_owner    'reset role;'

:as_owner
delete from tests.results;
:as_dir
select tests.put('b1', public.add_notebook_item(tests.v('A'), 'middle', 'She tries the key.'));
select public.place_notebook_item(tests.v('b1'), 'beginning', 5);
select tests.ok((select kind || ':' || position from public.story_notebook where id = tests.v('b1')) = 'beginning:5', 'a beat can move into another part, in order');
select tests.throws(format($q$select public.place_notebook_item(%L, 'question', 1)$q$, tests.v('b1')), '22023', 'beats only move between outline parts');
select tests.put('q1', public.add_notebook_item(tests.v('A'), 'question', 'Why the key?'));
select tests.throws(format($q$select public.place_notebook_item(%L, 'middle', 1)$q$, tests.v('q1')), '22023', 'a question cannot become a beat by moving');
select public.place_notebook_item(tests.v('q1'), null, 2);
select tests.ok((select position from public.story_notebook where id = tests.v('q1')) = 2, 'any note can be reordered');
:as_reviewer
select tests.throws(format($q$select public.place_notebook_item(%L, null, 9)$q$, tests.v('b1')), '42501', 'review access cannot reorder');

:as_owner
select n, case when passed then 'PASS' else 'FAIL' end as result, label, detail from tests.results order by n;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from tests.results;
do $$ begin
  if exists (select 1 from tests.results where not passed) then raise exception 'Outline order test suite FAILED'; end if;
end $$;
