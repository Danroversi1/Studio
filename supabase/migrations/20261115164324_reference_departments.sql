-- STUDIO — references by department (Casting, Locations, Wardrobe, Production design,
-- Special effects). A reference can belong to one department (or none = general).
begin;

alter table public.research_references add column if not exists department text
  check (department is null or department in ('casting', 'locations', 'wardrobe', 'production_design', 'special_effects'));
create index if not exists research_references_department_idx on public.research_references (project_id, department);

-- File a reference under a department (Edit access). Null = general.
create or replace function public.set_reference_department(p_reference uuid, p_department text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; r public.research_references;
begin
  select * into r from public.research_references where id = p_reference;
  v_uid := public.studio_require(r.project_id, 3, 'organize references');
  if p_department is not null and p_department not in ('casting', 'locations', 'wardrobe', 'production_design', 'special_effects') then
    raise exception 'Unknown department.' using errcode = '22023';
  end if;
  update public.research_references set department = p_department where id = p_reference;
  perform public.studio_audit(r.project_id, v_uid, 'user', 'reference.filed', 'research_reference', p_reference,
    jsonb_build_object('department', p_department));
end $$;

-- Imports can carry a department; the completed import files its reference there.
drop function if exists public.begin_asset_import(uuid, text, text, bigint, text, text, text, boolean);
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
  if p_department is not null and p_department not in ('casting', 'locations', 'wardrobe', 'production_design', 'special_effects') then
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

create or replace function public.complete_asset_upload(
  p_asset uuid, p_byte_size bigint, p_checksum_sha256 text, p_mime_type text)
returns void
language plpgsql security definer set search_path = '' as $$
declare a public.assets; v_board uuid; v_ref uuid;
begin
  select * into a from public.assets where id = p_asset for update;
  if a.id is null then
    raise exception 'Upload not found.' using errcode = 'PT404';
  end if;
  if a.upload_status <> 'pending' then
    raise exception 'Upload is already %.', a.upload_status using errcode = 'PT409';
  end if;
  if a.upload_expires_at < now() then
    update public.assets set upload_status = 'failed', metadata = metadata || '{"failure":"expired"}' where id = p_asset;
    perform public.studio_audit(a.project_id, a.created_by, 'system', 'asset.upload_expired', 'asset', p_asset, '{}');
    return;
  end if;
  if p_mime_type is distinct from a.mime_type
     or p_byte_size is distinct from (a.metadata ->> 'declared_byte_size')::bigint
     or p_checksum_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Uploaded object does not match the reserved upload.' using errcode = '22023';
  end if;
  update public.assets set upload_status = 'ready', byte_size = p_byte_size, checksum_sha256 = p_checksum_sha256,
         completed_at = now() where id = p_asset;
  perform public.studio_audit(a.project_id, a.created_by, 'system', 'asset.upload_completed', 'asset', p_asset,
    jsonb_build_object('byte_size', p_byte_size, 'checksum_sha256', p_checksum_sha256));

  if a.origin = 'import' then
    select id into v_board from public.research_boards where project_id = a.project_id and entity_id = a.entity_id
     order by created_at limit 1;
    if v_board is null then
      insert into public.research_boards (project_id, entity_id, title, created_by)
      values (a.project_id, a.entity_id, 'References', a.created_by) returning id into v_board;
    end if;
    insert into public.research_references (project_id, board_id, title, source_url, source_domain, media_type,
                                            preview_asset_id, attribution, rights_status, observations, added_by, department)
    values (a.project_id, v_board, a.display_name, a.source_uri,
            lower(substring(a.source_uri from '^https?://([^/:?#]+)')), 'image', a.id,
            a.provenance ->> 'attribution',
            case when a.provenance ->> 'attribution' = 'Director (own work)' then 'permission_granted' else 'unknown' end,
            case when (a.provenance ->> 'from_treatment')::boolean then 'Pulled from the director''s treatment.'
                 else 'Pulled from Google Drive.' end,
            a.created_by, nullif(a.provenance ->> 'department', ''))
    returning id into v_ref;
    perform public.studio_audit(a.project_id, a.created_by, 'user', 'reference.added', 'research_reference', v_ref,
      jsonb_build_object('entity_id', a.entity_id, 'url', a.source_uri, 'preview_asset_id', a.id));
  end if;
end $$;

revoke all on function public.set_reference_department(uuid, text) from public, anon;
grant execute on function public.set_reference_department(uuid, text) to authenticated;
revoke all on function public.begin_asset_import(uuid, text, text, bigint, text, text, text, boolean, text) from public, anon;
grant execute on function public.begin_asset_import(uuid, text, text, bigint, text, text, text, boolean, text) to authenticated;
revoke all on function public.complete_asset_upload(uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function public.complete_asset_upload(uuid, bigint, text, text) to service_role;

commit;
