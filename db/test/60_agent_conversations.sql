-- STUDIO — conversations with the Story and Design partners. Runs after 10_–50_.
\set ON_ERROR_STOP 1
\pset footer off
set client_min_messages = warning;

\set as_dir      'reset role; select tests.claims(''dir'');      set role authenticated;'
\set as_viewer   'reset role; select tests.claims(''viewer'');   set role authenticated;'
\set as_reviewer 'reset role; select tests.claims(''reviewer''); set role authenticated;'
\set as_outsider 'reset role; select tests.claims(''outsider''); set role authenticated;'
\set as_anon     'reset role; select set_config(''request.jwt.claims'', '''', false); set role anon;'
\set as_ep       'reset role; select tests.claims(''ep'');       set role authenticated;'
\set as_service  'reset role; select set_config(''request.jwt.claims'', '''', false); set role service_role;'
\set as_owner    'reset role;'

:as_owner
delete from tests.results;

:as_anon
select tests.throws($$select public.start_agent_thread(tests.v('A'), 'story')$$, '42501', 'anon cannot start a conversation');
:as_outsider
select tests.throws($$select public.start_agent_thread(tests.v('A'), 'story')$$, 'PT404', 'outsider cannot start a conversation');
:as_reviewer
select tests.throws($$select public.start_agent_thread(tests.v('A'), 'story')$$, '42501', 'review access cannot talk to partners');

:as_dir
select tests.throws($$select public.start_agent_thread(tests.v('A'), 'villain')$$, '22023', 'unknown partner refused');
select tests.put('th', public.start_agent_thread(tests.v('A'), 'design'));
select tests.throws($$select public.post_agent_message(tests.v('th'), '   ')$$, '22023', 'empty message refused');
select tests.throws($$select public.post_agent_message(tests.v('th'), repeat('x', 6001))$$, '22023', 'very long message refused');
select tests.put('turn1', public.post_agent_message(tests.v('th'), 'The lighthouse should feel safe   but lonely.'));
select tests.throws($$select public.post_agent_message(tests.v('th'), 'Are you there?')$$, 'PT409', 'one reply at a time');
select tests.ok((select title from public.agent_threads where id = tests.v('th')) = 'The lighthouse should feel safe but lonely.', 'thread titled from first message');
select tests.ok((select domain::text from public.agent_runs where id = tests.v('turn1')) = 'production_designer', 'design turns run in the design domain');
select tests.ok((select input_payload ->> 'entity_id' from public.agent_runs where id = tests.v('turn1')) = tests.v('story')::text,
  'turn is tied to the story so accepted suggestions link to it');
select tests.throws($$insert into public.agent_messages (project_id, thread_id, role, content) values (tests.v('A'), tests.v('th'), 'assistant', 'fake')$$,
  '42501', 'clients cannot write messages directly');
select tests.throws($$select public.complete_agent_turn(tests.v('turn1'), 'hi', '[]', '{}', 0, 'x')$$, '42501', 'clients cannot record replies');

:as_service
select public.start_agent_run(tests.v('turn1'));
select tests.put('reply1', public.complete_agent_turn(tests.v('turn1'), 'One question: whose safety is it?',
  '[{"entity_kind":"location","name":"Lamp Room","summary":"Top of the lighthouse.","evidence":[]}]',
  '{"input_tokens":3000,"output_tokens":200}', 0.008, 'claude-sonnet-5-5'));
select tests.throws($$select public.complete_agent_turn(tests.v('turn1'), 'again', '[]', '{}', 0, 'x')$$, 'PT409', 'a turn cannot be answered twice');
select tests.throws($$update public.agent_messages set content = 'edited' where id = tests.v('reply1')$$, '42501', 'messages are append-only');

:as_dir
select tests.ok(tests.n($$select 1 from public.agent_messages where thread_id = tests.v('th')$$) = 2, 'director sees both messages');
select tests.ok(tests.n($$select 1 from public.agent_proposals where agent_run_id = tests.v('turn1') and status = 'pending'$$) = 1,
  'a suggestion from the conversation waits in the inbox');
select tests.put('lamp', public.accept_proposal((select id from public.agent_proposals where agent_run_id = tests.v('turn1')), null, null));
select tests.ok((select current_version_id is null from public.entities where id = tests.v('lamp')), 'accepted suggestion is not approved');
select tests.ok(exists (select 1 from public.entity_relationships where source_entity_id = tests.v('story') and target_entity_id = tests.v('lamp')),
  'accepted location is linked to the story');
select tests.lives($$select public.post_agent_message(tests.v('th'), 'Hers. Next question?')$$, 'next message allowed after the reply');
:as_reviewer
select tests.ok(tests.n($$select 1 from public.agent_messages where thread_id = tests.v('th')$$) = 3, 'review access can read the conversation');
:as_viewer
select tests.ok(tests.n($$select 1 from public.agent_messages where thread_id = tests.v('th')$$) = 0, 'view access cannot read it');
:as_outsider
select tests.ok(tests.n($$select 1 from public.agent_threads$$) = 0, 'outsiders see no conversations');
:as_ep
select tests.ok((public.my_ai_budget(tests.v('A')) ->> 'spent_usd')::numeric >= 0.008, 'replies are charged to the budget');
select public.set_ai_budget(tests.v('A'), 0.2);
:as_owner
update public.agent_runs set status = 'cancelled' where project_id = tests.v('A') and task_type = 'conversation_turn' and status = 'queued';
:as_dir
select tests.throws($$select public.post_agent_message(tests.v('th'), 'Still there?')$$, 'PT402', 'budget applies to conversations');
:as_ep
select public.set_ai_budget(tests.v('A'), 10);

:as_owner
select n, case when passed then 'PASS' else 'FAIL' end as result, label, detail from tests.results order by n;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from tests.results;
do $$ begin
  if exists (select 1 from tests.results where not passed) then
    raise exception 'Agent conversation test suite FAILED';
  end if;
end $$;
