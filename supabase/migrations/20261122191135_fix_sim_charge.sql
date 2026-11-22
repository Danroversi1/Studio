-- STUDIO — Fix: sim_charge never recorded charges (the run status needed a cast to the enum),
-- so small model calls routed through it (reassessing an edited event, suggesting a character's
-- interests) weren't counted against the AI budget.
begin;

create or replace function public.sim_charge(p_project uuid, p_uid uuid, p_task text, p_usage jsonb, p_cost_usd numeric, p_model text, p_ok boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare ar public.agent_runs;
begin
  insert into public.agent_runs (project_id, domain, status, task_type, input_payload, model_provider, prompt_version, requested_by, started_at, completed_at, model_name, token_usage)
  values (p_project, 'writer', (case when p_ok then 'succeeded' else 'failed' end)::public.agent_run_status, left(p_task, 60), '{}'::jsonb, 'anthropic', 'world-sim-v1',
          coalesce(p_uid, (select created_by from public.projects where id = p_project)), now(), now(), left(p_model, 100), coalesce(p_usage, '{}'::jsonb))
  returning * into ar;
  perform public.studio_record_ai_charge(ar, p_usage, p_cost_usd);
end $$;

commit;
