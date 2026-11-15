-- STUDIO — scenes from the outline.
--
-- When the Director adds to her outline, the Script desk lays out a scene for each new
-- beat: a scene heading (interior/exterior, where, when), who is in it, and a first
-- breakdown for the art department. Her beat text stays her own words; the model only
-- classifies. Same rules as other agent work: Edit access, one run at a time per film,
-- monthly budget. The server writes the scenes into her script as a new revision under
-- her own account, so history and approvals work as usual.
begin;

create or replace function public.request_scene_plan(p_project uuid, p_beats jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_run uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'lay out scenes');
  if jsonb_typeof(p_beats) <> 'array' or jsonb_array_length(p_beats) = 0 or jsonb_array_length(p_beats) > 40 then
    raise exception 'Send between 1 and 40 outline beats.' using errcode = '22023';
  end if;
  if length(p_beats::text) > 60000 then
    raise exception 'The outline is too long for one pass.' using errcode = '22023';
  end if;

  select ar.id into v_run from public.agent_runs ar
   where ar.project_id = p_project and ar.task_type = 'scene_plan'
     and ar.status in ('queued', 'running') and ar.created_at > now() - interval '5 minutes'
   limit 1;
  if v_run is not null then
    return null;  -- one at a time; the caller simply skips
  end if;

  if public.studio_ai_budget_usd(p_project) - public.studio_ai_spent_month_usd(p_project) < 0.10 then
    raise exception 'The team has used this month''s AI budget. Ask your Executive Producer.' using errcode = 'PT402';
  end if;

  insert into public.agent_runs (project_id, domain, status, task_type, input_payload, model_provider, prompt_version, requested_by)
  values (p_project, 'writer', 'queued', 'scene_plan', jsonb_build_object('beats', p_beats),
          'anthropic', 'scene-plan-v1', v_uid)
  returning id into v_run;
  perform public.studio_audit(p_project, v_uid, 'user', 'agent_run.requested', 'agent_run', v_run,
    jsonb_build_object('task', 'scene_plan', 'beats', jsonb_array_length(p_beats)));
  return v_run;
end $$;

-- SERVICE ROLE ONLY.
create or replace function public.complete_scene_plan(p_run uuid, p_plan jsonb, p_usage jsonb, p_cost_usd numeric, p_model text)
returns void
language plpgsql security definer set search_path = '' as $$
declare r public.agent_runs;
begin
  select * into r from public.agent_runs where id = p_run for update;
  if r.id is null then raise exception 'Run not found.' using errcode = 'PT404'; end if;
  if r.task_type <> 'scene_plan' then raise exception 'Not a scene plan.' using errcode = '22023'; end if;
  if r.status <> 'running' then raise exception 'Run is %, not running.', r.status using errcode = 'PT409'; end if;
  if jsonb_typeof(p_plan) <> 'array' or jsonb_array_length(p_plan) > 80 or length(p_plan::text) > 100000 then
    raise exception 'Plan must be an array of at most 80 scenes.' using errcode = '22023';
  end if;
  perform public.studio_record_ai_charge(r, p_usage, p_cost_usd);
  update public.agent_runs set status = 'succeeded', completed_at = now(), model_name = left(p_model, 100),
         token_usage = coalesce(p_usage, '{}'::jsonb), output_payload = jsonb_build_object('scenes', p_plan)
   where id = p_run;
  perform public.studio_audit(r.project_id, null, 'agent', 'agent_run.completed', 'agent_run', p_run,
    jsonb_build_object('scene_count', jsonb_array_length(p_plan), 'cost_usd', p_cost_usd, 'requested_by', r.requested_by));
end $$;

revoke all on function public.request_scene_plan(uuid, jsonb) from public, anon;
grant execute on function public.request_scene_plan(uuid, jsonb) to authenticated;
revoke all on function public.complete_scene_plan(uuid, jsonb, jsonb, numeric, text) from public, anon, authenticated;
grant execute on function public.complete_scene_plan(uuid, jsonb, jsonb, numeric, text) to service_role;

commit;
