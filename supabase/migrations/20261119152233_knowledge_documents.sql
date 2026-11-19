-- STUDIO — Knowledge Base documents: the existing private upload flow also accepts PDF,
-- Word (.docx), plain text and Markdown, but only for the Knowledge Base's own owner
-- entity. Everything else still accepts PNG/JPEG artwork only. The server still verifies
-- the stored bytes before an upload is marked ready.
begin;

create or replace function public.begin_asset_upload(
  p_entity uuid, p_file_name text, p_mime_type text, p_byte_size bigint)
returns table (asset_id uuid, storage_bucket text, storage_key text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid; e public.entities; v_kind public.asset_kind := 'image'; v_id uuid := gen_random_uuid(); v_ext text; v_key text; v_exp timestamptz;
  v_bucket text := coalesce(nullif(current_setting('studio.storage_bucket', true), ''), 'studio-media');
  v_max bigint := 50 * 1024 * 1024;
  v_name text := left(regexp_replace(coalesce(btrim(p_file_name), ''), '[^A-Za-z0-9._ -]', '_', 'g'), 200);
begin
  select * into e from public.entities where id = p_entity;
  v_uid := public.studio_require(e.project_id, 3, 'upload artwork');
  v_ext := case p_mime_type when 'image/png' then 'png' when 'image/jpeg' then 'jpg' end;
  -- Research documents (PDF, Word, plain text, Markdown) only for the Knowledge Base.
  if v_ext is null and e.module_key = 'knowledge' then
    v_ext := case p_mime_type when 'application/pdf' then 'pdf'
                              when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then 'docx'
                              when 'text/plain' then 'txt' when 'text/markdown' then 'md' end;
    if v_ext is not null then v_kind := 'document'; v_max := 20 * 1024 * 1024; end if;
  end if;
  if v_ext is null then
    raise exception 'Artwork must be a PNG or JPEG export.' using errcode = '22023';
  end if;
  if p_byte_size is null or p_byte_size <= 0 or p_byte_size > v_max then
    raise exception 'The file must be between 1 byte and % MB.', v_max / 1024 / 1024 using errcode = '22023';
  end if;
  v_key := format('projects/%s/entities/%s/assets/%s/original.%s', e.project_id, e.id, v_id, v_ext);
  v_exp := now() + interval '15 minutes';

  insert into public.assets (id, project_id, entity_id, kind, origin, display_name, mime_type, file_extension,
                             storage_bucket, storage_key, is_immutable_original, created_by,
                             upload_status, upload_expires_at, metadata)
  values (v_id, e.project_id, e.id, v_kind, 'upload', coalesce(nullif(v_name, ''), 'artwork.' || v_ext),
          p_mime_type, v_ext, v_bucket, v_key, true, v_uid, 'pending', v_exp,
          jsonb_build_object('declared_byte_size', p_byte_size));
  perform public.studio_audit(e.project_id, v_uid, 'user', 'asset.upload_started', 'asset', v_id,
    jsonb_build_object('entity_id', e.id, 'mime_type', p_mime_type, 'declared_byte_size', p_byte_size));
  return query select v_id, v_bucket, v_key, v_exp;
end $$;


commit;
