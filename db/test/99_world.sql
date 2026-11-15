-- STUDIO — World & Time. Runs after 10_–98_.
\set ON_ERROR_STOP 1
\pset footer off
set client_min_messages = warning;

\set as_dir      'reset role; select tests.claims(''dir'');      set role authenticated;'
\set as_reviewer 'reset role; select tests.claims(''reviewer''); set role authenticated;'
\set as_service  'reset role; select set_config(''request.jwt.claims'', '''', false); set role service_role;'
\set as_owner    'reset role;'

:as_owner
delete from tests.results;

:as_reviewer
select tests.throws(format($q$select public.save_world_section(%L, 'where', '{"places":[{"name":"LA","kind":"real"}],"note":""}', null, null)$q$, tests.v('A')), '42501', 'review access cannot edit World & Time');
select tests.ok((select count(*) from public.story_world where project_id = tests.v('A')) = 0, 'a new film has no world yet (and reading is allowed)');

:as_dir
select tests.ok(public.save_world_section(tests.v('A'), 'where', '{"places":[{"name":"Los Angeles","kind":"real"}],"note":"One city, two moments."}', 0, null) = 1, 'first save is version 1');
select tests.throws(format($q$select public.save_world_section(%L, 'when', '{"periods":[{"label":"2046","precision":"year"}],"note":""}', 0, null)$q$, tests.v('A')), 'PT409', 'a stale edit is refused, not overwritten');
select public.save_world_section(tests.v('A'), 'when', '{"periods":[{"label":"2046","precision":"year","start_year":2046},{"label":"2056","precision":"year","start_year":2056}],"note":""}', 1, null);
select tests.throws(format($q$select public.save_world_section(%L, 'coverage', '"sometimes"', null, null)$q$, tests.v('A')), '22023', 'unknown coverage refused');
select tests.throws(format($q$select public.save_world_section(%L, 'where', '{"places":[{"name":"","kind":"real"}]}', null, null)$q$, tests.v('A')), '22023', 'a place needs a name');
select tests.throws(format($q$select public.save_world_section(%L, 'mood', '{}', null, null)$q$, tests.v('A')), '22023', 'unknown section refused');
select public.save_world_section(tests.v('A'), 'coverage', '"selected"', null, null);
select tests.ok((select data -> 'confirmed' -> 'when' ->> 'source' from public.story_world where project_id = tests.v('A')) = 'director', 'her edits are marked as hers');
select public.save_world_section(tests.v('A'), 'when', '{"periods":[{"label":"1946","precision":"year"}],"note":""}', null, array['Review after a time change (2046 & 2056 → 1946)']);
select tests.ok((select count(*) from public.story_notebook where project_id = tests.v('A') and kind = 'question' and body like 'Review after a time change%') = 1, 'a change leaves a review question');
select tests.ok((select count(*) from public.story_world_history where project_id = tests.v('A')) = 4, 'every change is in the history');

-- World Builder: suggestion vs her decision.
select tests.put('wt', public.start_agent_thread(tests.v('A'), 'world'));
select tests.throws(format($q$select public.start_agent_thread(%L, 'oracle')$q$, tests.v('A')), '22023', 'unknown partner refused');
select tests.put('wr', public.post_agent_message(tests.v('wt'), 'I think it is mostly the same street, every time.'));
select tests.ok((select prompt_version from public.agent_runs where id = tests.v('wr')) = 'world-builder-v1.0', 'world turns use the World Builder');
select tests.throws(format($q$select public.apply_world_notes(%L, '[]')$q$, tests.v('wr')), '42501', 'directors cannot apply agent changes');
:as_service
select public.start_agent_run(tests.v('wr'));
select public.apply_world_notes(tests.v('wr'), '[{"section":"span","value":{"text":"ten years","basis":"creator"},"why":"from her dates"},{"section":"where","value":{"places":[{"name":"One street in Los Angeles","kind":"real"}],"note":""},"her_words":"mostly the same street"}]');
:as_dir
select tests.ok((select data -> 'proposals' -> 'span' ->> 'source' from public.story_world where project_id = tests.v('A')) = 'world_builder', 'without her words it stays a suggestion');
select tests.ok((select data -> 'confirmed' -> 'span' from public.story_world where project_id = tests.v('A')) is null, 'a suggestion never becomes confirmed by itself');
select tests.ok((select data -> 'confirmed' -> 'where' ->> 'source' from public.story_world where project_id = tests.v('A')) = 'conversation', 'her words in the conversation make it her decision');
select public.accept_world_proposal(tests.v('A'), 'span', null);
select tests.ok((select data -> 'confirmed' -> 'span' -> 'value' ->> 'text' from public.story_world where project_id = tests.v('A')) = 'ten years', 'accepting moves it to confirmed');
select tests.ok((select (data -> 'proposals') ? 'span' from public.story_world where project_id = tests.v('A')) = false, 'and clears the suggestion');

-- Dialogue partner.
select tests.put('dt', public.start_agent_thread(tests.v('A'), 'dialogue'));
select tests.put('dr', public.post_agent_message(tests.v('dt'), 'Marie: Who gets the fern?'));
select tests.ok((select prompt_version from public.agent_runs where id = tests.v('dr')) = 'dialogue-partner-v1.0', 'dialogue turns use the Dialogue partner');
:as_service
select public.start_agent_run(tests.v('dr'));
select tests.ok(public.apply_partner_notes(tests.v('dr'), '[{"op":"add","kind":"decision","body":"Voice — Marie: asks about the fern instead of asking him to stay.","her_words":"who gets the fern"}]', null, null) = 1, 'the Dialogue partner can keep notes');
:as_dir
select tests.ok((select status from public.story_notebook where body like 'Voice — Marie%') = 'confirmed', 'her words make a voice note hers');

-- Reading her story.
select tests.put('rr', public.request_world_read(tests.v('A')));
select tests.ok(public.request_world_read(tests.v('A')) is null, 'one read at a time');
:as_service
select public.start_agent_run(tests.v('rr'));
select public.complete_world_read(tests.v('rr'), '{"where":{"value":{"places":[{"name":"Mars","kind":"real"}],"note":""}},"summary":{"value":{"text":"x"}}}', '{}', 0.001, 'm');
:as_dir
select tests.ok((select data -> 'confirmed' -> 'where' -> 'value' -> 'places' -> 0 ->> 'name' from public.story_world where project_id = tests.v('A')) = 'One street in Los Angeles', 'reading never replaces what she confirmed');
select tests.ok((select (data -> 'proposals') ? 'where' from public.story_world where project_id = tests.v('A')) = false, 'and adds no suggestion where she already decided');
select public.dismiss_world_proposal(tests.v('A'), 'where');
:as_reviewer
select tests.throws(format($q$select public.dismiss_world_proposal(%L, 'span')$q$, tests.v('A')), '42501', 'review access cannot dismiss');

:as_owner
select n, case when passed then 'PASS' else 'FAIL' end as result, label, detail from tests.results order by n;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from tests.results;
do $$ begin
  if exists (select 1 from tests.results where not passed) then
    raise exception 'World & Time test suite FAILED';
  end if;
end $$;
