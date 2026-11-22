-- STUDIO — Daily world simulation: limits, approval boundary, exactly-once commits, the
-- dialogue gate, history and access.
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
select tests.put('SA', public.create_project('Sim film A', 'x'));
select tests.put('SB', public.create_project('Sim film B', 'y'));
select tests.put('jo', public.create_entity(tests.v('SA'), 'character', 'Johnny', '{"summary":"Analyst"}'));
select tests.put('ma', public.create_entity(tests.v('SA'), 'character', 'Marie', '{"summary":"Journalist"}'));
select public.sim_settings_save(tests.v('SA'), '{"max_events": 2, "intensity": 2}');

-- Rules (plain language with a small structure)
select tests.put('r1', public.sim_rule_save(tests.v('SA'), null, jsonb_build_object('family', 'character', 'character_id', tests.v('jo'),
  'when_text', 'he finds evidence he cannot explain', 'stress', 1, 'happiness', 0, 'tend_text', 'investigate', 'relief_text', 'talking with his mentor')));
select tests.throws(format($q$select public.sim_rule_save(%L, null, '{"family":"character","when_text":"x y"}')$q$, tests.v('SA')), '22023', 'a character rule names its character');
select tests.ok((select stress from public.sim_rules where id = tests.v('r1')) = 1 and (select effective_day from public.sim_rules where id = tests.v('r1')) = 1, 'rule saved from day 1');

-- Emotional state: two independent axes; stressed and happy together is fine
select public.sim_state_set(tests.v('SA'), tests.v('jo'), 60, 50, null);
select tests.ok((select stress = 60 and happiness = 50 from public.sim_state_of(tests.v('SA'), tests.v('jo'))), 'stressed and happy at the same time');
select tests.ok(public.sim_state_set(tests.v('SA'), tests.v('ma'), 500, -500, null) = 'start', 'starting state set');
select tests.ok((select start_stress = 100 and start_happiness = -100 from public.sim_char_states where character_id = tests.v('ma')), 'state is bounded');

-- Run: the daily limit holds under retries; overlapping runs are refused
select tests.put('run1', (select run_id from public.sim_run_start(tests.v('SA'))));
select tests.throws(format($q$select * from public.sim_run_start(%L)$q$, tests.v('SA')), 'PT409', 'no overlapping runs');
:as_service
select tests.ok(public.sim_run_complete(tests.v('run1'), jsonb_build_array(
  jsonb_build_object('ref', 'e1', 'data', jsonb_build_object('title', 'The CEO resigns', 'basis', 'adaptation', 'characters', jsonb_build_array(
    jsonb_build_object('character_id', tests.v('jo'), 'd_stress', 50, 'd_happiness', -10, 'movement', 'He calls his mentor.')))),
  jsonb_build_object('ref', 'e2', 'depends_on_refs', jsonb_build_array('e1'), 'data', jsonb_build_object('title', 'Johnny meets the mentor', 'basis', 'fiction',
    'characters', jsonb_build_array(jsonb_build_object('character_id', tests.v('jo'), 'd_stress', -5, 'd_happiness', 5)))),
  jsonb_build_object('ref', 'e3', 'data', jsonb_build_object('title', 'Over the limit', 'basis', 'fiction', 'characters', '[]'::jsonb))
), '{}', 'ok', '{}', 0.001, 'claude-haiku-5-5') = 2, 'only up to the daily limit is saved');
:as_dir
select tests.put('e1', (select id from public.sim_events where project_id = tests.v('SA') and day = 1 order by created_at limit 1));
select tests.put('e2', (select id from public.sim_events where project_id = tests.v('SA') and day = 1 and depends_on <> '{}'::jsonb limit 1));
select tests.ok((select count(*) from public.sim_state_changes where project_id = tests.v('SA')) = 0
  and (select stress from public.sim_state_of(tests.v('SA'), tests.v('jo'))) = 60, 'proposals don''t change anyone');
select tests.throws(format($q$select * from public.sim_run_start(%L)$q$, tests.v('SA')), 'PT409', 'a new run waits while proposals are pending');

-- Editing: a changed event needs a fresh preview before approval
select public.sim_event_edit(tests.v('SA'), tests.v('e1'), 1, jsonb_build_object('title', 'The CEO is forced out', 'basis', 'adaptation', 'characters',
  (select data -> 'characters' from public.sim_event_versions where event_id = tests.v('e1') and version = 1)), false);
select tests.throws(format($q$select public.sim_event_decide(%L, %L, 'approve', 2)$q$, tests.v('SA'), tests.v('e1')), 'PT409', 'edited text needs its consequences updated');
select tests.throws(format($q$select public.sim_event_decide(%L, %L, 'approve', 1)$q$, tests.v('SA'), tests.v('e1')), 'PT409', 'a stale version can''t be approved');
:as_service
select public.sim_event_reassessed(tests.v('e1'), 2, jsonb_build_object('title', 'The CEO is forced out', 'basis', 'adaptation', 'characters', jsonb_build_array(
  jsonb_build_object('character_id', tests.v('jo'), 'd_stress', 50, 'd_happiness', -10))), false);
:as_dir
-- Exactly once: two approvals, one change; bounded at 100
select tests.ok(public.sim_event_decide(tests.v('SA'), tests.v('e1'), 'approve', 3) = 'approved', 'approved');
select tests.ok(public.sim_event_decide(tests.v('SA'), tests.v('e1'), 'approve', 3) = 'already', 'a repeated click does nothing');
select tests.ok((select count(*) from public.sim_state_changes where event_id = tests.v('e1')) = 1
  and (select stress = 100 and happiness = 40 from public.sim_state_of(tests.v('SA'), tests.v('jo'))), 'consequences applied once, within bounds');
select tests.throws(format($q$select public.sim_event_edit(%L, %L, 3, '{"title":"rewrite"}', true)$q$, tests.v('SA'), tests.v('e1')), 'PT409', 'approved events are history');

-- Dependencies: the dependent was proposed against e1 version 1; e1 was approved as version 3
select tests.ok(public.sim_event_decide(tests.v('SA'), tests.v('e2'), 'approve', 1) = 'blocked', 'a dependent of a changed event must be reassessed');
select tests.ok((select count(*) from public.sim_state_changes where event_id = tests.v('e2')) = 0, 'and nothing was applied');
select tests.ok((select status from public.sim_events where id = tests.v('e2')) = 'blocked', 'and is marked blocked');
:as_service
select public.sim_event_reassessed(tests.v('e2'), 1, jsonb_build_object('title', 'Johnny meets the mentor', 'basis', 'fiction', 'characters', '[]'::jsonb), true);
:as_dir
select tests.ok((select status from public.sim_events where id = tests.v('e2')) = 'proposed', 'reassessed: proposed again');
select public.sim_event_decide(tests.v('SA'), tests.v('e2'), 'defer', 2);

-- Close the day; deferred move on; the limit isn't refilled by a retry for a decided day
select tests.ok(public.sim_day_close(tests.v('SA'), 1) = 1, 'day 1 closed');
select tests.ok((select day from public.sim_events where id = tests.v('e2')) = 2, 'deferred event moved to day 2');

-- Present-day intervention never rewrites history
select tests.ok(public.sim_state_set(tests.v('SA'), tests.v('jo'), 20, 40, 'a calmer start to the week') = 'adjusted', 'adjusted');
select tests.ok((select start_stress from public.sim_char_states where character_id = tests.v('jo')) = 60
  and (select count(*) from public.sim_state_changes where character_id = tests.v('jo') and kind = 'director') = 1, 'a later change is an intervention, history kept');

-- Rules change prospectively
select public.sim_rule_save(tests.v('SA'), tests.v('r1'), jsonb_build_object('family', 'character', 'character_id', tests.v('jo'), 'when_text', 'he finds evidence', 'stress', 2));
select tests.ok((select effective_day from public.sim_rules where id = tests.v('r1')) = 2
  and (select count(*) from public.sim_rule_versions where rule_id = tests.v('r1')) = 2, 'rule changes apply from the next day, versions kept');

-- Zero events is a valid day
select tests.put('run2', (select run_id from public.sim_run_start(tests.v('SA'))));
:as_service
select tests.ok(public.sim_run_complete(tests.v('run2'), '[]'::jsonb, '{}', 'Nothing new worth an event.', '{}', 0, 'claude-haiku-5-5') = 0, 'zero events is fine');
:as_dir
select tests.throws(format($q$select * from public.sim_run_start(%L)$q$, tests.v('SA')), 'PT409', 'a prepared day isn''t prepared again');

-- Pause stops new runs (and only that)
select public.sim_day_close(tests.v('SA'), 2);
select public.sim_settings_save(tests.v('SA'), '{"paused": true}');
select tests.throws(format($q$select * from public.sim_run_start(%L)$q$, tests.v('SA')), 'PT409', 'paused: no new runs');
select tests.ok(public.sim_rule_save(tests.v('SA'), null, '{"family":"world","when_text":"the news is about chips"}') is not null, 'paused: editing still works');

-- Dialogue gate
select tests.throws(format($q$select * from public.dialogue_request(%L, 'h:abc:1', jsonb_build_object('request_hash', repeat('b', 64), 'events',
  jsonb_build_array(jsonb_build_object('id', %L, 'version', 2))))$q$, tests.v('SA'), tests.v('e2')), 'PT409', 'no dialogue from an unapproved event');
select tests.throws(format($q$select * from public.dialogue_request(%L, 'h:abc:1', jsonb_build_object('request_hash', repeat('b', 64), 'events',
  jsonb_build_array(jsonb_build_object('id', %L, 'version', 1))))$q$, tests.v('SA'), tests.v('e1')), 'PT409', 'no dialogue from a stale approval');
select tests.throws(format($q$select * from public.dialogue_request(%L, 'h:abc:1', jsonb_build_object('trigger', 'event', 'request_hash', repeat('c', 64), 'events',
  jsonb_build_array(jsonb_build_object('id', %L, 'version', 3))))$q$, tests.v('SA'), tests.v('e1')), '22023', 'drafting after approval must be switched on');
select tests.ok((select not existing from public.dialogue_request(tests.v('SA'), 'h:abc:1', jsonb_build_object('request_hash', repeat('d', 64), 'events',
  jsonb_build_array(jsonb_build_object('id', tests.v('e1'), 'version', 3))))), 'dialogue from an approved event is allowed');
select tests.ok((select (event_refs -> 0 ->> 'id')::uuid from public.dialogue_proposals where request_hash = repeat('d', 64)) = tests.v('e1'), 'the draft records the approved event version');

-- Access boundaries
:as_outsider
select tests.ok((select count(*) from public.sim_events where project_id = tests.v('SA')) = 0, 'outsiders see no events');
select tests.throws(format($q$select * from public.sim_run_start(%L)$q$, tests.v('SA')), 'PT404', 'outsiders cannot run the simulation');
select tests.throws(format($q$select public.sim_event_decide(%L, %L, 'approve', 3)$q$, tests.v('SA'), tests.v('e1')), 'PT404', 'outsiders cannot approve');
:as_dir
select tests.throws(format($q$select public.sim_state_set(%L, %L, 1, 1, null)$q$, tests.v('SB'), tests.v('jo')), 'PT404', 'characters stay in their own film');

-- How the world works (periphery rules): no feelings, never one character's, need a "then"
:as_dir
select tests.put('rp', public.sim_rule_save(tests.v('SA'), null, jsonb_build_object('family', 'periphery', 'character_id', tests.v('jo'),
  'when_text', 'news about chips breaks', 'tend_text', 'it reaches Washington the same day', 'stress', 2, 'happiness', -2, 'relief_text', 'x')));
select tests.ok((select stress = 0 and happiness = 0 and character_id is null and relief_text is null from public.sim_rules where id = tests.v('rp')), 'world rules carry no feelings and aren''t about one character');
select tests.ok(public.sim_rule_save(tests.v('SA'), null, '{"family":"periphery","when_text":"News about AI reaches Washington within a day"}') is not null, 'a world rule can be a plain bullet');
select tests.throws(format($q$select public.sim_rule_save(%L, null, '{"family":"nonsense","when_text":"news breaks"}')$q$, tests.v('SA')), '22023', 'unknown kinds refused');

-- Small model calls are charged to the film's AI budget
:as_service
select public.sim_charge(tests.v('SA'), null, 'character_interests', '{"input_tokens":100,"output_tokens":50}', 0.0004, 'claude-haiku-5-5', true);
:as_owner
select tests.ok((select count(*) from public.agent_runs where project_id = tests.v('SA') and task_type = 'character_interests' and status = 'succeeded') = 1, 'small model calls are recorded and charged');

:as_owner
select n, label from tests.results where not passed order by n;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from tests.results;
do $$ begin if exists (select 1 from tests.results where not passed) then raise exception 'World simulation test suite FAILED'; end if; end $$;
