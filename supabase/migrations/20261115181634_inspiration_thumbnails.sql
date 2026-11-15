-- STUDIO — round 3 of developer comments:
--   * an "Inspiration" department for references (other films, creative works, music);
--   * a chosen thumbnail per item (character, location, story) shown on the overview.
begin;

alter table public.research_references drop constraint if exists research_references_department_check;
alter table public.research_references add constraint research_references_department_check
  check (department is null or department in ('casting', 'locations', 'wardrobe', 'production_design', 'special_effects', 'inspiration'));

create or replace function public.set_reference_department(p_reference uuid, p_department text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; r public.research_references;
begin
  select * into r from public.research_references where id = p_reference;
  v_uid := public.studio_require(r.project_id, 3, 'organize references');
  if p_department is not null and p_department not in ('casting', 'locations', 'wardrobe', 'production_design', 'special_effects', 'inspiration') then
    raise exception 'Unknown department.' using errcode = '22023';
  end if;
  update public.research_references set department = p_department where id = p_reference;
  perform public.studio_audit(r.project_id, v_uid, 'user', 'reference.filed', 'research_reference', p_reference,
    jsonb_build_object('department', p_department));
end $$;


create or replace function public.begin_asset_import(
  p_entity uuid, p_file_name text, p_mime_type text, p_byte_size bigint,
  p_source_url text, p_attribution text, p_provider_file_id text default null,
  p_from_treatment boolean default false, p_department text default null)
returns table (asset_id uuid, storage_bucket text, storage_key text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid; e public.entities; v_id uuid := gen_random_uuid(); v_ext text; v_key text; v_exp timestamptz;
  v_bucket text := coalesce(nullif(current_setting('studio.storage_bucket', true), ''), 'studio-media');
  v_max bigint := 50 * 1024 * 1024;
  v_name text := left(regexp_replace(coalesce(btrim(p_file_name), ''), '[^A-Za-z0-9._ -]', '_', 'g'), 200);
  v_url text := btrim(coalesce(p_source_url, ''));
  v_attr text := btrim(coalesce(p_attribution, ''));
begin
  select * into e from public.entities where id = p_entity;
  v_uid := public.studio_require(e.project_id, 3, 'add references');
  v_ext := case p_mime_type when 'image/png' then 'png' when 'image/jpeg' then 'jpg' end;
  if v_ext is null then
    raise exception 'Only PNG and JPEG images can be pulled in.' using errcode = '22023';
  end if;
  if p_byte_size is null or p_byte_size <= 0 or p_byte_size > v_max then
    raise exception 'Images must be between 1 byte and 50 MB.' using errcode = '22023';
  end if;
  if v_url !~ '^https://(docs|drive)\.google\.com/[^\s]*$' or length(v_url) > 2000 then
    raise exception 'The image must come from a Google Drive or Google Docs link.' using errcode = '22023';
  end if;
  if length(v_attr) = 0 then
    raise exception 'Say who made this image (attribution).' using errcode = '22023';
  end if;
  if length(v_attr) > 500 or length(coalesce(p_provider_file_id, '')) > 200 then
    raise exception 'Attribution or file id is too long.' using errcode = '22023';
  end if;
  if p_provider_file_id is not null and p_provider_file_id !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'Unexpected Google file id.' using errcode = '22023';
  end if;
  if p_department is not null and p_department not in ('casting', 'locations', 'wardrobe', 'production_design', 'special_effects', 'inspiration') then
    raise exception 'Unknown department.' using errcode = '22023';
  end if;

  v_key := format('projects/%s/entities/%s/assets/%s/original.%s', e.project_id, e.id, v_id, v_ext);
  v_exp := now() + interval '15 minutes';

  insert into public.assets (id, project_id, entity_id, kind, origin, display_name, mime_type, file_extension,
                             storage_bucket, storage_key, is_immutable_original, created_by,
                             upload_status, upload_expires_at, source_uri, provenance, metadata)
  values (v_id, e.project_id, e.id, 'image', 'import', coalesce(nullif(v_name, ''), 'image.' || v_ext),
          p_mime_type, v_ext, v_bucket, v_key, true, v_uid, 'pending', v_exp, v_url,
          jsonb_build_object('provider', 'google_drive', 'file_id', p_provider_file_id,
                             'from_treatment', coalesce(p_from_treatment, false), 'attribution', v_attr,
                             'department', p_department),
          jsonb_build_object('declared_byte_size', p_byte_size));
  perform public.studio_audit(e.project_id, v_uid, 'user', 'asset.import_started', 'asset', v_id,
    jsonb_build_object('entity_id', e.id, 'mime_type', p_mime_type, 'declared_byte_size', p_byte_size,
                       'source_url', v_url, 'from_treatment', coalesce(p_from_treatment, false), 'department', p_department));
  return query select v_id, v_bucket, v_key, v_exp;
end $$;


-- Pick the picture shown on an item's card (Edit access). Any ready image in the same film:
-- the item's own artwork or an imported reference image. Null clears it.
create or replace function public.set_entity_thumbnail(p_entity uuid, p_asset uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; e public.entities; a public.assets;
begin
  select * into e from public.entities where id = p_entity;
  v_uid := public.studio_require(e.project_id, 3, 'choose a thumbnail');
  if p_asset is not null then
    select * into a from public.assets where id = p_asset;
    if a.id is null or a.project_id <> e.project_id or a.upload_status <> 'ready' or a.kind <> 'image' then
      raise exception 'That picture can''t be used as a thumbnail.' using errcode = '22023';
    end if;
  end if;
  update public.entities
     set metadata = case when p_asset is null then metadata - 'thumbnail_asset_id'
                         else metadata || jsonb_build_object('thumbnail_asset_id', p_asset) end,
         updated_at = now()
   where id = p_entity;
  perform public.studio_audit(e.project_id, v_uid, 'user', 'entity.thumbnail_set', 'entity', p_entity,
    jsonb_build_object('asset_id', p_asset));
end $$;

revoke all on function public.set_reference_department(uuid, text) from public, anon;
grant execute on function public.set_reference_department(uuid, text) to authenticated;
revoke all on function public.begin_asset_import(uuid, text, text, bigint, text, text, text, boolean, text) from public, anon;
grant execute on function public.begin_asset_import(uuid, text, text, bigint, text, text, text, boolean, text) to authenticated;
revoke all on function public.set_entity_thumbnail(uuid, uuid) from public, anon;
grant execute on function public.set_entity_thumbnail(uuid, uuid) to authenticated;

commit;
