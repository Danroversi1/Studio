-- STUDIO — "How {name} is doing" as one 0–10 mood (0 sad and stressed … 10 happy and calm),
-- worked out each day from the harmony between what reached the character (their daily
-- coverage) and their own rules. Judging "in tune / at odds" runs on her own computer (the
-- paired local companion with a local model); the score itself is computed by Studio's code
-- from those judgments, so it's reproducible. Days wait while the computer is off; nothing
-- is judged in the cloud. She can override any day and set where a character starts.
begin;

alter table public.sim_char_states add column if not exists mood_start numeric(4,2) not null default 5 check (mood_start between 0 and 10);
alter table public.bubble_settings add column if not exists judge_device uuid references public.renderer_devices(id) on delete set null;

create table if not exists public.mood_days (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  character_id uuid not null references public.entities(id) on delete cascade,
  day date not null,                                   -- the film's local date (same as the coverage snapshot)
  status text not null default 'waiting' check (status in ('waiting', 'judged', 'scored', 'failed')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and length(payload::text) <= 60000),
  needs_judging boolean not null default true,
  judgments jsonb not null default '[]'::jsonb check (jsonb_typeof(judgments) = 'array' and length(judgments::text) <= 60000),
  model text check (model is null or length(model) <= 120),
  device_id uuid references public.renderer_devices(id) on delete set null,
  claimed_at timestamptz,
  attempts integer not null default 0,
  error text check (error is null or length(error) <= 500),
  prev_score numeric(5,2),
  harmony numeric(5,3),
  target numeric(5,2),
  score numeric(5,2) check (score is null or score between 0 and 10),
  override numeric(4,2) check (override is null or override between 0 and 10),
  override_note text check (override_note is null or length(override_note) <= 300),
  override_by uuid references auth.users(id),
  scored_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (character_id, day)
);
create index if not exists mood_days_char_idx on public.mood_days (character_id, day desc);
create index if not exists mood_days_waiting_idx on public.mood_days (project_id, day) where status = 'waiting';

alter table public.mood_days enable row level security;
drop policy if exists mood_days_read on public.mood_days;
create policy mood_days_read on public.mood_days for select to authenticated using (public.studio_level(project_id) >= 2);
revoke all on public.mood_days from anon;
revoke insert, update, delete, truncate, references, trigger on public.mood_days from authenticated;
grant select on public.mood_days to authenticated;
grant all on public.mood_days to service_role;

-- Queue (or refresh) a character's day. Idempotent; a day already judged or scored keeps its
-- judgments (a later refresh the same day doesn't re-judge).
create or replace function public.mood_queue(p_project uuid, p_character uuid, p_day date, p_payload jsonb, p_needs_judging boolean)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.mood_days (project_id, character_id, day, payload, needs_judging)
  values (p_project, p_character, p_day, coalesce(p_payload, '{}'::jsonb), p_needs_judging)
  on conflict (character_id, day) do update
     set payload = excluded.payload, needs_judging = excluded.needs_judging, updated_at = now()
   where public.mood_days.status = 'waiting' and public.mood_days.claimed_at is null
  returning id into v_id;
  if v_id is null then select id into v_id from public.mood_days where character_id = p_character and day = p_day; end if;
  return v_id;
end $$;

-- The companion asks for the next day to judge: only films that chose THIS computer, oldest
-- day first, one at a time per character (a day waits until earlier days are settled).
create or replace function public.mood_claim(p_device uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  update public.mood_days set status = 'failed', error = 'Couldn''t be judged after 3 tries.', claimed_at = null, updated_at = now()
   where status = 'waiting' and attempts >= 3;
  select m.id into v_id from public.mood_days m
    join public.bubble_settings s on s.project_id = m.project_id
    join public.projects p on p.id = m.project_id
   where s.judge_device = p_device and p.status <> 'deleted'
     and m.status = 'waiting' and m.needs_judging
     and (m.claimed_at is null or m.claimed_at < now() - interval '15 minutes')
     and not exists (select 1 from public.mood_days e where e.character_id = m.character_id and e.day < m.day and e.status in ('waiting', 'judged'))
   order by m.day, m.created_at
   limit 1 for update of m skip locked;
  if v_id is null then return null; end if;
  update public.mood_days set claimed_at = now(), device_id = p_device, attempts = attempts + 1, updated_at = now() where id = v_id;
  return v_id;
end $$;

create or replace function public.mood_complete(p_id uuid, p_device uuid, p_judgments jsonb, p_model text)
returns void
language plpgsql security definer set search_path = '' as $$
declare m public.mood_days;
begin
  select * into m from public.mood_days where id = p_id for update;
  if m.id is null or m.device_id is distinct from p_device or m.status <> 'waiting' then raise exception 'Not this computer''s job.' using errcode = 'PT404'; end if;
  if jsonb_typeof(p_judgments) <> 'array' then raise exception 'Bad judgments.' using errcode = '22023'; end if;
  update public.mood_days set status = 'judged', judgments = p_judgments, model = left(p_model, 120), claimed_at = null, error = null, updated_at = now() where id = p_id;
end $$;

create or replace function public.mood_fail(p_id uuid, p_device uuid, p_error text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.mood_days set claimed_at = null, error = left(p_error, 500), updated_at = now()
   where id = p_id and device_id = p_device and status = 'waiting';
end $$;

-- Studio's code writes the computed score (service role only).
create or replace function public.mood_put_score(p_id uuid, p_prev numeric, p_harmony numeric, p_target numeric, p_score numeric)
returns void
language sql security definer set search_path = '' as $$
  update public.mood_days set status = case when status = 'failed' then 'failed' else 'scored' end,
         prev_score = p_prev, harmony = p_harmony, target = p_target, score = greatest(0, least(10, p_score)),
         scored_at = coalesce(scored_at, now()), updated_at = now()
   where id = p_id
$$;

-- Her controls.
create or replace function public.mood_override(p_project uuid, p_character uuid, p_day date, p_score numeric, p_note text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'develop a character');
  perform public.character_check(p_project, p_character);
  if p_score is not null and (p_score < 0 or p_score > 10) then raise exception 'Choose 0 to 10.' using errcode = '22023'; end if;
  update public.mood_days set override = round(p_score * 2) / 2, override_note = nullif(left(btrim(coalesce(p_note, '')), 300), ''),
         override_by = case when p_score is null then null else v_uid end, updated_at = now()
   where character_id = p_character and project_id = p_project and day = p_day;
  if not found then raise exception 'That day isn''t scored yet.' using errcode = 'PT404'; end if;
end $$;

create or replace function public.mood_set_start(p_project uuid, p_character uuid, p_value numeric)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'develop a character');
  perform public.character_check(p_project, p_character);
  if p_value is null or p_value < 0 or p_value > 10 then raise exception 'Choose 0 to 10.' using errcode = '22023'; end if;
  insert into public.sim_char_states (character_id, project_id, mood_start, updated_by) values (p_character, p_project, round(p_value * 2) / 2, v_uid)
  on conflict (character_id) do update set mood_start = round(p_value * 2) / 2, updated_by = v_uid, updated_at = now();
end $$;

-- Which of her paired computers judges this film (it must be hers and still connected).
create or replace function public.mood_set_judge(p_project uuid, p_device uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'change the daily refresh');
  if p_device is not null and not exists (select 1 from public.renderer_devices where id = p_device and user_id = v_uid and revoked_at is null) then
    raise exception 'Choose one of your connected computers.' using errcode = '22023';
  end if;
  insert into public.bubble_settings (project_id, judge_device, updated_by) values (p_project, p_device, v_uid)
  on conflict (project_id) do update set judge_device = p_device, version = public.bubble_settings.version + 1, updated_by = v_uid, updated_at = now();
end $$;

do $$ declare f text;
begin
  foreach f in array array['mood_override(uuid, uuid, date, numeric, text)', 'mood_set_start(uuid, uuid, numeric)', 'mood_set_judge(uuid, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  foreach f in array array['mood_queue(uuid, uuid, date, jsonb, boolean)', 'mood_claim(uuid)', 'mood_complete(uuid, uuid, jsonb, text)',
    'mood_fail(uuid, uuid, text)', 'mood_put_score(uuid, numeric, numeric, numeric, numeric)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

commit;
