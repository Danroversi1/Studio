-- STUDIO — Storyboard Desk rebuild: traced vector drawings and the film's treatment preset.
-- Tracing happens in her browser (OpenCV.js + ImageTracer.js, no AI). What is stored here is
-- the result as plain path data plus everything needed to make it again: the settings and the
-- references it was traced from (layer, picture, library item, character/place). A frame's
-- composition points at a trace by id, so re-tracing writes a new row and swaps the pointer
-- (undo swaps it back); hand drawing and other layers are never touched.

create table if not exists public.storyboard_traces (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  shot_id uuid references public.storyboard_shots(id) on delete cascade,
  treatment text not null check (treatment in ('outline', 'ink', 'three_tone')),
  settings jsonb not null check (jsonb_typeof(settings) = 'object' and length(settings::text) <= 4000),
  source jsonb not null check (jsonb_typeof(source) = 'array' and length(source::text) <= 20000),
  width int not null check (width between 1 and 4096),
  height int not null check (height between 1 and 4096),
  paths jsonb not null check (jsonb_typeof(paths) = 'array'),
  path_count int not null,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists storyboard_traces_shot on public.storyboard_traces (shot_id, created_at desc);

create table if not exists public.storyboard_treatment_presets (
  project_id uuid primary key references public.projects(id) on delete cascade,
  settings jsonb not null check (jsonb_typeof(settings) = 'object' and length(settings::text) <= 4000),
  version int not null default 1,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

do $$ declare t text;
begin
  foreach t in array array['storyboard_traces', 'storyboard_treatment_presets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.studio_level(project_id) >= 2)', t || '_read', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

/** Save a finished trace. Paths are [{d, f?} | {d, s, w}]: path data only (move/line/curve/
 *  close commands and numbers), colours as #rrggbb or "none", stroke width 0–50. Anything else
 *  is refused, so a saved drawing can never carry script or markup. */
create or replace function public.storyboard_trace_save(p_project uuid, p_shot uuid, p_treatment text, p_settings jsonb,
  p_source jsonb, p_width int, p_height int, p_paths jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_id uuid; v_n int; p jsonb;
begin
  v_uid := public.studio_require(p_project, 3, 'trace references');
  if p_shot is not null and not exists (select 1 from public.storyboard_shots where id = p_shot and project_id = p_project and archived_at is null) then
    raise exception 'Frame not found.' using errcode = 'PT404';
  end if;
  if p_treatment not in ('outline', 'ink', 'three_tone') then raise exception 'Unknown treatment.' using errcode = '22023'; end if;
  if p_paths is null or jsonb_typeof(p_paths) <> 'array' then raise exception 'Unexpected drawing.' using errcode = '22023'; end if;
  v_n := jsonb_array_length(p_paths);
  if v_n = 0 then raise exception 'That trace came out empty. Try more detail or contrast.' using errcode = '22023'; end if;
  if v_n > 6000 or length(p_paths::text) > 3000000 then
    raise exception 'That trace is too detailed to keep (% lines). Raise Simplify or lower Detail.', v_n using errcode = '22023';
  end if;
  for p in select x from jsonb_array_elements(p_paths) x loop
    if jsonb_typeof(p) <> 'object' or (select count(*) from jsonb_object_keys(p) k where k not in ('d', 'f', 's', 'w')) > 0
       or jsonb_typeof(p -> 'd') <> 'string' or (p ->> 'd') !~ '^[MLQCZmlqcz0-9 .,eE+-]+$'
       or (p ? 'f' and (p ->> 'f') !~ '^(#[0-9a-fA-F]{6}|none)$')
       or (p ? 's' and (p ->> 's') !~ '^(#[0-9a-fA-F]{6}|none)$')
       or (p ? 'w' and (jsonb_typeof(p -> 'w') <> 'number' or (p ->> 'w')::numeric < 0 or (p ->> 'w')::numeric > 50)) then
      raise exception 'That drawing has something in it that isn''t a plain line or shape.' using errcode = '22023';
    end if;
  end loop;
  insert into public.storyboard_traces (project_id, shot_id, treatment, settings, source, width, height, paths, path_count, created_by)
  values (p_project, p_shot, p_treatment, coalesce(p_settings, '{}'::jsonb), coalesce(p_source, '[]'::jsonb), p_width, p_height, p_paths, v_n, v_uid)
  returning id into v_id;
  return v_id;
end $$;

/** The film's treatment preset (palette, contrast, outline weight, detail, shadow, background):
 *  editable settings applied across boards. A stale version is refused. Returns the new version. */
create or replace function public.storyboard_treatment_save(p_project uuid, p_settings jsonb, p_expected_version int)
returns int
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; cur public.storyboard_treatment_presets;
begin
  v_uid := public.studio_require(p_project, 3, 'change the film''s treatment');
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' or length(p_settings::text) > 4000 then
    raise exception 'Unexpected treatment settings.' using errcode = '22023';
  end if;
  select * into cur from public.storyboard_treatment_presets where project_id = p_project for update;
  if cur.project_id is null then
    insert into public.storyboard_treatment_presets (project_id, settings, updated_by) values (p_project, p_settings, v_uid);
    return 1;
  end if;
  if p_expected_version is not null and p_expected_version <> cur.version then
    raise exception 'The film''s treatment was changed somewhere else. Reload to see the latest.' using errcode = 'PT409';
  end if;
  update public.storyboard_treatment_presets set settings = p_settings, version = cur.version + 1, updated_by = v_uid, updated_at = now()
   where project_id = p_project;
  return cur.version + 1;
end $$;

revoke all on function public.storyboard_trace_save(uuid, uuid, text, jsonb, jsonb, int, int, jsonb) from public, anon;
revoke all on function public.storyboard_treatment_save(uuid, jsonb, int) from public, anon;
grant execute on function public.storyboard_trace_save(uuid, uuid, text, jsonb, jsonb, int, int, jsonb) to authenticated;
grant execute on function public.storyboard_treatment_save(uuid, jsonb, int) to authenticated;
