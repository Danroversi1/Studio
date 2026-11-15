-- STUDIO — inspiration department + item thumbnails. Runs after 10_–95_.
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
select tests.put('ri', public.add_reference(tests.v('story'), 'https://example.org/film', 'A film', 'Studio X', null, 'unknown'));
select public.set_reference_department(tests.v('ri'), 'inspiration');
select tests.ok((select department from public.research_references where id = tests.v('ri')) = 'inspiration', 'Inspiration is a department');

select tests.put('th', (select asset_id from public.begin_asset_upload(tests.v('mira'), 'm.png', 'image/png', 10)));
select tests.throws(format($q$select public.set_entity_thumbnail(%L, %L)$q$, tests.v('mira'), tests.v('th')), '22023', 'a pending upload cannot be a thumbnail');
:as_service
select public.complete_asset_upload(tests.v('th'), 10, repeat('f', 64), 'image/png');
:as_reviewer
select tests.throws(format($q$select public.set_entity_thumbnail(%L, %L)$q$, tests.v('mira'), tests.v('th')), '42501', 'review access cannot choose thumbnails');
:as_dir
select public.set_entity_thumbnail(tests.v('mira'), tests.v('th'));
select tests.ok((select metadata ->> 'thumbnail_asset_id' from public.entities where id = tests.v('mira')) = tests.v('th')::text, 'thumbnail chosen');
select public.set_entity_thumbnail(tests.v('mira'), null);
select tests.ok((select metadata ? 'thumbnail_asset_id' from public.entities where id = tests.v('mira')) = false, 'thumbnail cleared');
select tests.throws(format($q$select public.set_entity_thumbnail(%L, %L)$q$, tests.v('mira'), tests.v('B')), '22023', 'unknown asset refused');

:as_owner
select n, case when passed then 'PASS' else 'FAIL' end as result, label, detail from tests.results order by n;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from tests.results;
do $$ begin
  if exists (select 1 from tests.results where not passed) then
    raise exception 'Inspiration/thumbnail test suite FAILED';
  end if;
end $$;
