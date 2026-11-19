-- STUDIO — A character's own knowledge collection.
\set ON_ERROR_STOP 1
\pset footer off
set client_min_messages = warning;
\set as_dir      'reset role; select tests.claims(''dir'');      set role authenticated;'
\set as_outsider 'reset role; select tests.claims(''outsider''); set role authenticated;'
\set as_owner    'reset role;'

:as_owner
delete from tests.results;
:as_dir
select tests.put('CA', public.create_project('Character KB film', 'x'));
select tests.put('cj', public.create_entity(tests.v('CA'), 'character', 'Jo', '{"summary":"x"}'));
select tests.put('cjcol', public.kb_character_collection(tests.v('CA'), tests.v('cj')));
select tests.ok(public.kb_character_collection(tests.v('CA'), tests.v('cj')) = tests.v('cjcol'), 'one collection per character, reused');
select tests.ok((select name from public.knowledge_collections where id = tests.v('cjcol')) = 'Jo''s knowledge', 'named after the character');
select tests.ok((select count(*) from public.character_knowledge where character_id = tests.v('cj') and collection_id = tests.v('cjcol') and archived_at is null) = 1,
  'connected to the character');
select public.kb_research_save(tests.v('CA'), null, jsonb_build_object('kind', 'note', 'body', 'Jo grew up near the harbor.', 'collections', jsonb_build_array(tests.v('cjcol'))));
select tests.ok((select count(*) from public.kb_collection_items(tests.v('CA'), array[tests.v('cjcol')])) = 1, 'research added to the character');
select public.character_knowledge_remove(tests.v('CA'), (select id from public.character_knowledge where collection_id = tests.v('cjcol') and archived_at is null));
select public.kb_character_collection(tests.v('CA'), tests.v('cj'));
select tests.ok((select count(*) from public.character_knowledge where collection_id = tests.v('cjcol') and archived_at is null) = 0
  and (select count(*) from public.kb_collection_items(tests.v('CA'), array[tests.v('cjcol')])) = 1, 'her disconnect is respected; the research is kept');
:as_outsider
select tests.throws(format($q$select public.kb_character_collection(%L, %L)$q$, tests.v('CA'), tests.v('cj')), 'PT404', 'outsiders cannot');
:as_owner
select n, label from tests.results where not passed order by n;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from tests.results;
do $$ begin if exists (select 1 from tests.results where not passed) then raise exception 'Character collections test suite FAILED'; end if; end $$;
