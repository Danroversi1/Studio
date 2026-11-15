-- STUDIO — script writing desk (screenplay item). Runs after 10_–60_.
\set ON_ERROR_STOP 1
\pset footer off
set client_min_messages = warning;

\set as_dir      'reset role; select tests.claims(''dir'');      set role authenticated;'
\set as_editor   'reset role; select tests.claims(''editor'');   set role authenticated;'
\set as_viewer   'reset role; select tests.claims(''viewer'');   set role authenticated;'
\set as_reviewer 'reset role; select tests.claims(''reviewer''); set role authenticated;'
\set as_outsider 'reset role; select tests.claims(''outsider''); set role authenticated;'
\set as_anon     'reset role; select set_config(''request.jwt.claims'', '''', false); set role anon;'
\set as_owner    'reset role;'

:as_owner
delete from tests.results;

:as_anon
select tests.throws($$select public.open_screenplay(tests.v('A'))$$, '42501', 'anon cannot open the script');
:as_outsider
select tests.throws($$select public.open_screenplay(tests.v('A'))$$, 'PT404', 'outsider cannot open the script');
:as_reviewer
select tests.throws($$select public.open_screenplay(tests.v('A'))$$, '42501', 'review access cannot create the script');

:as_dir
select tests.put('sp', public.open_screenplay(tests.v('A')));
select tests.ok(public.open_screenplay(tests.v('A')) = tests.v('sp'), 'one screenplay per film');
select tests.throws($$select public.create_entity(tests.v('A'), 'screenplay', 'Another')$$, '22023', 'no second screenplay through create_entity');
select tests.throws($$select public.create_revision(tests.v('sp'), '{"summary":"x"}')$$, '22023', 'screenplay only has a body');
select tests.put('sp1', public.create_revision(tests.v('sp'), '{"body":"INT. LIGHTHOUSE - NIGHT\n\nMira climbs."}', 'First pages'));
:as_editor
select tests.put('sp2', public.create_revision(tests.v('sp'), '{"body":"INT. LIGHTHOUSE - NIGHT\n\nMira climbs fast."}', 'Faster', tests.v('sp1')));
select tests.throws(format($q$select public.approve_revision(%L, null)$q$, tests.v('sp2')), '42501', 'editor cannot approve the script');
:as_dir
select tests.lives(format($q$select public.approve_revision(%L, null)$q$, tests.v('sp2')), 'director approves a script revision');
:as_viewer
select tests.ok(tests.n($$select 1 from public.versions where entity_id = tests.v('sp') and status = 'approved'$$) = 1,
  'view access sees the approved script');
select tests.ok(tests.n($$select 1 from public.versions where entity_id = tests.v('sp') and status <> 'approved'$$) = 0,
  'view access does not see drafts');

:as_owner
select n, case when passed then 'PASS' else 'FAIL' end as result, label, detail from tests.results order by n;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from tests.results;
do $$ begin
  if exists (select 1 from tests.results where not passed) then
    raise exception 'Screenplay test suite FAILED';
  end if;
end $$;
