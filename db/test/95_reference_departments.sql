-- STUDIO — references by department. Runs after 10_–90_.
\set ON_ERROR_STOP 1
\pset footer off
set client_min_messages = warning;

\set as_dir      'reset role; select tests.claims(''dir'');      set role authenticated;'
\set as_reviewer 'reset role; select tests.claims(''reviewer''); set role authenticated;'
\set as_service  'reset role; select set_config(''request.jwt.claims'', '''', false); set role service_role;'
\set as_owner    'reset role;'

:as_owner
delete from tests.results;

:as_dir
select tests.put('r1', public.add_reference(tests.v('story'), 'https://example.org/coat', 'Coat', 'Museum', null, 'unknown'));
:as_reviewer
select tests.throws(format($q$select public.set_reference_department(%L, 'wardrobe')$q$, tests.v('r1')), '42501', 'review access cannot file references');
:as_dir
select tests.throws(format($q$select public.set_reference_department(%L, 'catering')$q$, tests.v('r1')), '22023', 'unknown department refused');
select public.set_reference_department(tests.v('r1'), 'wardrobe');
select tests.ok((select department from public.research_references where id = tests.v('r1')) = 'wardrobe', 'filed under Wardrobe');
select public.set_reference_department(tests.v('r1'), null);
select tests.ok((select department is null from public.research_references where id = tests.v('r1')), 'can be general again');

select tests.throws($$select * from public.begin_asset_import(tests.v('mira'), 'a.png', 'image/png', 10,
  'https://drive.google.com/file/d/abc/view', 'Director (own work)', 'abc', false, 'catering')$$, '22023', 'import department checked');
select tests.put('imp', (select asset_id from public.begin_asset_import(tests.v('mira'), 'Look.png', 'image/png', 64,
  'https://drive.google.com/file/d/LOOK1/view', 'Director (own work)', 'LOOK1', false, 'casting')));
:as_service
select public.complete_asset_upload(tests.v('imp'), 64, repeat('e', 64), 'image/png');
:as_dir
select tests.ok((select department from public.research_references where preview_asset_id = tests.v('imp')) = 'casting',
  'imported reference lands in its department');

:as_owner
select n, case when passed then 'PASS' else 'FAIL' end as result, label, detail from tests.results order by n;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from tests.results;
do $$ begin
  if exists (select 1 from tests.results where not passed) then
    raise exception 'Reference departments test suite FAILED';
  end if;
end $$;
