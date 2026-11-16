-- STUDIO — Connections board. Runs after 10_–99_.
\set ON_ERROR_STOP 1
\pset footer off
set client_min_messages = warning;

\set as_dir      'reset role; select tests.claims(''dir'');      set role authenticated;'
\set as_reviewer 'reset role; select tests.claims(''reviewer''); set role authenticated;'
\set as_owner    'reset role;'

:as_owner
delete from tests.results;

:as_dir
select tests.put('c2', public.create_entity(tests.v('A'), 'character', 'Tom'));
select tests.put('ln', public.board_link(tests.v('A'), 'e:' || tests.v('mira'), 'e:' || tests.v('c2'), 'her brother'));
select tests.ok((select label from public.story_board_links where id = tests.v('ln')) = 'her brother', 'a labelled string');
select tests.ok(public.board_link(tests.v('A'), 'e:' || tests.v('c2'), 'e:' || tests.v('mira'), null) = tests.v('ln'), 'the same pair is one string, label kept');
select tests.throws(format($q$select public.board_link(%L, %L, %L, null)$q$, tests.v('A'), 'e:' || tests.v('mira'), 'e:' || tests.v('mira')), '22023', 'no string to itself');
select tests.throws(format($q$select public.board_link(%L, %L, 's:1', null)$q$, tests.v('A'), 'e:' || tests.v('mira')), '22023', 'scene strings are automatic only');
select tests.throws(format($q$select public.board_link(%L, %L, %L, null)$q$, tests.v('A'), 'e:' || tests.v('mira'), 'e:' || tests.v('B')), '22023', 'cards from another film refused');
select tests.put('nt', public.board_note_save(tests.v('A'), null, 'What if the light never comes back?', 'pink', 120, 80));
select tests.ok((select x from public.story_board_positions where node_key = 'n:' || tests.v('nt')) = 120, 'a new note lands where she put it');
select tests.ok(public.board_move(tests.v('A'), format('[{"key":"e:%s","x":10,"y":20},{"key":"s:3","x":5,"y":5},{"key":"e:%s","x":1,"y":1}]', tests.v('mira'), tests.v('B'))::jsonb) = 2, 'positions saved; unknown cards skipped');
select public.board_link(tests.v('A'), 'n:' || tests.v('nt'), 'e:' || tests.v('mira'), null);
select public.board_note_delete(tests.v('nt'));
select tests.ok((select count(*) from public.story_board_links where 'n:' || tests.v('nt') in (from_key, to_key)) = 0, 'removing a note removes its strings');
:as_reviewer
select tests.throws(format($q$select public.board_unlink(%L)$q$, tests.v('ln')), '42501', 'review access cannot change the board');
select tests.ok((select count(*) from public.story_board_links where id = tests.v('ln')) = 1, 'review access can see the board');
:as_dir
select public.board_unlink(tests.v('ln'));
select tests.ok((select count(*) from public.story_board_links where id = tests.v('ln')) = 0, 'string removed');

:as_owner
select n, case when passed then 'PASS' else 'FAIL' end as result, label, detail from tests.results order by n;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from tests.results;
do $$ begin
  if exists (select 1 from tests.results where not passed) then
    raise exception 'Board test suite FAILED';
  end if;
end $$;
