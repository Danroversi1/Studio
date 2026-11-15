-- STUDIO — conversations with the creative partners (Story partner, Design partner).
--
-- Each film can have conversation threads with an agent. The Director (Edit access) posts a
-- message; that creates an agent run ("conversation_turn") which the server answers with
-- the service role. Every reply is charged to the film's monthly AI budget, exactly like a
-- breakdown. A reply may include suggestions (new characters / locations); those land in
-- the same suggestion inbox and need her decision. Nothing here approves anything.
--
-- Messages are append-only. Review access and above can read the conversation (so a parent
-- EP can see what the agents say); only Edit access can talk to the agents.
begin;

create table if not exists public.agent_threads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  agent text not null check (agent in ('story', 'design')),
  title text check (title is null or length(title) <= 120),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  constraint agent_threads_project_id_id_key unique (project_id, id)
);
create index if not exists agent_threads_project_agent_idx on public.agent_threads (project_id, agent, last_message_at desc);

create table if not exists public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  thread_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (length(content) between 1 and 20000),
  agent_run_id uuid,
  author_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint agent_messages_thread_same_project foreign key (project_id, thread_id)
    references public.agent_threads(project_id, id) on delete cascade,
  constraint agent_messages_run_same_project foreign key (project_id, agent_run_id)
    references public.agent_runs(project_id, id) on delete cascade,
  constraint agent_messages_author_role check ((role = 'user') = (author_id is not null))
);
create index if not exists agent_messages_thread_idx on public.agent_messages (thread_id, created_at);

drop trigger if exists agent_messages_append_only on public.agent_messages;
create trigger agent_messages_append_only before update or delete on public.agent_messages
  for each row execute function public.studio_guard_append_only();

alter table public.agent_threads enable row level security;
alter table public.agent_messages enable row level security;
drop policy if exists agent_threads_read on public.agent_threads;
create policy agent_threads_read on public.agent_threads for select to authenticated
  using (public.studio_level(project_id) >= 2);
drop policy if exists agent_messages_read on public.agent_messages;
create policy agent_messages_read on public.agent_messages for select to authenticated
  using (public.studio_level(project_id) >= 2);
revoke all on public.agent_threads, public.agent_messages from anon;
revoke insert, update, delete, truncate, references, trigger on public.agent_threads, public.agent_messages from authenticated;
grant select on public.agent_threads, public.agent_messages to authenticated;
grant all on public.agent_threads, public.agent_messages to service_role;

-- Start a conversation with one of the partners.
create or replace function public.start_agent_thread(p_project uuid, p_agent text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_id uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'talk with the creative partners');
  if p_agent not in ('story', 'design') then
    raise exception 'Unknown partner.' using errcode = '22023';
  end if;
  insert into public.agent_threads (project_id, agent, created_by) values (p_project, p_agent, v_uid)
  returning id into v_id;
  perform public.studio_audit(p_project, v_uid, 'user', 'agent_thread.started', 'agent_thread', v_id,
    jsonb_build_object('agent', p_agent));
  return v_id;
end $$;

-- Post a message; returns the run that will produce the reply.
create or replace function public.post_agent_message(p_thread uuid, p_content text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; t public.agent_threads; v_text text := btrim(coalesce(p_content, ''));
        v_story uuid; v_msg uuid; v_run uuid;
begin
  select * into t from public.agent_threads where id = p_thread;
  v_uid := public.studio_require(t.project_id, 3, 'talk with the creative partners');
  if length(v_text) = 0 then
    raise exception 'Write a message first.' using errcode = '22023';
  end if;
  if length(v_text) > 6000 then
    raise exception 'That message is too long (6,000 characters at most).' using errcode = '22023';
  end if;
  -- One reply at a time per conversation.
  if exists (select 1 from public.agent_runs r
              where r.project_id = t.project_id and r.task_type = 'conversation_turn'
                and r.status in ('queued', 'running') and r.created_at > now() - interval '5 minutes'
                and r.input_payload ->> 'thread_id' = p_thread::text) then
    raise exception 'Your partner is still answering. Wait for the reply, then send your next message.' using errcode = 'PT409';
  end if;
  -- A runaway guard on top of the money budget.
  if (select count(*) from public.agent_runs r where r.project_id = t.project_id
        and r.task_type = 'conversation_turn' and r.created_at > now() - interval '1 day') >= 300 then
    raise exception 'That''s a lot of conversation for one day. Your partners will be back tomorrow.' using errcode = 'PT402';
  end if;
  if public.studio_ai_budget_usd(t.project_id) - public.studio_ai_spent_month_usd(t.project_id) < 0.25 then
    raise exception 'The team has used this month''s AI budget. Ask your Executive Producer.' using errcode = 'PT402';
  end if;

  select id into v_story from public.entities where project_id = t.project_id and kind = 'story' order by created_at limit 1;
  insert into public.agent_messages (project_id, thread_id, role, content, author_id)
  values (t.project_id, t.id, 'user', v_text, v_uid) returning id into v_msg;
  insert into public.agent_runs (project_id, domain, status, task_type, input_payload, model_provider, prompt_version, requested_by)
  values (t.project_id, case t.agent when 'story' then 'writer' else 'production_designer' end::public.agent_domain,
          'queued', 'conversation_turn',
          jsonb_build_object('thread_id', t.id, 'agent', t.agent, 'message_id', v_msg, 'entity_id', v_story),
          'anthropic', case t.agent when 'story' then 'story-partner-v2.0' else 'design-partner-v1.0' end, v_uid)
  returning id into v_run;
  update public.agent_threads
     set last_message_at = now(), title = coalesce(title, left(regexp_replace(v_text, '\s+', ' ', 'g'), 80))
   where id = t.id;
  return v_run;
end $$;

-- SERVICE ROLE ONLY. Record the partner's reply (and any suggestions) for a running turn.
create or replace function public.complete_agent_turn(
  p_run uuid, p_reply text, p_proposals jsonb, p_usage jsonb, p_cost_usd numeric, p_model text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.agent_runs; v_msg uuid; v_thread uuid;
begin
  select * into r from public.agent_runs where id = p_run;
  if r.id is null or r.task_type <> 'conversation_turn' then
    raise exception 'Run not found.' using errcode = 'PT404';
  end if;
  v_thread := (r.input_payload ->> 'thread_id')::uuid;
  if length(btrim(coalesce(p_reply, ''))) = 0 then
    raise exception 'Empty reply.' using errcode = '22023';
  end if;
  -- Records proposals, charges the budget, marks the run succeeded (and refuses non-running runs).
  perform public.complete_story_breakdown(p_run, coalesce(p_proposals, '[]'::jsonb), p_usage, p_cost_usd, p_model);
  insert into public.agent_messages (project_id, thread_id, role, content, agent_run_id)
  values (r.project_id, v_thread, 'assistant', left(btrim(p_reply), 20000), r.id) returning id into v_msg;
  update public.agent_threads set last_message_at = now() where id = v_thread;
  return v_msg;
end $$;

revoke all on function public.start_agent_thread(uuid, text) from public, anon;
revoke all on function public.post_agent_message(uuid, text) from public, anon;
revoke all on function public.complete_agent_turn(uuid, text, jsonb, jsonb, numeric, text) from public, anon, authenticated;
grant execute on function public.start_agent_thread(uuid, text), public.post_agent_message(uuid, text) to authenticated;
grant execute on function public.complete_agent_turn(uuid, text, jsonb, jsonb, numeric, text) to service_role;

commit;
