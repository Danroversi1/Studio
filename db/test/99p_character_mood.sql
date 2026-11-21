-- STUDIO — 0–10 mood days: queueing, local judging claims (her computer only, in order),
-- completion, overrides, start, judge choice, access.
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
select tests.put('MA', public.create_project('Mood film', 'x'));
select tests.put('mj', public.create_entity(tests.v('MA'), 'character', 'Jo', '{"summary":"x"}'));
select public.set_character_role(tests.v('mj'), 'protagonist');
:as_owner
-- Two computers: hers, and someone else's.
insert into public.renderer_devices (id, user_id, name, token_hash)
  select gen_random_uuid(), tests.v('dir'), 'Home Mac', repeat('a', 64);
select tests.put('dv', (select id from public.renderer_devices where token_hash = repeat('a', 64)));
insert into public.renderer_devices (id, user_id, name, token_hash)
  select gen_random_uuid(), tests.v('outsider'), 'Other', repeat('b', 64);
select tests.put('dx', (select id from public.renderer_devices where token_hash = repeat('b', 64)));

-- Choosing the judging computer: only her own
:as_dir
select tests.throws(format($q$select public.mood_set_judge(%L, %L)$q$, tests.v('MA'), tests.v('dx')), '22023', 'only her own computer can judge');
select public.mood_set_judge(tests.v('MA'), tests.v('dv'));
select tests.ok((select judge_device = tests.v('dv') from public.bubble_settings where project_id = tests.v('MA')), 'judge computer chosen');

-- Queue two days; the companion gets the oldest first, and only one day per character at a time
:as_service
select tests.put('d1', public.mood_queue(tests.v('MA'), tests.v('mj'), date '2026-11-19', '{"items":[{"key":"a:1"}],"rules":[{"id":"r"}]}', true));
select tests.put('d2', public.mood_queue(tests.v('MA'), tests.v('mj'), date '2026-11-20', '{"items":[{"key":"b:1"}],"rules":[{"id":"r"}]}', true));
select tests.ok(public.mood_queue(tests.v('MA'), tests.v('mj'), date '2026-11-20', '{"items":[]}', true) = tests.v('d2'), 'queueing is idempotent');
select tests.ok(public.mood_claim(tests.v('dx')) is null, 'another computer gets nothing');
select tests.ok(public.mood_claim(tests.v('dv')) = tests.v('d1'), 'oldest day first');
select tests.ok(public.mood_claim(tests.v('dv')) is null, 'the next day waits until the earlier one is settled');
select tests.throws(format($q$select public.mood_complete(%L, %L, '[]', 'm')$q$, tests.v('d1'), tests.v('dx')), 'PT404', 'only the claiming computer can complete');
select public.mood_complete(tests.v('d1'), tests.v('dv'), '[{"item_key":"a:1","rule_id":"r","relation":1,"reason":"fits"}]', 'qwen3:8b');
select tests.ok((select status = 'judged' and model = 'qwen3:8b' from public.mood_days where id = tests.v('d1')), 'judged');
select tests.ok(public.mood_claim(tests.v('dv')) is null, 'a judged-but-unscored day still holds the next one');
select public.mood_put_score(tests.v('d1'), 5, 1, 10, 7);
select tests.ok(public.mood_claim(tests.v('dv')) = tests.v('d2'), 'then the next day is offered');
select public.mood_fail(tests.v('d2'), tests.v('dv'), 'Ollama not running');
select tests.ok((select claimed_at is null and error = 'Ollama not running' and status = 'waiting' from public.mood_days where id = tests.v('d2')), 'a failure frees the day to retry');
update public.mood_days set attempts = 3 where id = tests.v('d2');
select tests.ok(public.mood_claim(tests.v('dv')) is null, 'nothing left to claim');
select tests.ok((select status from public.mood_days where id = tests.v('d2')) = 'failed', 'retries are bounded');
select tests.ok(public.mood_queue(tests.v('MA'), tests.v('mj'), date '2026-11-19', '{"items":[]}', false) = tests.v('d1')
  and (select status = 'scored' and jsonb_array_length(judgments) = 1 from public.mood_days where id = tests.v('d1')), 'a scored day keeps its judgments');

-- Her controls
:as_dir
select public.mood_override(tests.v('MA'), tests.v('mj'), date '2026-11-19', 3.3, 'He is worse than it looks');
select tests.ok((select override = 3.5 and override_note is not null from public.mood_days where id = tests.v('d1')), 'override saved (to the half point)');
select tests.throws(format($q$select public.mood_override(%L, %L, date '2026-11-19', 11, null)$q$, tests.v('MA'), tests.v('mj')), '22023', 'override stays 0–10');
select public.mood_set_start(tests.v('MA'), tests.v('mj'), 6);
select tests.ok((select mood_start = 6 from public.sim_char_states where character_id = tests.v('mj')), 'start set');

-- Access
:as_outsider
select tests.ok((select count(*) from public.mood_days where project_id = tests.v('MA')) = 0, 'outsiders see no moods');
select tests.throws(format($q$select public.mood_set_start(%L, %L, 2)$q$, tests.v('MA'), tests.v('mj')), 'PT404', 'outsiders can''t change moods');
select tests.throws($q$select public.mood_claim(gen_random_uuid())$q$, '42501', 'claims are server-only');

:as_owner
select n, label from tests.results where not passed order by n;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from tests.results;
do $$ begin if exists (select 1 from tests.results where not passed) then raise exception 'Character mood test suite FAILED'; end if; end $$;
