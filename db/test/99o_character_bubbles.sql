-- STUDIO — Characters' daily media bubbles: eligibility, role changes, run locking, snapshot
-- history, no canonical changes, access.
\set ON_ERROR_STOP 1
\pset footer off
set client_min_messages = warning;
\set as_dir      'reset role; select tests.claims(''dir'');      set role authenticated;'
\set as_outsider 'reset role; select tests.claims(''outsider''); set role authenticated;'
\set as_service  'reset role; select set_config(''request.jwt.claims'', '''', false); set role service_role;'
\set as_owner    'reset role;'

:as_owner
delete from tests.results;

:as_dir
select tests.put('BA', public.create_project('Bubble film', 'x'));
select tests.put('bj', public.create_entity(tests.v('BA'), 'character', 'Jo', '{"summary":"x"}'));
select tests.put('bf', public.create_entity(tests.v('BA'), 'character', 'Extra', '{"summary":"x"}'));
select public.set_character_role(tests.v('bj'), 'protagonist');
select public.set_character_role(tests.v('bf'), 'featured');

-- Only main roles get a bubble
select public.bubble_profile_save(tests.v('BA'), tests.v('bj'), array['AI', 'chips', ' ', 'AI'], array['sports'], 99);
select tests.ok((select topics = array['AI', 'chips'] and attention = 15 from public.character_bubbles where character_id = tests.v('bj')), 'topics cleaned, attention bounded');
select tests.throws(format($q$select public.bubble_profile_save(%L, %L, array['x y'], '{}', 3)$q$, tests.v('BA'), tests.v('bf')), '22023', 'featured characters have no bubble');

-- Settings: timezone checked; pause
select tests.throws(format($q$select public.bubble_settings_save(%L, '{"timezone":"Mars/Olympus"}')$q$, tests.v('BA')), '22023', 'unknown timezone refused');
select public.bubble_settings_save(tests.v('BA'), '{"timezone":"Europe/Paris","preferred_time":"06:30"}');
select tests.ok((select timezone = 'Europe/Paris' and preferred_time = '06:30' from public.bubble_settings where project_id = tests.v('BA')), 'timezone and time saved');

-- Runs: one at a time (manual and scheduled share the lock); local date in the film's timezone
select tests.put('br1', public.bubble_refresh_start(tests.v('BA')));
select tests.throws(format($q$select public.bubble_refresh_start(%L)$q$, tests.v('BA')), 'PT409', 'a second refresh waits for the first');
select tests.ok((select run_date = (now() at time zone 'Europe/Paris')::date from public.bubble_runs where id = tests.v('br1')), 'run date is the film''s local date');
:as_service
select tests.throws(format($q$select public.bubble_refresh_start_scheduled(%L)$q$, tests.v('BA')), 'PT409', 'the scheduled run can''t overlap a manual one');
select tests.ok(public.bubble_snapshot_put(tests.v('br1'), tests.v('bj'), '[{"key":"a:1","item_id":"a","title":"A"},{"key":"b:1","item_id":"b","title":"B"}]', 'Two items.', '{}') = 2, 'snapshot saved');
select tests.ok(public.bubble_snapshot_put(tests.v('br1'), tests.v('bj'), '[{"key":"b:1","item_id":"b","title":"B"},{"key":"c:1","item_id":"c","title":"C"},{"key":"b:2","item_id":"b","title":"B (corrected)","update_of":1}]', 'Three items.', '{}') = 2, 'a second pass adds only what''s new (a correction is a new entry)');
select public.bubble_run_finish(tests.v('br1'), 'succeeded', '{}', 3, null, null);
-- An earlier day stays as it was
insert into public.bubble_snapshots (project_id, character_id, run_date, items, summary) values (tests.v('BA'), tests.v('bj'), current_date - 3, '[{"item_id":"old"}]', 'Old day.');
:as_dir
select tests.ok((select jsonb_array_length(items) = 4 from public.bubble_snapshots where character_id = tests.v('bj') and run_date = (now() at time zone 'Europe/Paris')::date), 'no duplicates within a day');
select tests.ok((select summary = 'Old day.' from public.bubble_snapshots where character_id = tests.v('bj') and run_date = current_date - 3), 'earlier days are kept as history');

-- Refreshing changes nothing canonical
select tests.ok((select count(*) from public.sim_events where project_id = tests.v('BA')) = 0
  and (select count(*) from public.sim_state_changes where project_id = tests.v('BA')) = 0
  and (select count(*) from public.dialogue_proposals where project_id = tests.v('BA')) = 0
  and coalesce((select clock_day from public.sim_settings where project_id = tests.v('BA')), 0) = 0, 'no events, feelings, dialogue or story time from a refresh');

-- Pause: a scheduled run records a skip, no work
select public.bubble_settings_save(tests.v('BA'), '{"paused":true}');
:as_service
select tests.ok(public.bubble_refresh_start_scheduled(tests.v('BA')) is null, 'paused: scheduled refresh does nothing');
:as_dir
select tests.ok((select status from public.bubble_runs where project_id = tests.v('BA') order by started_at desc limit 1) = 'skipped', 'and the skip is recorded');

-- Role changes: Featured pauses (history kept); an eligible role offers resumption, nothing back-filled
select public.set_character_role(tests.v('bj'), 'featured');
select tests.ok((select not active and inactive_reason = 'role' from public.character_bubbles where character_id = tests.v('bj')), 'featured: bubble paused');
select tests.ok((select count(*) from public.bubble_snapshots where character_id = tests.v('bj')) = 2, 'history kept');
select tests.throws(format($q$select public.bubble_set_active(%L, %L, true)$q$, tests.v('BA'), tests.v('bj')), '22023', 'can''t resume while featured');
select public.set_character_role(tests.v('bj'), 'supporting');
select tests.ok((select not active from public.character_bubbles where character_id = tests.v('bj')), 'an eligible role doesn''t resume by itself');
select public.bubble_set_active(tests.v('BA'), tests.v('bj'), true);
select tests.ok((select active and inactive_reason is null from public.character_bubbles where character_id = tests.v('bj')), 'resumed when she chooses');

-- Access
:as_outsider
select tests.ok((select count(*) from public.bubble_snapshots where project_id = tests.v('BA')) = 0, 'outsiders see no bubbles');
select tests.throws(format($q$select public.bubble_refresh_start(%L)$q$, tests.v('BA')), 'PT404', 'outsiders can''t refresh');

-- Interests: a character's own daily searches (kept apart from World topics)
:as_dir
select tests.put('IF', public.create_project('Interests film', 'x'));
select tests.put('ij', public.create_entity(tests.v('IF'), 'character', 'Ivy', '{"summary":"x"}'));
select tests.put('ix', public.create_entity(tests.v('IF'), 'character', 'Extra', '{"summary":"x"}'));
select public.set_character_role(tests.v('ij'), 'protagonist');
select public.set_character_role(tests.v('ix'), 'featured');
select tests.ok(public.kb_character_watch_add(tests.v('IF'), tests.v('ij'), 'chess', '[{"adapter":"rss","feed_url":"https://news.google.com/rss/search?q=chess","title":"News: chess"}]') = 1, 'an interest becomes a daily search');
select tests.ok((select 'chess' = any(topics) from public.character_bubbles where character_id = tests.v('ij')), 'and a topic of their coverage');
select tests.ok((select count(*) from public.knowledge_collection_members m join public.knowledge_collections c on c.id = m.collection_id
  where c.character_id = tests.v('ij') and m.source_id in (select id from public.knowledge_sources where watch_character = tests.v('ij'))) = 1, 'kept in their own collection');
select tests.throws(format($q$select public.kb_character_watch_add(%L, %L, 'Chess', '[]')$q$, tests.v('IF'), tests.v('ij')), '23505', 'no duplicates');
select tests.throws(format($q$select public.kb_character_watch_add(%L, %L, 'golf', '[]')$q$, tests.v('IF'), tests.v('ix')), '22023', 'featured characters have no interests');
select tests.throws(format($q$select public.kb_character_watch_add(%L, %L, 'spam', '[{"adapter":"rss","feed_url":"https://evil.example/rss"}]')$q$, tests.v('IF'), tests.v('ij')), '22023', 'only the free searches');
select tests.ok(public.kb_world_watch_add(tests.v('IF'), 'chess', '[{"adapter":"rss","feed_url":"https://news.google.com/rss/search?q=chess2","title":"News: chess"}]') = 1, 'the World can follow the same thing separately');
select public.kb_world_watch_remove(tests.v('IF'), 'chess');
select tests.ok((select count(*) from public.knowledge_sources where watch_character = tests.v('ij') and disconnected_at is null) = 1, 'removing the World topic leaves the character''s interest');
select public.kb_character_watch_remove(tests.v('IF'), tests.v('ij'), 'CHESS');
select tests.ok((select not ('chess' = any(topics)) from public.character_bubbles where character_id = tests.v('ij'))
  and (select count(*) from public.knowledge_sources where watch_character = tests.v('ij') and disconnected_at is null) = 0, 'removing an interest stops its search and topic');
select tests.ok(public.interests_ai_check(tests.v('IF'), tests.v('ij')) is not null, 'suggesting interests is allowed within budget');
:as_outsider
select tests.throws(format($q$select public.kb_character_watch_add(%L, %L, 'x y', '[]')$q$, tests.v('IF'), tests.v('ij')), 'PT404', 'outsiders can''t add interests');

:as_owner
select n, label from tests.results where not passed order by n;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from tests.results;
do $$ begin if exists (select 1 from tests.results where not passed) then raise exception 'Character bubbles test suite FAILED'; end if; end $$;
