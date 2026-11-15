-- STUDIO — the script writing desk. Each film gets one screenplay item (entity kind
-- 'screenplay'), with the same revision history and Director approval as the story.
-- Content is one text field, "body", written in Fountain-style plain text.
begin;

create or replace function public.studio_validate_content(p_kind public.entity_kind, p_content jsonb)
returns void language plpgsql immutable set search_path = '' as $$
declare k text; allowed text[]; limit_chars integer;
begin
  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    raise exception 'Revision content must be an object.' using errcode = '22023';
  end if;
  if p_kind in ('story', 'treatment') then
    allowed := array['body']; limit_chars := 200000;
  elsif p_kind = 'screenplay' then
    allowed := array['body']; limit_chars := 400000;
  elsif p_kind in ('character', 'location') then
    allowed := array['summary', 'notes']; limit_chars := 50000;
  else
    raise exception 'Revisions for % are not available yet.', p_kind using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_content) loop
    if not k = any(allowed) then
      raise exception 'Unknown field "%" for a %.', k, p_kind using errcode = '22023';
    end if;
    if jsonb_typeof(p_content -> k) <> 'string' then
      raise exception 'Field "%" must be text.', k using errcode = '22023';
    end if;
    if length(p_content ->> k) > limit_chars then
      raise exception 'Field "%" is longer than % characters.', k, limit_chars using errcode = '22023';
    end if;
  end loop;
end $$;

-- Returns the film's screenplay item, creating it (empty) the first time.
create or replace function public.open_screenplay(p_project uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_id uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'write the script');
  perform pg_advisory_xact_lock(hashtext('screenplay:' || p_project::text));
  select id into v_id from public.entities where project_id = p_project and kind = 'screenplay' order by created_at limit 1;
  if v_id is not null then
    return v_id;
  end if;
  insert into public.entities (project_id, kind, name, module_key, created_by)
  values (p_project, 'screenplay', 'Screenplay', 'write', v_uid)
  returning id into v_id;
  perform public.studio_audit(p_project, v_uid, 'user', 'entity.created', 'entity', v_id,
    jsonb_build_object('kind', 'screenplay', 'name', 'Screenplay'));
  return v_id;
end $$;

revoke all on function public.open_screenplay(uuid) from public, anon;
grant execute on function public.open_screenplay(uuid) to authenticated;

commit;
