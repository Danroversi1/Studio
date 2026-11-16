-- STUDIO — characters the script calls out. A reader goes through the script for people
-- who appear or are heard (e.g. "the president", "a kid traveling along") but aren't in
-- the cast; the app adds them to Characters. One read per version of the script.
begin;

create or replace function public.request_cast_scan(p_project uuid, p_hash text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_run uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'read the script for characters');
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Unexpected script fingerprint.' using errcode = '22023';
  end if;
  -- Already read this exact script, or a read is under way: nothing to do.
  if exists (select 1 from public.agent_runs ar
              where ar.project_id = p_project and ar.task_type = 'cast_scan'
                and ((ar.status = 'succeeded' and ar.input_payload ->> 'hash' = p_hash)
                  or (ar.status in ('queued', 'running') and ar.created_at > now() - interval '5 minutes')
                  or (ar.status = 'failed' and ar.created_at > now() - interval '10 minutes'))) then
    return null;
  end if;
  if public.studio_ai_budget_usd(p_project) - public.studio_ai_spent_month_usd(p_project) < 0.10 then
    return null;  -- quietly skip; the speaker cues are still picked up without AI
  end if;
  insert into public.agent_runs (project_id, domain, status, task_type, input_payload, model_provider, prompt_version, requested_by)
  values (p_project, 'writer', 'queued', 'cast_scan', jsonb_build_object('hash', p_hash), 'anthropic', 'cast-scan-v1', v_uid)
  returning id into v_run;
  perform public.studio_audit(p_project, v_uid, 'user', 'agent_run.requested', 'agent_run', v_run, jsonb_build_object('task', 'cast_scan'));
  return v_run;
end $$;

-- SERVICE ROLE ONLY.
create or replace function public.complete_cast_scan(p_run uuid, p_people jsonb, p_usage jsonb, p_cost_usd numeric, p_model text)
returns void
language plpgsql security definer set search_path = '' as $$
declare r public.agent_runs;
begin
  select * into r from public.agent_runs where id = p_run for update;
  if r.id is null then raise exception 'Run not found.' using errcode = 'PT404'; end if;
  if r.task_type <> 'cast_scan' then raise exception 'Not a cast scan.' using errcode = '22023'; end if;
  if r.status <> 'running' then raise exception 'Run is %, not running.', r.status using errcode = 'PT409'; end if;
  if jsonb_typeof(p_people) <> 'array' or jsonb_array_length(p_people) > 40 or length(p_people::text) > 40000 then
    raise exception 'People must be an array of at most 40.' using errcode = '22023';
  end if;
  perform public.studio_record_ai_charge(r, p_usage, p_cost_usd);
  update public.agent_runs set status = 'succeeded', completed_at = now(), model_name = left(p_model, 100),
         token_usage = coalesce(p_usage, '{}'::jsonb), output_payload = jsonb_build_object('people', p_people)
   where id = p_run;
  perform public.studio_audit(r.project_id, null, 'agent', 'agent_run.completed', 'agent_run', p_run,
    jsonb_build_object('people', jsonb_array_length(p_people), 'cost_usd', p_cost_usd, 'requested_by', r.requested_by));
end $$;

revoke all on function public.request_cast_scan(uuid, text) from public, anon;
grant execute on function public.request_cast_scan(uuid, text) to authenticated;
revoke all on function public.complete_cast_scan(uuid, jsonb, jsonb, numeric, text) from public, anon, authenticated;
grant execute on function public.complete_cast_scan(uuid, jsonb, jsonb, numeric, text) to service_role;

commit;
