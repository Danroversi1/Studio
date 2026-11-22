-- STUDIO — World rules ("How the world works") can be written as plain bullet points: the
-- "then, in the world…" part is no longer required. Also: films can be renamed (owner only).
begin;

create or replace function public.sim_rule_save(p_project uuid, p_rule uuid, p_data jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_id uuid := p_rule; v_family text := p_data ->> 'family'; v_char uuid := nullif(p_data ->> 'character_id', '')::uuid;
        v_day integer; r public.sim_rules; v_s integer; v_h integer;
begin
  v_uid := public.studio_require(p_project, 3, 'change the simulation');
  v_day := (public.sim_settings_row(p_project)).clock_day + 1;
  if v_family is null or v_family not in ('world', 'character', 'story', 'periphery') then raise exception 'Choose a kind of rule.' using errcode = '22023'; end if;
  if v_family = 'character' then
    if v_char is null then raise exception 'Choose the character this rule is about.' using errcode = '22023'; end if;
    perform public.character_check(p_project, v_char);
  elsif v_family = 'periphery' then
    v_char := null;
  elsif v_char is not null then perform public.character_check(p_project, v_char);
  end if;
  if length(btrim(coalesce(p_data ->> 'when_text', ''))) < 2 then raise exception 'Say when the rule applies.' using errcode = '22023'; end if;
  v_s := case when v_family = 'periphery' then 0 else greatest(-2, least(2, coalesce((p_data ->> 'stress')::integer, 0))) end;
  v_h := case when v_family = 'periphery' then 0 else greatest(-2, least(2, coalesce((p_data ->> 'happiness')::integer, 0))) end;
  if v_id is null then
    insert into public.sim_rules (project_id, family, character_id, when_text, stress, happiness, tend_text, relief_text, enabled, effective_day, created_by)
    values (p_project, v_family, v_char, left(btrim(p_data ->> 'when_text'), 300), v_s, v_h,
            nullif(left(btrim(coalesce(p_data ->> 'tend_text', '')), 300), ''),
            case when v_family = 'periphery' then null else nullif(left(btrim(coalesce(p_data ->> 'relief_text', '')), 300), '') end,
            coalesce((p_data ->> 'enabled')::boolean, true), v_day, v_uid)
    returning * into r;
  else
    update public.sim_rules set family = v_family, character_id = v_char, when_text = left(btrim(p_data ->> 'when_text'), 300),
      stress = v_s, happiness = v_h,
      tend_text = nullif(left(btrim(coalesce(p_data ->> 'tend_text', '')), 300), ''),
      relief_text = case when v_family = 'periphery' then null else nullif(left(btrim(coalesce(p_data ->> 'relief_text', '')), 300), '') end,
      enabled = coalesce((p_data ->> 'enabled')::boolean, enabled), version = version + 1, effective_day = v_day, updated_at = now()
    where id = v_id and project_id = p_project and archived_at is null returning * into r;
    if r.id is null then raise exception 'Rule not found.' using errcode = 'PT404'; end if;
  end if;
  insert into public.sim_rule_versions (rule_id, version, project_id, data, effective_day, saved_by)
  values (r.id, r.version, p_project, to_jsonb(r) - 'project_id' - 'created_by' - 'created_at' - 'updated_at', v_day, v_uid);
  return r.id;
end $$;

create or replace function public.rename_project(p_project uuid, p_name text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_name text := btrim(coalesce(p_name, ''));
begin
  v_uid := public.studio_require(p_project, 4, 'rename the film');
  if length(v_name) = 0 or length(v_name) > 120 then raise exception 'Film name must be 1–120 characters.' using errcode = '22023'; end if;
  update public.projects set name = v_name, updated_at = now() where id = p_project;
end $$;
revoke all on function public.rename_project(uuid, text) from public, anon;
grant execute on function public.rename_project(uuid, text) to authenticated, service_role;

commit;
