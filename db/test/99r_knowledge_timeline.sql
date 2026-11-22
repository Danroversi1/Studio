-- STUDIO — Knowledge Timeline: antagonist sees ahead (permission), protagonist one day
-- behind (discoveries close gaps), others the present; briefings, predictions, interventions.
\set ON_ERROR_STOP 1
\pset footer off
set client_min_messages = warning;
\set as_dir      'reset role; select tests.claims(''dir'');      set role authenticated;'
\set as_outsider 'reset role; select tests.claims(''outsider''); set role authenticated;'
\set as_owner    'reset role;'

:as_owner
delete from tests.results;

:as_dir
select tests.put('TL', public.create_project('Timeline film', 'x'));
select tests.put('tj', public.create_entity(tests.v('TL'), 'character', 'Johnny', '{"summary":"x"}'));
select tests.put('tx', public.create_entity(tests.v('TL'), 'character', 'Mr. X', '{"summary":"x"}'));
select tests.put('td', public.create_entity(tests.v('TL'), 'character', 'Director', '{"summary":"x"}'));
select public.set_character_role(tests.v('tj'), 'protagonist');
select public.set_character_role(tests.v('tx'), 'antagonist');
select public.set_character_role(tests.v('td'), 'supporting');
select tests.put('note', public.kb_research_save(tests.v('TL'), null, '{"kind":"note","title":"Wire","body":"Something."}'));
select public.timeline_set_anchor(tests.v('TL'), ((current_date at time zone 'UTC')::date - 10));

:as_owner
-- Three items: on story days 1, 2 and 5 (anchor = 10 days ago; world day = 1).
insert into public.knowledge_items (id, project_id, source_id, dedupe_key, title, content, content_status, content_hash, published_at)
select x.id, tests.v('TL'), tests.v('note'), x.k, x.t, 'c', 'full_text', x.k, ((current_date at time zone 'UTC')::date - 10 + x.d - 1)::timestamptz + interval '12 hours'
  from (values ('00000000-0000-0000-0000-0000000000d1'::uuid, 'k1', 'Day one news', 1),
               ('00000000-0000-0000-0000-0000000000d2'::uuid, 'k2', 'Day two news', 2),
               ('00000000-0000-0000-0000-0000000000d5'::uuid, 'k5', 'Day five news', 5)) as x(id, k, t, d);
select tests.ok(public.timeline_world_day(tests.v('TL')) = 1 and public.timeline_item_day('00000000-0000-0000-0000-0000000000d5') = 5, 'items fall on story days by date');
select tests.ok(public.timeline_reach(tests.v('tj'), 1) = 0, 'Johnny: through the day before (pre-story at day 1)');
select tests.ok(public.timeline_reach(tests.v('td'), 1) = 1, 'supporting: through the current day');
select tests.ok(public.timeline_reach(tests.v('tx'), 1) = 1, 'antagonist without the permission: the present only');
select tests.ok(not public.timeline_can_see(tests.v('tj'), '00000000-0000-0000-0000-0000000000d1', 1), 'Johnny can''t see day 1 news on day 1');

:as_dir
select tests.throws(format($q$select public.timeline_access_set(%L, true, 4)$q$, tests.v('tj')), '22023', 'a protagonist can''t be given future access');
select tests.throws(format($q$select public.timeline_access_set(%L, true, 4)$q$, tests.v('td')), '22023', 'nor a supporting character');
select public.timeline_access_set(tests.v('tx'), true, 4);
:as_owner
select tests.ok(public.timeline_reach(tests.v('tx'), 1) = 5 and public.timeline_can_see(tests.v('tx'), '00000000-0000-0000-0000-0000000000d5', 1), 'the antagonist sees the buffer through day 5');

:as_dir
-- Predictions need evidence he has encountered.
select tests.throws(format($q$select public.timeline_prediction_add(%L, 'They will move', '{}', array['00000000-0000-0000-0000-0000000000d5'::uuid])$q$, tests.v('tj')), '22023', 'no prediction from the future buffer');
select tests.throws(format($q$select public.timeline_prediction_add(%L, 'They will move', '{}', array['00000000-0000-0000-0000-0000000000d1'::uuid])$q$, tests.v('tj')), '22023', 'nor from today''s feed he hasn''t seen');
select tests.throws(format($q$select public.timeline_discovery_add(%L, 'research', 'Saw it', null, '00000000-0000-0000-0000-0000000000d5')$q$, tests.v('tj')), '22023', 'discoveries can''t reach the future');
select tests.put('disc', public.timeline_discovery_add(tests.v('tj'), 'forensic', 'The wire was cut the same way', 'He examined the debris', '00000000-0000-0000-0000-0000000000d1'));
:as_owner
select tests.ok(public.timeline_can_see(tests.v('tj'), '00000000-0000-0000-0000-0000000000d1', 1), 'a discovery closes that gap');
select tests.ok(public.timeline_reach(tests.v('tj'), 1) = 0, 'the delay in his feeds stays');
:as_dir
select tests.put('pred', public.timeline_prediction_add(tests.v('tj'), 'Another one will follow', array[tests.v('disc')::uuid], array['00000000-0000-0000-0000-0000000000d1'::uuid]));
select tests.ok((select count(*) from public.knowledge_predictions where id = tests.v('pred')) = 1, 'a prediction from his own evidence');

-- Briefings: only what the antagonist can see; supporting can't query the buffer.
select tests.throws(format($q$select public.timeline_briefing_add(%L, %L, 'warning', 'Be careful', array['00000000-0000-0000-0000-0000000000d5'::uuid], '{}')$q$, tests.v('td'), tests.v('tj')), '22023', 'a supporting character can''t pass on the future');
select tests.put('brief', public.timeline_briefing_add(tests.v('tx'), tests.v('td'), 'briefing', 'Expect trouble at the plant', array['00000000-0000-0000-0000-0000000000d5'::uuid], '{}'));
select tests.ok((select kind from public.knowledge_briefings where id = tests.v('brief')) = 'briefing', 'the antagonist briefs the director: recorded');

-- Interventions flag future developments; the original is kept.
select tests.throws(format($q$select public.timeline_intervention_add(%L, 'He warns the plant', null, null, '{}', array['00000000-0000-0000-0000-0000000000d1'::uuid])$q$, tests.v('tj')), '22023', 'only developments still ahead are flagged');
select tests.put('int', public.timeline_intervention_add(tests.v('tj'), 'He warns the plant', 'The attack may not happen', tests.v('pred')::uuid, array[tests.v('disc')::uuid], array['00000000-0000-0000-0000-0000000000d5'::uuid]));
select tests.ok((select original ->> 'title' = 'Day five news' and original -> 'known_by' ? 'Mr. X' and status = 'needs_reassessment'
  from public.knowledge_trajectory_flags where intervention_id = tests.v('int')), 'flagged, with what the antagonist knew');
select tests.throws(format($q$select public.timeline_briefing_add(null, %L, 'update', 'Revised', '{}', array[(select id from public.knowledge_trajectory_flags where intervention_id = %L)])$q$, tests.v('tx'), tests.v('int')), '22023', 'no update before reassessment');
select public.timeline_flag_reassess((select id from public.knowledge_trajectory_flags where intervention_id = tests.v('int')), 'The plant is on alert; the attack is delayed.');
select tests.put('upd', public.timeline_briefing_add(null, tests.v('tx'), 'update', 'The plant went on alert', '{}', array[(select id from public.knowledge_trajectory_flags where intervention_id = tests.v('int'))]));
select tests.throws(format($q$select public.timeline_briefing_add(null, %L, 'update', 'Revised', '{}', array[(select id from public.knowledge_trajectory_flags where intervention_id = %L)])$q$, tests.v('td'), tests.v('int')), '22023', 'updated briefings go to an antagonist');
select public.timeline_intervention_outcome(tests.v('int'), 'The plant shut early; nobody was hurt.');
select tests.ok((select outcome is not null from public.knowledge_interventions where id = tests.v('int')), 'what happened afterwards is kept');

-- Role change turns access off; the anchor is fixed after a closed day.
select public.set_character_role(tests.v('tx'), 'supporting');
select tests.ok((select not enabled from public.knowledge_future_access where character_id = tests.v('tx')), 'no longer antagonist: future access off');
:as_owner
update public.sim_settings set clock_day = 1 where project_id = tests.v('TL');
:as_dir
select tests.throws(format($q$select public.timeline_set_anchor(%L, current_date - 3)$q$, tests.v('TL')), '22023', 'Day 1 is fixed once a day is closed');
select tests.throws($q$insert into public.knowledge_discoveries (project_id, character_id, day, method, what, created_by) values (gen_random_uuid(), gen_random_uuid(), 1, 'research', 'xxx', gen_random_uuid())$q$, '42501', 'no direct writes');
:as_outsider
select tests.throws(format($q$select public.timeline_discovery_add(%L, 'research', 'Mine', null, null)$q$, tests.v('tj')), 'PT404', 'outsiders can''t record discoveries');

:as_owner
select n, label from tests.results where not passed order by n;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from tests.results;
do $$ begin if exists (select 1 from tests.results where not passed) then raise exception 'Timeline test suite FAILED'; end if; end $$;
