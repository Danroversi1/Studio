-- STUDIO — story development desk: film runtime + the story notebook.
--
-- Runtime: one of '1', '3-5', '10-15', 'longer' in projects.settings.runtime (unset = not
-- decided yet). It is a creative constraint the Story partner and the Script desk use.
--
-- Story notebook: the developing story kept beside the conversation, separate from her
-- draft. Items: decision, idea, question, for_later, beginning, middle, ending, next_action.
-- Status: confirmed (hers), proposed (a suggestion she hasn't accepted), open (a question),
-- done, archived (removed from view, kept for history). Her own items are confirmed; the
-- Story partner may record a decision as confirmed only when the words it cites appear in
-- her message for that turn (checked here), otherwise it stays proposed.
begin;

create table if not exists public.story_notebook (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('decision', 'idea', 'question', 'for_later', 'beginning', 'middle', 'ending', 'next_action')),
  body text not null check (length(body) between 1 and 2000),
  status text not null check (status in ('confirmed', 'proposed', 'open', 'done', 'archived')),
  source text not null check (source in ('creator', 'agent')),
  her_words text check (her_words is null or length(her_words) <= 500),
  agent_run_id uuid,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  constraint story_notebook_run_same_project foreign key (project_id, agent_run_id)
    references public.agent_runs(project_id, id) on delete set null (agent_run_id)
);
create index if not exists story_notebook_project_idx on public.story_notebook (project_id, kind, created_at);

alter table public.story_notebook enable row level security;
drop policy if exists story_notebook_read on public.story_notebook;
create policy story_notebook_read on public.story_notebook for select to authenticated
  using (public.studio_level(project_id) >= 2);
revoke all on public.story_notebook from anon;
revoke insert, update, delete, truncate, references, trigger on public.story_notebook from authenticated;
grant select on public.story_notebook to authenticated;
grant all on public.story_notebook to service_role;

create or replace function public.studio_runtime_ok(p text) returns boolean
language sql immutable set search_path = '' as $$ select p in ('1', '3-5', '10-15', 'longer') $$;

-- Runtime (Edit access). Null clears it ("not decided yet").
create or replace function public.set_film_runtime(p_project uuid, p_runtime text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_old text;
begin
  v_uid := public.studio_require(p_project, 3, 'set the film length');
  if p_runtime is not null and not public.studio_runtime_ok(p_runtime) then
    raise exception 'Unknown film length.' using errcode = '22023';
  end if;
  select settings ->> 'runtime' into v_old from public.projects where id = p_project;
  update public.projects
     set settings = case when p_runtime is null then settings - 'runtime' else settings || jsonb_build_object('runtime', p_runtime) end
   where id = p_project;
  perform public.studio_audit(p_project, v_uid, 'user', 'runtime.changed', 'project', p_project,
    jsonb_build_object('from', v_old, 'to', p_runtime));
end $$;

-- Her own notebook entries (Edit access).
create or replace function public.add_notebook_item(p_project uuid, p_kind text, p_body text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_id uuid; v_body text := btrim(coalesce(p_body, ''));
begin
  v_uid := public.studio_require(p_project, 3, 'edit the story notebook');
  if p_kind not in ('decision', 'idea', 'question', 'for_later', 'beginning', 'middle', 'ending', 'next_action') then
    raise exception 'Unknown notebook section.' using errcode = '22023';
  end if;
  if length(v_body) = 0 or length(v_body) > 2000 then
    raise exception 'Notes are 1–2,000 characters.' using errcode = '22023';
  end if;
  if p_kind = 'next_action' then
    update public.story_notebook set status = 'archived', updated_at = now(), updated_by = v_uid
     where project_id = p_project and kind = 'next_action' and status in ('open', 'proposed', 'confirmed');
  end if;
  insert into public.story_notebook (project_id, kind, body, status, source, created_by, updated_by)
  values (p_project, p_kind, v_body, case when p_kind in ('question', 'next_action') then 'open' else 'confirmed' end,
          'creator', v_uid, v_uid)
  returning id into v_id;
  perform public.studio_audit(p_project, v_uid, 'user', 'notebook.added', 'story_notebook', v_id, jsonb_build_object('kind', p_kind));
  return v_id;
end $$;

-- Keep / move / edit / remove an entry (Edit access). Nothing is deleted: removed = archived.
create or replace function public.update_notebook_item(p_item uuid, p_status text default null, p_kind text default null, p_body text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; n public.story_notebook; v_body text := nullif(btrim(coalesce(p_body, '')), '');
begin
  select * into n from public.story_notebook where id = p_item;
  v_uid := public.studio_require(n.project_id, 3, 'edit the story notebook');
  if p_status is not null and p_status not in ('confirmed', 'proposed', 'open', 'done', 'archived') then
    raise exception 'Unknown status.' using errcode = '22023';
  end if;
  if p_kind is not null and p_kind not in ('decision', 'idea', 'question', 'for_later', 'beginning', 'middle', 'ending', 'next_action') then
    raise exception 'Unknown notebook section.' using errcode = '22023';
  end if;
  if v_body is not null and length(v_body) > 2000 then
    raise exception 'Notes are 1–2,000 characters.' using errcode = '22023';
  end if;
  update public.story_notebook
     set status = coalesce(p_status, status), kind = coalesce(p_kind, kind), body = coalesce(v_body, body),
         updated_at = now(), updated_by = v_uid
   where id = p_item;
  perform public.studio_audit(n.project_id, v_uid, 'user', 'notebook.updated', 'story_notebook', p_item,
    jsonb_build_object('status', p_status, 'kind', p_kind, 'edited', v_body is not null));
end $$;

-- SERVICE ROLE ONLY. Apply the Story partner's notebook changes for a running turn.
-- p_ops: [{op:'add', kind, body, her_words?} | {op:'resolve', id}] (max 8).
-- p_runtime: runtime she stated this turn (+ p_runtime_words, her words), or null.
create or replace function public.apply_partner_notes(p_run uuid, p_ops jsonb, p_runtime text, p_runtime_words text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare r public.agent_runs; v_msg text; op jsonb; v_kind text; v_body text; v_words text; v_status text; n integer := 0;
begin
  select * into r from public.agent_runs where id = p_run;
  if r.id is null or r.task_type <> 'conversation_turn' or r.input_payload ->> 'agent' <> 'story' then
    raise exception 'Run not found.' using errcode = 'PT404';
  end if;
  if r.status <> 'running' then
    raise exception 'Run is not running.' using errcode = 'PT409';
  end if;
  select lower(content) into v_msg from public.agent_messages where id = (r.input_payload ->> 'message_id')::uuid;

  if p_runtime is not null then
    if not public.studio_runtime_ok(p_runtime) then
      raise exception 'Unknown film length.' using errcode = '22023';
    end if;
    -- Only when she said it herself this turn.
    if length(btrim(coalesce(p_runtime_words, ''))) >= 1 and position(lower(btrim(p_runtime_words)) in coalesce(v_msg, '')) > 0 then
      update public.projects set settings = settings || jsonb_build_object('runtime', p_runtime) where id = r.project_id;
      perform public.studio_audit(r.project_id, r.requested_by, 'agent', 'runtime.changed', 'project', r.project_id,
        jsonb_build_object('to', p_runtime, 'via_run', p_run, 'her_words', left(p_runtime_words, 200)));
    end if;
  end if;

  if jsonb_typeof(coalesce(p_ops, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_ops, '[]'::jsonb)) > 8 then
    raise exception 'Too many notebook changes.' using errcode = '22023';
  end if;
  for op in select * from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
    if op ->> 'op' = 'add' then
      v_kind := op ->> 'kind';
      v_body := btrim(coalesce(op ->> 'body', ''));
      v_words := nullif(btrim(coalesce(op ->> 'her_words', '')), '');
      continue when v_kind not in ('decision', 'idea', 'question', 'for_later', 'beginning', 'middle', 'ending', 'next_action')
                 or length(v_body) = 0 or length(v_body) > 2000;
      -- Her decision only if her cited words really are in her message; otherwise a proposal.
      if v_words is not null and (length(v_words) > 500 or position(lower(v_words) in coalesce(v_msg, '')) = 0) then
        v_words := null;
      end if;
      v_status := case
        when v_kind in ('question', 'next_action') then 'open'
        when v_kind = 'for_later' then case when v_words is not null then 'confirmed' else 'proposed' end
        when v_words is not null then 'confirmed'
        else 'proposed' end;
      if v_kind = 'decision' and v_status = 'proposed' then v_kind := 'idea'; end if;
      if v_kind = 'next_action' then
        update public.story_notebook set status = 'archived', updated_at = now()
         where project_id = r.project_id and kind = 'next_action' and status in ('open', 'proposed', 'confirmed');
      end if;
      insert into public.story_notebook (project_id, kind, body, status, source, her_words, agent_run_id, created_by)
      values (r.project_id, v_kind, v_body, v_status, 'agent', v_words, r.id, null);
      n := n + 1;
    elsif op ->> 'op' = 'resolve' then
      update public.story_notebook set status = 'done', updated_at = now()
       where id::text = op ->> 'id' and project_id = r.project_id and kind = 'question' and status = 'open';
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

revoke all on function public.set_film_runtime(uuid, text) from public, anon;
revoke all on function public.add_notebook_item(uuid, text, text) from public, anon;
revoke all on function public.update_notebook_item(uuid, text, text, text) from public, anon;
revoke all on function public.apply_partner_notes(uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.set_film_runtime(uuid, text), public.add_notebook_item(uuid, text, text),
  public.update_notebook_item(uuid, text, text, text) to authenticated;
grant execute on function public.apply_partner_notes(uuid, jsonb, text, text) to service_role;

commit;
