-- STUDIO — the Story Lead can read the director's treatment (Google Doc or Slides).
--
-- The browser reads the treatment's text with the Director's own Google permission and
-- hands it to this function. The text is stored with the run (input_payload), so the run
-- reads a fixed snapshot and every quote the Story Lead cites can be checked against it
-- later. Same rules as a synopsis breakdown: Edit access, one run at a time per story,
-- monthly budget, and results are only suggestions.
begin;

create or replace function public.request_treatment_breakdown(p_entity uuid, p_reference uuid, p_text text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; e public.entities; r public.research_references; v_run uuid;
        v_text text := btrim(coalesce(p_text, ''));
begin
  select * into e from public.entities where id = p_entity;
  v_uid := public.studio_require(e.project_id, 3, 'ask the Story Lead for suggestions');
  if e.kind <> 'story' then
    raise exception 'The Story Lead breaks down stories.' using errcode = '22023';
  end if;
  select ref.* into r from public.research_references ref
    join public.research_boards b on b.id = ref.board_id
   where ref.id = p_reference and b.entity_id = e.id and ref.project_id = e.project_id;
  if r.id is null or r.attribution is distinct from 'Director (own work)' then
    raise exception 'That treatment isn''t linked to this story.' using errcode = 'PT404';
  end if;
  if length(v_text) < 50 then
    raise exception 'The treatment has too little text to break down.' using errcode = '22023';
  end if;
  if length(v_text) > 150000 then
    raise exception 'The treatment is too long for one breakdown (over 150,000 characters).' using errcode = '22023';
  end if;

  select ar.id into v_run from public.agent_runs ar
   where ar.project_id = e.project_id and ar.task_type = 'story_breakdown'
     and ar.status in ('queued', 'running') and ar.created_at > now() - interval '10 minutes'
     and ar.input_payload ->> 'entity_id' = p_entity::text
   limit 1;
  if v_run is not null then
    return v_run;
  end if;

  if public.studio_ai_budget_usd(e.project_id) - public.studio_ai_spent_month_usd(e.project_id) < 0.25 then
    raise exception 'The team has used this month''s AI budget. Ask your Executive Producer.' using errcode = 'PT402';
  end if;

  insert into public.agent_runs (project_id, domain, status, task_type, input_payload, model_provider, prompt_version, requested_by)
  values (e.project_id, 'writer', 'queued', 'story_breakdown',
          jsonb_build_object('entity_id', e.id, 'source', 'treatment', 'reference_id', r.id,
                             'source_url', r.source_url, 'title', r.title, 'text', v_text,
                             'text_chars', length(v_text)),
          'anthropic', 'story-breakdown-v1-treatment', v_uid)
  returning id into v_run;
  perform public.studio_audit(e.project_id, v_uid, 'user', 'agent_run.requested', 'agent_run', v_run,
    jsonb_build_object('task', 'story_breakdown', 'source', 'treatment', 'reference_id', r.id,
                       'text_chars', length(v_text)));
  return v_run;
end $$;

revoke all on function public.request_treatment_breakdown(uuid, uuid, text) from public, anon;
grant execute on function public.request_treatment_breakdown(uuid, uuid, text) to authenticated;

commit;
