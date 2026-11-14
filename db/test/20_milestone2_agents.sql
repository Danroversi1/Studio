-- STUDIO milestone 2a — agent proposal, decision and budget tests.
-- Runs after 10_milestone1_security.sql in the same database (reuses its tests.* harness,
-- seeded users and project A).
\set ON_ERROR_STOP 1
\pset footer off
set client_min_messages = warning;

\set as_dir       'reset role; select tests.claims(''dir'');       set role authenticated;'
\set as_viewer    'reset role; select tests.claims(''viewer'');    set role authenticated;'
\set as_reviewer  'reset role; select tests.claims(''reviewer'');  set role authenticated;'
\set as_editor    'reset role; select tests.claims(''editor'');    set role authenticated;'
\set as_ep        'reset role; select tests.claims(''ep'');        set role authenticated;'
\set as_outsider  'reset role; select tests.claims(''outsider'');  set role authenticated;'
\set as_service   'reset role; select set_config(''request.jwt.claims'', '''', false); set role service_role;'
\set as_owner     'reset role;'

:as_owner
delete from tests.results;

-- ---------------------------------------------------------------------------
-- Requesting a breakdown
-- ---------------------------------------------------------------------------
:as_dir
select tests.throws($$select public.request_story_breakdown(tests.v('story'))$$, '22023', 'breakdown needs a real story first');
select tests.put('s_long', public.create_revision(tests.v('story'),
  '{"body":"Mira, twelve, keeps the lighthouse on the rocky point after her grandfather falls ill. Old Tom the ferryman brings supplies from the harbor town every Sunday. One stormy night a ship loses its way."}',
  'longer draft', tests.v('s_v1'), tests.v('s_v1')));
select tests.throws($$select public.request_story_breakdown(tests.v('mira'))$$, '22023', 'only stories can be broken down');

:as_viewer
select tests.throws($$select public.request_story_breakdown(tests.v('story'))$$, '42501', 'viewer cannot start a breakdown');
:as_reviewer
select tests.throws($$select public.request_story_breakdown(tests.v('story'))$$, '42501', 'reviewer cannot start a breakdown');
:as_outsider
select tests.throws($$select public.request_story_breakdown(tests.v('story'))$$, 'PT404', 'outsider cannot start a breakdown');

:as_editor
select tests.put('run1', public.request_story_breakdown(tests.v('story')));
select tests.ok(public.request_story_breakdown(tests.v('story')) = tests.v('run1'), 'a second request reuses the run in progress');
select tests.throws($$select public.start_agent_run(tests.v('run1'))$$, '42501', 'clients cannot start agent runs');
select tests.throws($$select public.complete_story_breakdown(tests.v('run1'), '[]', '{}', 0, 'x')$$, '42501', 'clients cannot record agent results');
select tests.throws($$insert into public.agent_proposals (project_id, agent_run_id, entity_kind, name)
  values (tests.v('A'), tests.v('run1'), 'character', 'Forged')$$, '42501', 'clients cannot insert proposals');
select tests.throws($$insert into public.resource_transactions (project_id, transaction_type, resource_type, amount)
  values (tests.v('A'), 'credit', 'llm_tokens', 100)$$, '42501', 'clients cannot record charges or credits');

-- Another project with a character, to try a cross-project match.
:as_outsider
select tests.put('C', public.create_project('Elsewhere'));
select tests.put('c_char', public.create_entity(tests.v('C'), 'character', 'Stranger', '{"summary":"x"}'));

-- ---------------------------------------------------------------------------
-- The trusted worker records results
-- ---------------------------------------------------------------------------
:as_service
select tests.ok(public.start_agent_run(tests.v('run1')), 'worker claims the queued run');
select tests.ok(not public.start_agent_run(tests.v('run1')), 'a second worker cannot claim it');
select tests.lives(format($q$select public.complete_story_breakdown(%L, %L::jsonb, '{"input_tokens":1200,"output_tokens":600}', 0.05, 'claude-sonnet-5-5')$q$,
  tests.v('run1'),
  json_build_array(
    json_build_object('entity_kind','character','name','Old Tom','summary','The ferryman.','evidence',json_build_array('Old Tom the ferryman brings supplies')),
    json_build_object('entity_kind','location','name','Harbor town','summary','Where supplies come from.','evidence',json_build_array('the harbor town')),
    json_build_object('entity_kind','character','name','Mira','summary','Keeper.','evidence',json_build_array('Mira, twelve'),'match_entity_id',tests.v('mira')),
    json_build_object('entity_kind','location','name','Rocky point','summary','Lighthouse site.','evidence',json_build_array('rocky point'),'match_entity_id',tests.v('mira')),
    json_build_object('entity_kind','character','name','Stranger','summary','?','evidence',json_build_array(),'match_entity_id',tests.v('c_char'))
  )::text), 'worker records proposals, usage and cost atomically');
select tests.throws(format($q$select public.complete_story_breakdown(%L, '[]', '{}', 0, 'x')$q$, tests.v('run1')), 'PT409', 'a finished run cannot be completed twice');

:as_owner
select tests.put('p_tom',    (select id from public.agent_proposals where name = 'Old Tom'));
select tests.put('p_harbor', (select id from public.agent_proposals where name = 'Harbor town'));
select tests.put('p_mira',   (select id from public.agent_proposals where name = 'Mira'));
select tests.put('p_rocky',  (select id from public.agent_proposals where name = 'Rocky point'));
select tests.put('p_stranger', (select id from public.agent_proposals where name = 'Stranger'));
select tests.ok((select match_entity_id from public.agent_proposals where id = tests.v('p_mira')) = tests.v('mira'), 'same-kind match is kept');
select tests.ok((select match_entity_id from public.agent_proposals where id = tests.v('p_rocky')) is null, 'wrong-kind match is dropped');
select tests.ok((select match_entity_id from public.agent_proposals where id = tests.v('p_stranger')) is null, 'cross-project match is dropped');
select tests.throws($$update public.agent_proposals set match_entity_id = tests.v('c_char') where id = tests.v('p_tom')$$, '42501',
  'proposal content is immutable even for trusted code');
select tests.ok((select actor_type = 'agent' and actor_user_id is null from public.audit_events
                  where target_id = tests.v('run1') and event_type = 'agent_run.completed'), 'agent completion audited as agent, not as a person');

-- ---------------------------------------------------------------------------
-- Visibility
-- ---------------------------------------------------------------------------
:as_viewer
select tests.ok(tests.n($$select 1 from public.agent_proposals$$) = 0, 'viewer does not see suggestions');
:as_reviewer
select tests.ok(tests.n($$select 1 from public.agent_proposals where project_id = tests.v('A')$$) = 5, 'reviewer sees suggestions');
select tests.throws($$select public.accept_proposal(tests.v('p_tom'))$$, '42501', 'reviewer cannot accept suggestions');
select tests.throws($$select public.dismiss_proposal(tests.v('p_tom'))$$, '42501', 'reviewer cannot dismiss suggestions');
:as_outsider
select tests.ok(tests.n($$select 1 from public.agent_proposals where project_id = tests.v('A')$$) = 0, 'outsider does not see suggestions');
select tests.throws($$select public.accept_proposal(tests.v('p_tom'))$$, 'PT404', 'outsider cannot accept suggestions');

-- ---------------------------------------------------------------------------
-- Human decisions
-- ---------------------------------------------------------------------------
:as_editor
select tests.put('tom', public.accept_proposal(tests.v('p_tom'), 'Tom the Ferryman', null));
select tests.ok((select name from public.entities where id = tests.v('tom')) = 'Tom the Ferryman', 'accept can edit the name');
select tests.ok((select current_version_id is null from public.entities where id = tests.v('tom')), 'accepted item is NOT approved');
select tests.ok((select string_agg(status::text, ',') from public.versions where entity_id = tests.v('tom')) = 'submitted',
  'accepted item has one proposed revision');
select tests.ok((select created_by from public.versions where entity_id = tests.v('tom')) = tests.v('editor'),
  'accepted revision is authored by the person who accepted it');
select tests.ok(exists (select 1 from public.entity_relationships where source_entity_id = tests.v('tom')
                        and target_entity_id = tests.v('story') and relationship_type = 'appears_in'), 'accepted character is linked to the story');
select tests.throws($$select public.accept_proposal(tests.v('p_tom'))$$, 'PT409', 'a suggestion cannot be accepted twice');
select tests.lives($$select public.merge_proposal(tests.v('p_mira'))$$, 'duplicate suggestion merges into the existing character');
select tests.throws($$select public.merge_proposal(tests.v('p_rocky'), tests.v('mira'))$$, '22023', 'cannot merge a location into a character');
select tests.lives($$select public.dismiss_proposal(tests.v('p_harbor'))$$, 'suggestion can be dismissed');
select tests.put('rocky', public.accept_proposal(tests.v('p_rocky')));
select tests.ok(exists (select 1 from public.entity_relationships where source_entity_id = tests.v('story')
                        and target_entity_id = tests.v('rocky') and relationship_type = 'set_in'), 'accepted location is linked as a setting');
select tests.throws($$select public.approve_revision((select id from public.versions where entity_id = tests.v('tom')), null)$$, '42501',
  'accepting a suggestion grants no approval rights');

-- ---------------------------------------------------------------------------
-- Budget and spending authority
-- ---------------------------------------------------------------------------
select tests.ok((public.my_ai_budget(tests.v('A')) ->> 'can_manage')::boolean = false
                and public.my_ai_budget(tests.v('A')) ? 'spent_usd' = false, 'editor sees availability only, not spend');
select tests.ok(tests.n($$select 1 from public.resource_transactions$$) = 0, 'editor cannot read charges');
select tests.throws($$select public.set_ai_budget(tests.v('A'), 50)$$, '42501', 'editor cannot change the budget');
:as_dir
select tests.throws($$select public.set_ai_budget(tests.v('A'), 50)$$, '42501', 'director cannot change the budget (spend authority is separate)');
select tests.ok(tests.n($$select 1 from public.resource_transactions$$) = 0, 'director cannot read charges');
:as_ep
select tests.ok((public.my_ai_budget(tests.v('A')) ->> 'spent_usd')::numeric = 0.05, 'EP sees month-to-date spend');
select tests.ok((public.my_ai_budget(tests.v('A')) ->> 'budget_usd')::numeric = 10, 'default budget is $10');
select tests.ok(tests.n($$select 1 from public.resource_transactions where project_id = tests.v('A')$$) = 1, 'EP can read charges');
select tests.throws($$select public.set_ai_budget(tests.v('A'), 500)$$, '22023', 'budget is capped at $100');
select tests.lives($$select public.set_ai_budget(tests.v('A'), 0.2)$$, 'EP can lower the budget');
:as_editor
select tests.throws($$select public.request_story_breakdown(tests.v('story'))$$, 'PT402', 'no new runs when the budget is used up');
:as_ep
select public.set_ai_budget(tests.v('A'), 10);

-- Failed runs still record what they cost; implausible costs are refused.
:as_editor
select tests.put('run2', public.request_story_breakdown(tests.v('story')));
:as_service
select public.start_agent_run(tests.v('run2'));
select tests.throws(format($q$select public.complete_story_breakdown(%L, '[]', '{}', 10, 'x')$q$, tests.v('run2')), '22023', 'implausible cost refused');
select tests.throws(format($q$select public.complete_story_breakdown(%L, '[{"entity_kind":"prop","name":"Lamp"}]', '{}', 0, 'x')$q$, tests.v('run2')),
  '23514', 'unsupported kinds are refused by the constraint');
select public.fail_agent_run(tests.v('run2'), 'model timeout', '{"input_tokens":1000,"output_tokens":0}', 0.01);
select tests.ok((select status::text from public.agent_runs where id = tests.v('run2')) = 'failed', 'failed run is marked failed');
select tests.throws($$update public.resource_transactions set amount = 0$$, '42501', 'charges are append-only');
:as_ep
select tests.ok((public.my_ai_budget(tests.v('A')) ->> 'spent_usd')::numeric = 0.06, 'failed run cost is still counted');

-- ---------------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------------
:as_owner
select n, case when passed then 'PASS' else 'FAIL' end as result, label, detail from tests.results order by n;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from tests.results;
do $$ begin
  if exists (select 1 from tests.results where not passed) then
    raise exception 'Milestone 2 agent test suite FAILED';
  end if;
end $$;
