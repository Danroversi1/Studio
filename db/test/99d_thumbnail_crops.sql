-- STUDIO — thumbnails as treatment crops. Runs after 10_–99c_.
\set ON_ERROR_STOP 1
\pset footer off
set client_min_messages = warning;
\set as_dir      'reset role; select tests.claims(''dir'');      set role authenticated;'
\set as_reviewer 'reset role; select tests.claims(''reviewer''); set role authenticated;'
\set as_owner    'reset role;'

:as_owner
delete from tests.results;
:as_dir
select public.add_reference(tests.v('story'), 'https://docs.google.com/presentation/d/DECK_abcdef123/edit', 'Treatment', 'Director (own work)', 'Director treatment', 'unknown');
select public.set_entity_thumbnail_crop(tests.v('mira'), '{"file_id":"DECK_abcdef123","slide":3,"x":0.1,"y":0.2,"w":0.3,"h":0.4}');
select tests.ok((select metadata -> 'thumbnail_crop' ->> 'slide' from public.entities where id = tests.v('mira')) = '3', 'a crop of slide 3 is saved, nothing stored');
select tests.ok((select metadata ? 'thumbnail_asset_id' from public.entities where id = tests.v('mira')) = false, 'a crop replaces a stored picture');
select public.set_entity_thumbnail_crop(tests.v('mira'), '{"file_id":"DECK_abcdef123","slide":4,"slide_id":"g2a1b3c_0_12","x":0.1,"y":0.2,"w":0.3,"h":0.4}');
select tests.ok((select metadata -> 'thumbnail_crop' ->> 'slide_id' from public.entities where id = tests.v('mira')) = 'g2a1b3c_0_12', 'the slide''s permanent ID is kept with the spot and size');
select tests.ok((select (metadata -> 'thumbnail_crop' ->> 'x')::numeric from public.entities where id = tests.v('mira')) = 0.1, 'the spot is kept');
select tests.throws(format($q$select public.set_entity_thumbnail_crop(%L, '{"file_id":"DECK_abcdef123","slide":1,"slide_id":"bad id!","x":0,"y":0,"w":0.5,"h":0.5}')$q$, tests.v('mira')), '22023', 'odd slide IDs refused');
select tests.throws(format($q$select public.set_entity_thumbnail_crop(%L, '{"file_id":"NOT_LINKED_999","slide":1,"x":0,"y":0,"w":0.5,"h":0.5}')$q$, tests.v('mira')), '22023', 'only this film''s treatment');
select tests.throws(format($q$select public.set_entity_thumbnail_crop(%L, '{"file_id":"DECK_abcdef123","slide":1,"x":0.8,"y":0,"w":0.5,"h":0.5}')$q$, tests.v('mira')), '22023', 'a crop stays inside the slide');
select tests.throws(format($q$select public.set_entity_thumbnail_crop(%L, '{"file_id":"DECK_abcdef123","slide":1,"x":0,"y":0,"w":0.5,"h":0.5}')$q$, tests.v('story')), '22023', 'the story has no thumbnail');
select public.set_entity_thumbnail_crop(tests.v('mira'), null);
select tests.ok((select metadata ? 'thumbnail_crop' from public.entities where id = tests.v('mira')) = false, 'a crop can be cleared');
:as_reviewer
select tests.throws(format($q$select public.set_entity_thumbnail_crop(%L, null)$q$, tests.v('mira')), '42501', 'review access cannot choose thumbnails');

:as_owner
select n, case when passed then 'PASS' else 'FAIL' end as result, label, detail from tests.results order by n;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from tests.results;
do $$ begin
  if exists (select 1 from tests.results where not passed) then raise exception 'Thumbnail crop test suite FAILED'; end if;
end $$;
