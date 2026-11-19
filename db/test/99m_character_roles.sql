-- STUDIO — A character's role (orders character menus).
\set ON_ERROR_STOP 1
\pset footer off
set client_min_messages = warning;
\set as_dir      'reset role; select tests.claims(''dir'');      set role authenticated;'
\set as_outsider 'reset role; select tests.claims(''outsider''); set role authenticated;'
\set as_owner    'reset role;'

:as_owner
delete from tests.results;
:as_dir
select tests.put('RA', public.create_project('Roles film', 'x'));
select tests.put('rj', public.create_entity(tests.v('RA'), 'character', 'Jo', '{"summary":"x"}'));
select public.set_character_role(tests.v('rj'), 'protagonist');
select tests.ok((select metadata ->> 'cast_role' from public.entities where id = tests.v('rj')) = 'protagonist', 'role saved');
select public.set_character_role(tests.v('rj'), null);
select tests.ok(not ((select metadata from public.entities where id = tests.v('rj')) ? 'cast_role'), 'role cleared');
select public.set_character_role(tests.v('rj'), 'antagonist');
select tests.ok((select metadata ->> 'cast_role' from public.entities where id = tests.v('rj')) = 'antagonist', 'antagonist is a role');
select tests.throws(format($q$select public.set_character_role(%L, 'villain')$q$, tests.v('rj')), '22023', 'only the three roles');
:as_outsider
select tests.throws(format($q$select public.set_character_role(%L, 'featured')$q$, tests.v('rj')), 'PT404', 'outsiders cannot');
:as_owner
select n, label from tests.results where not passed order by n;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from tests.results;
do $$ begin if exists (select 1 from tests.results where not passed) then raise exception 'Character roles test suite FAILED'; end if; end $$;
