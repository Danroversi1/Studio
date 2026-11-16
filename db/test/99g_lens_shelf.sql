-- STUDIO — Lens shelf: her picks with source links; nothing copied.
\set ON_ERROR_STOP 1
\pset footer off
set client_min_messages = warning;

\set as_dir      'reset role; select tests.claims(''dir'');      set role authenticated;'
\set as_viewer   'reset role; select tests.claims(''viewer'');   set role authenticated;'
\set as_reviewer 'reset role; select tests.claims(''reviewer''); set role authenticated;'
\set as_owner    'reset role;'

:as_owner
delete from tests.results;

:as_reviewer
select tests.throws(format($q$select public.storyboard_lens_save(%L, null, '{"name":"Cooke S4/i"}')$q$, tests.v('A')), '42501', 'review access cannot add lenses');
:as_dir
select tests.put('l1', public.storyboard_lens_save(tests.v('A'), null,
  '{"name":"Panavision VA","focal_lengths":[50,40,35],"optical":"spherical","camera":"ARRI Alexa 35","seen_in":"Babygirl","note":"soft skin, warm","source_url":"https://www.lensaddiction.net/somefilm"}'));
select tests.ok((select source_name from public.storyboard_lens_shelf where id = tests.v('l1')) = 'Lens Addiction', 'Lens Addiction links are credited');
select tests.ok((select focal_lengths from public.storyboard_lens_shelf where id = tests.v('l1')) = '{35,40,50}', 'focal lengths sorted');
select tests.put('l2', public.storyboard_lens_save(tests.v('A'), null, '{"name":"Some 2x","optical":"anamorphic","source_url":"https://example.com/x"}'));
select tests.ok((select squeeze from public.storyboard_lens_shelf where id = tests.v('l2')) = 2, 'anamorphic defaults to 2x squeeze');
select tests.ok((select source_name from public.storyboard_lens_shelf where id = tests.v('l2')) = 'example.com', 'other sources show their site');
select tests.throws(format($q$select public.storyboard_lens_save(%L, null, '{"name":"X","source_url":"javascript:alert(1)"}')$q$, tests.v('A')), '22023', 'only https links');
select tests.throws(format($q$select public.storyboard_lens_save(%L, null, '{"name":"X","focal_lengths":["abc"]}')$q$, tests.v('A')), '22023', 'focal lengths must be numbers');
select tests.throws(format($q$select public.storyboard_lens_save(%L, null, '{"name":"  "}')$q$, tests.v('A')), '22023', 'a name is required');
select public.storyboard_lens_save(tests.v('A'), tests.v('l2'), '{"name":"Some 2x","optical":"spherical"}');
select tests.ok((select squeeze is null and source_url is null from public.storyboard_lens_shelf where id = tests.v('l2')), 'editing updates type and link');
:as_reviewer
select tests.ok((select count(*) from public.storyboard_lens_shelf where project_id = tests.v('A')) = 2, 'team members can see the shelf');
:as_viewer
select tests.ok((select count(*) from public.storyboard_lens_shelf where project_id = tests.v('A')) = 0, 'people outside the film cannot');
select tests.throws(format($q$insert into public.storyboard_lens_shelf (project_id, name) values (%L, 'x')$q$, tests.v('A')), '42501', 'no direct writes');
:as_dir
select public.storyboard_lens_archive(tests.v('l2'));
select tests.ok((select archived_at is not null from public.storyboard_lens_shelf where id = tests.v('l2')), 'lenses can be removed');

:as_owner
select n, case when passed then 'PASS' else 'FAIL' end as result, label, detail from tests.results order by n;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from tests.results;
do $$ begin
  if exists (select 1 from tests.results where not passed) then
    raise exception 'Lens shelf test suite FAILED';
  end if;
end $$;
