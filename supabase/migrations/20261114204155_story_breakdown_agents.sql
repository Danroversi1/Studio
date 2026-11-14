-- STUDIO — Milestone 2a: Story Lead breakdown, suggestion inbox, AI budget.
-- Agents never write creative content. They produce proposals, recorded by the trusted
-- service role; a human with Edit access accepts, merges or dismisses each one.
-- Accepted proposals create items whose only revision is `submitted` (never approved).

begin;

-- Advisor fix inherited from 0001.
alter function public.set_updated_at() set search_path = '';

-- -----------------------------------------------------------------------------
-- 1. Schema
-- -----------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'agent_runs_project_id_id_key') then
    alter table public.agent_runs add constraint agent_runs_project_id_id_key unique (project_id, id);
  end if;
end $$;

alter table public.resource_transactions add column if not exists agent_run_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'resource_transactions_agent_run_same_project') then
    alter table public.resource_transactions add constraint resource_transactions_agent_run_same_project
      foreign key (project_id, agent_run_id) references public.agent_runs(project_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'resource_transactions_amount_nonnegative') then
    alter table public.resource_transactions add constraint resource_transactions_amount_nonnegative
      check (amount is null or amount >= 0);
  end if;
end $$;

-- Spending records are append-only.
drop trigger if exists resource_transactions_append_only on public.resource_transactions;
create trigger resource_transactions_append_only before update or delete on public.resource_transactions
  for each row execute function public.studio_guard_append_only();

create table if not exists public.agent_proposals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  agent_run_id uuid not null,
  entity_kind public.entity_kind not null check (entity_kind in ('character', 'location')),
  name text not null check (length(name) between 1 and 120),
  summary text check (summary is null or length(summary) <= 2000),
  evidence text[] not null default '{}' check (cardinality(evidence) <= 5),
  match_entity_id uuid,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'merged', 'dismissed')),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  result_entity_id uuid,
  created_at timestamptz not null default now(),
  constraint agent_proposals_run_same_project foreign key (project_id, agent_run_id)
    references public.agent_runs(project_id, id) on delete cascade,
  constraint agent_proposals_match_same_project foreign key (project_id, match_entity_id)
    references public.entities(project_id, id),
  constraint agent_proposals_result_same_project foreign key (project_id, result_entity_id)
    references public.entities(project_id, id),
  constraint agent_proposals_decision_consistent check ((status = 'pending') = (decided_at is null))
);
create index if not exists agent_proposals_project_status_idx on public.agent_proposals (project_id, status, created_at desc);

create or replace function public.studio_guard_proposals()
returns trigger language plpgsql set search_path = '' as $$
begin
  if public.studio_is_client_role() then
    raise exception 'Suggestions cannot be changed directly.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.status <> 'pending' then
    raise exception 'This suggestion has already been decided.' using errcode = 'PT409';
  end if;
  if tg_op = 'UPDATE' and (new.id, new.project_id, new.agent_run_id, new.entity_kind, new.name, new.summary,
                           new.evidence, new.match_entity_id, new.created_at)
       is distinct from (old.id, old.project_id, old.agent_run_id, old.entity_kind, old.name, old.summary,
                         old.evidence, old.match_entity_id, old.created_at) then
    raise exception 'What the agent proposed is immutable; edits happen when accepting.' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists agent_proposals_guard on public.agent_proposals;
create trigger agent_proposals_guard before update or delete on public.agent_proposals
  for each row execute function public.studio_guard_proposals();

-- -----------------------------------------------------------------------------
-- 2. Budget
-- -----------------------------------------------------------------------------
create or replace function public.studio_can_spend(p_project uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select m.can_authorize_spend from public.studio_my_membership(p_project) m), false)
$$;

create or replace function public.studio_ai_budget_usd(p_project uuid)
returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((select (p.settings ->> 'ai_monthly_budget_usd')::numeric from public.projects p where p.id = p_project), 10)
$$;

create or replace function public.studio_ai_spent_month_usd(p_project uuid)
returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(t.amount), 0) from public.resource_transactions t
   where t.project_id = p_project and t.transaction_type = 'charge' and t.provider = 'anthropic'
     and t.created_at >= date_trunc('month', now())
$$;

-- Spend-authorized members see the numbers; everyone else only learns whether agents are available.
create or replace function public.my_ai_budget(p_project uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_budget numeric; v_spent numeric;
begin
  perform public.studio_require(p_project, 1, 'view this project');
  v_budget := public.studio_ai_budget_usd(p_project);
  v_spent := public.studio_ai_spent_month_usd(p_project);
  if public.studio_can_spend(p_project) then
    return jsonb_build_object('can_manage', true, 'budget_usd', v_budget, 'spent_usd', round(v_spent, 4),
                              'remaining_usd', greatest(v_budget - v_spent, 0), 'available', v_budget - v_spent >= 0.25);
  end if;
  return jsonb_build_object('can_manage', false, 'available', v_budget - v_spent >= 0.25);
end $$;

create or replace function public.set_ai_budget(p_project uuid, p_budget_usd numeric)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_old numeric;
begin
  v_uid := public.studio_require(p_project, 1, 'view this project');
  if not public.studio_can_spend(p_project) then
    raise exception 'Only the Executive Producer can change the AI budget.' using errcode = '42501';
  end if;
  if p_budget_usd is null or p_budget_usd < 0 or p_budget_usd > 100 then
    raise exception 'The monthly budget must be between $0 and $100.' using errcode = '22023';
  end if;
  v_old := public.studio_ai_budget_usd(p_project);
  update public.projects set settings = settings || jsonb_build_object('ai_monthly_budget_usd', p_budget_usd)
   where id = p_project;
  perform public.studio_audit(p_project, v_uid, 'user', 'budget.changed', 'project', p_project,
    jsonb_build_object('from_usd', v_old, 'to_usd', p_budget_usd));
end $$;

-- -----------------------------------------------------------------------------
-- 3. Runs
-- -----------------------------------------------------------------------------
create or replace function public.request_story_breakdown(p_entity uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; e public.entities; v public.versions; v_run uuid;
begin
  select * into e from public.entities where id = p_entity;
  v_uid := public.studio_require(e.project_id, 3, 'ask the Story Lead for suggestions');
  if e.kind <> 'story' then
    raise exception 'The Story Lead breaks down stories.' using errcode = '22023';
  end if;
  select * into v from public.versions where entity_id = p_entity order by version_number desc limit 1;
  if v.id is null or length(btrim(coalesce(v.content ->> 'body', ''))) < 50 then
    raise exception 'Write or paste at least a few sentences of your story and save it first.' using errcode = '22023';
  end if;

  -- One breakdown at a time per story.
  select r.id into v_run from public.agent_runs r
   where r.project_id = e.project_id and r.task_type = 'story_breakdown'
     and r.status in ('queued', 'running') and r.created_at > now() - interval '10 minutes'
     and r.input_payload ->> 'entity_id' = p_entity::text
   limit 1;
  if v_run is not null then
    return v_run;
  end if;

  if public.studio_ai_budget_usd(e.project_id) - public.studio_ai_spent_month_usd(e.project_id) < 0.25 then
    raise exception 'The team has used this month''s AI budget. Ask your Executive Producer.' using errcode = 'PT402';
  end if;

  insert into public.agent_runs (project_id, domain, status, task_type, input_payload, model_provider, prompt_version, requested_by)
  values (e.project_id, 'writer', 'queued', 'story_breakdown',
          jsonb_build_object('entity_id', e.id, 'version_id', v.id, 'version_number', v.version_number),
          'anthropic', 'story-breakdown-v1', v_uid)
  returning id into v_run;
  perform public.studio_audit(e.project_id, v_uid, 'user', 'agent_run.requested', 'agent_run', v_run,
    jsonb_build_object('task', 'story_breakdown', 'version_number', v.version_number));
  return v_run;
end $$;

-- SERVICE ROLE ONLY. Claims a queued run; returns false if another worker already did.
create or replace function public.start_agent_run(p_run uuid)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.agent_runs set status = 'running', started_at = now() where id = p_run and status = 'queued';
  return found;
end $$;

create or replace function public.studio_record_ai_charge(r public.agent_runs, p_usage jsonb, p_cost_usd numeric)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_cost_usd is null or p_cost_usd < 0 or p_cost_usd > 5 then
    raise exception 'Implausible cost %.', p_cost_usd using errcode = '22023';
  end if;
  if p_cost_usd > 0 then
    insert into public.resource_transactions (project_id, agent_run_id, transaction_type, resource_type, quantity, unit,
                                              amount, currency, provider, metadata)
    values (r.project_id, r.id, 'charge', 'llm_tokens',
            coalesce((p_usage ->> 'input_tokens')::numeric, 0) + coalesce((p_usage ->> 'output_tokens')::numeric, 0),
            'tokens', p_cost_usd, 'USD', 'anthropic', coalesce(p_usage, '{}'::jsonb));
  end if;
end $$;

-- SERVICE ROLE ONLY. Records validated proposals, usage and cost in one transaction.
create or replace function public.complete_story_breakdown(
  p_run uuid, p_proposals jsonb, p_usage jsonb, p_cost_usd numeric, p_model text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare r public.agent_runs; p jsonb; v_count integer := 0; v_match uuid; v_kind public.entity_kind;
begin
  select * into r from public.agent_runs where id = p_run for update;
  if r.id is null then
    raise exception 'Run not found.' using errcode = 'PT404';
  end if;
  if r.status <> 'running' then
    raise exception 'Run is %, not running.', r.status using errcode = 'PT409';
  end if;
  if jsonb_typeof(p_proposals) <> 'array' or jsonb_array_length(p_proposals) > 60 then
    raise exception 'Proposals must be an array of at most 60 items.' using errcode = '22023';
  end if;

  for p in select * from jsonb_array_elements(p_proposals) loop
    v_kind := (p ->> 'entity_kind')::public.entity_kind;
    v_match := nullif(p ->> 'match_entity_id', '')::uuid;
    if v_match is not null and not exists (
         select 1 from public.entities x where x.id = v_match and x.project_id = r.project_id and x.kind = v_kind) then
      v_match := null;  -- a wrong-kind or foreign match is dropped, not trusted
    end if;
    insert into public.agent_proposals (project_id, agent_run_id, entity_kind, name, summary, evidence, match_entity_id)
    values (r.project_id, r.id, v_kind, btrim(p ->> 'name'), nullif(left(btrim(coalesce(p ->> 'summary', '')), 2000), ''),
            coalesce(array(select left(q, 500) from jsonb_array_elements_text(coalesce(p -> 'evidence', '[]')) q limit 5), '{}'),
            v_match);
    v_count := v_count + 1;
  end loop;

  perform public.studio_record_ai_charge(r, p_usage, p_cost_usd);
  update public.agent_runs set status = 'succeeded', completed_at = now(), model_name = left(p_model, 100),
         token_usage = coalesce(p_usage, '{}'::jsonb), output_payload = jsonb_build_object('proposal_count', v_count)
   where id = p_run;
  perform public.studio_audit(r.project_id, null, 'agent', 'agent_run.completed', 'agent_run', p_run,
    jsonb_build_object('proposal_count', v_count, 'cost_usd', p_cost_usd, 'requested_by', r.requested_by));
  return v_count;
end $$;

-- SERVICE ROLE ONLY. Tokens spent on a failed run are still recorded.
create or replace function public.fail_agent_run(p_run uuid, p_error text, p_usage jsonb default '{}', p_cost_usd numeric default 0)
returns void
language plpgsql security definer set search_path = '' as $$
declare r public.agent_runs;
begin
  select * into r from public.agent_runs where id = p_run for update;
  if r.id is null or r.status not in ('queued', 'running') then
    return;
  end if;
  perform public.studio_record_ai_charge(r, p_usage, coalesce(p_cost_usd, 0));
  update public.agent_runs set status = 'failed', completed_at = now(), error_message = left(coalesce(p_error, 'unknown'), 500),
         token_usage = coalesce(p_usage, '{}'::jsonb)
   where id = p_run;
  perform public.studio_audit(r.project_id, null, 'agent', 'agent_run.failed', 'agent_run', p_run,
    jsonb_build_object('error', left(coalesce(p_error, 'unknown'), 200), 'requested_by', r.requested_by));
end $$;

-- -----------------------------------------------------------------------------
-- 4. Human decisions on proposals
-- -----------------------------------------------------------------------------
create or replace function public.studio_link_to_story(p_proposal public.agent_proposals, p_entity uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_story uuid;
begin
  select (r.input_payload ->> 'entity_id')::uuid into v_story from public.agent_runs r where r.id = p_proposal.agent_run_id;
  if v_story is null or not exists (select 1 from public.entities s where s.id = v_story and s.project_id = p_proposal.project_id) then
    return;
  end if;
  if p_proposal.entity_kind = 'character' then
    perform public.link_entities(p_entity, v_story, 'appears_in');
  else
    perform public.link_entities(v_story, p_entity, 'set_in');
  end if;
end $$;

create or replace function public.accept_proposal(p_proposal uuid, p_name text default null, p_summary text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; pr public.agent_proposals; v_entity uuid;
begin
  select * into pr from public.agent_proposals where id = p_proposal for update;
  v_uid := public.studio_require(pr.project_id, 3, 'accept suggestions');
  if pr.status <> 'pending' then
    raise exception 'This suggestion has already been decided.' using errcode = 'PT409';
  end if;
  -- Same trusted path as creating an item by hand: the first revision is a proposal, not approved.
  v_entity := public.create_entity(pr.project_id, pr.entity_kind, coalesce(nullif(btrim(p_name), ''), pr.name),
                                   jsonb_build_object('summary', coalesce(p_summary, pr.summary, '')),
                                   'Suggested by the Story Lead');
  perform public.studio_link_to_story(pr, v_entity);
  update public.agent_proposals set status = 'accepted', decided_by = v_uid, decided_at = now(), result_entity_id = v_entity
   where id = p_proposal;
  perform public.studio_audit(pr.project_id, v_uid, 'user', 'proposal.accepted', 'agent_proposal', p_proposal,
    jsonb_build_object('entity_id', v_entity, 'agent_run_id', pr.agent_run_id, 'edited', p_name is not null or p_summary is not null));
  return v_entity;
end $$;

create or replace function public.merge_proposal(p_proposal uuid, p_entity uuid default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; pr public.agent_proposals; v_target uuid;
begin
  select * into pr from public.agent_proposals where id = p_proposal for update;
  v_uid := public.studio_require(pr.project_id, 3, 'decide on suggestions');
  if pr.status <> 'pending' then
    raise exception 'This suggestion has already been decided.' using errcode = 'PT409';
  end if;
  v_target := coalesce(p_entity, pr.match_entity_id);
  if v_target is null or not exists (select 1 from public.entities x
                                      where x.id = v_target and x.project_id = pr.project_id and x.kind = pr.entity_kind) then
    raise exception 'Choose an existing % in this project to merge into.', pr.entity_kind using errcode = '22023';
  end if;
  perform public.studio_link_to_story(pr, v_target);
  update public.agent_proposals set status = 'merged', decided_by = v_uid, decided_at = now(), result_entity_id = v_target
   where id = p_proposal;
  perform public.studio_audit(pr.project_id, v_uid, 'user', 'proposal.merged', 'agent_proposal', p_proposal,
    jsonb_build_object('entity_id', v_target));
  return v_target;
end $$;

create or replace function public.dismiss_proposal(p_proposal uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; pr public.agent_proposals;
begin
  select * into pr from public.agent_proposals where id = p_proposal for update;
  v_uid := public.studio_require(pr.project_id, 3, 'decide on suggestions');
  if pr.status <> 'pending' then
    raise exception 'This suggestion has already been decided.' using errcode = 'PT409';
  end if;
  update public.agent_proposals set status = 'dismissed', decided_by = v_uid, decided_at = now() where id = p_proposal;
  perform public.studio_audit(pr.project_id, v_uid, 'user', 'proposal.dismissed', 'agent_proposal', p_proposal, '{}');
end $$;

-- -----------------------------------------------------------------------------
-- 5. Access
-- -----------------------------------------------------------------------------
alter table public.agent_proposals enable row level security;
drop policy if exists agent_proposals_read on public.agent_proposals;
create policy agent_proposals_read on public.agent_proposals for select to authenticated
  using (public.studio_level(project_id) >= 2);
drop policy if exists agent_runs_read on public.agent_runs;
create policy agent_runs_read on public.agent_runs for select to authenticated
  using (public.studio_level(project_id) >= 2);
drop policy if exists resource_transactions_read on public.resource_transactions;
create policy resource_transactions_read on public.resource_transactions for select to authenticated
  using (public.studio_can_spend(project_id));

revoke all on public.agent_proposals from anon;
revoke insert, update, delete, truncate, references, trigger on public.agent_proposals from authenticated;
grant select on public.agent_proposals to authenticated;
grant all on public.agent_proposals to service_role;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.studio_is_client_role(),
  public.studio_level_rank(public.access_level),
  public.studio_my_membership(uuid),
  public.studio_level(uuid),
  public.studio_is_admin(uuid),
  public.studio_is_canonical(uuid),
  public.studio_can_spend(uuid),
  public.my_project_capabilities(uuid),
  public.create_project(text, text),
  public.create_entity(uuid, public.entity_kind, text, jsonb, text),
  public.rename_entity(uuid, text),
  public.create_revision(uuid, jsonb, text, uuid, uuid, uuid[], public.version_status),
  public.approve_revision(uuid, uuid),
  public.link_entities(uuid, uuid, text),
  public.unlink_entities(uuid),
  public.add_reference(uuid, text, text, text, text, text),
  public.add_review_comment(uuid, text),
  public.begin_asset_upload(uuid, text, text, bigint),
  public.my_ai_budget(uuid),
  public.set_ai_budget(uuid, numeric),
  public.request_story_breakdown(uuid),
  public.accept_proposal(uuid, text, text),
  public.merge_proposal(uuid, uuid),
  public.dismiss_proposal(uuid)
to authenticated;

grant execute on function
  public.complete_asset_upload(uuid, bigint, text, text),
  public.fail_asset_upload(uuid, text),
  public.start_agent_run(uuid),
  public.complete_story_breakdown(uuid, jsonb, jsonb, numeric, text),
  public.fail_agent_run(uuid, text, jsonb, numeric)
to service_role;

commit;
