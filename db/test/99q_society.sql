-- STUDIO — Society's mood: shared public data readable by signed-in users, written only by
-- the server; each film chooses its societies.
\set ON_ERROR_STOP 1
\pset footer off
set client_min_messages = warning;
\set as_dir      'reset role; select tests.claims(''dir'');      set role authenticated;'
\set as_outsider 'reset role; select tests.claims(''outsider''); set role authenticated;'
\set as_owner    'reset role;'

:as_owner
delete from tests.results;
insert into public.society_sources (id, label) values ('umich', 'U. Michigan') on conflict do nothing;
insert into public.society_points (series, period, value, source_id) values ('us.umich.sentiment', '2026-11-01', 51.5, 'umich') on conflict do nothing;

:as_dir
select tests.put('SO', public.create_project('Society film', 'x'));
select tests.ok((select bool_or(society_regions = '{US,EU}') from public.bubble_settings where project_id = tests.v('SO')) is distinct from false, 'default: both societies');
select public.society_set_regions(tests.v('SO'), array['US']);
select tests.ok((select society_regions = '{US}' from public.bubble_settings where project_id = tests.v('SO')), 'choose the US only');
select tests.throws(format($q$select public.society_set_regions(%L, array['Mars'])$q$, tests.v('SO')), '22023', 'only US / EU');
select tests.ok((select value = 51.5 from public.society_points where series = 'us.umich.sentiment' and period = '2026-11-01'), 'public survey data is readable');
select tests.throws($q$insert into public.society_points (series, period, value, source_id) values ('x.y', '2026-01-01', 1, 'umich')$q$, '42501', 'users can''t write survey data');

:as_outsider
select tests.throws(format($q$select public.society_set_regions(%L, array['EU'])$q$, tests.v('SO')), 'PT404', 'outsiders can''t change a film''s societies');

:as_owner
select n, label from tests.results where not passed order by n;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from tests.results;
do $$ begin if exists (select 1 from tests.results where not passed) then raise exception 'Society test suite FAILED'; end if; end $$;
