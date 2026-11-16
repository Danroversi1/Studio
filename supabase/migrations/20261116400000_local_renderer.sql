-- STUDIO — Local rendering: generate storyboard frames on the director's own computer.
--
-- The hosted site never talks to her computer directly. A small companion program on her
-- computer (paired once with a short code) connects OUT to Studio over HTTPS, asks for the
-- next job she explicitly submitted, downloads that job's reference images, runs an
-- allowlisted, versioned workflow on a renderer bound to loopback (e.g. ComfyUI on
-- 127.0.0.1), and uploads the result through Studio's normal checked upload path.
-- Device tokens are stored only as SHA-256 hashes. Studio never sends commands, file paths
-- or workflow graphs, only validated parameters. One submission = one job; nothing retries
-- automatically; approved or locked frames are never changed by a result.
begin;

create table if not exists public.renderer_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  report jsonb not null default '{}'::jsonb,      -- what the companion reports: OS, backend, GPU, workflows, capabilities
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);
create index if not exists renderer_devices_user on public.renderer_devices (user_id) where revoked_at is null;

create table if not exists public.renderer_pairings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  device_id uuid references public.renderer_devices(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.renderer_devices enable row level security;
alter table public.renderer_pairings enable row level security;
drop policy if exists renderer_devices_read on public.renderer_devices;
-- She sees her own computers (never the token hash: column grant below).
create policy renderer_devices_read on public.renderer_devices for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.renderer_devices from anon, authenticated;
grant select (id, user_id, name, report, created_at, last_seen_at, revoked_at) on public.renderer_devices to authenticated;
revoke all on public.renderer_pairings from anon, authenticated;

-- Jobs: the existing storyboard job history gains a "local" kind.
alter table public.storyboard_jobs drop constraint if exists storyboard_jobs_kind_check;
alter table public.storyboard_jobs add constraint storyboard_jobs_kind_check check (kind in ('illustrate', 'asset', 'local'));
alter table public.storyboard_jobs add column if not exists device_id uuid references public.renderer_devices(id) on delete set null;
alter table public.storyboard_jobs add column if not exists attempts int not null default 0;
alter table public.storyboard_jobs add column if not exists progress jsonb;
alter table public.storyboard_jobs add column if not exists cancel_requested_at timestamptz;
alter table public.storyboard_jobs add column if not exists bundle jsonb;
create index if not exists storyboard_jobs_device on public.storyboard_jobs (device_id, status) where kind = 'local';

-- ---- Pairing ----------------------------------------------------------------------------
/** A one-time pairing code for her computer (valid 10 minutes, shown once). */
create or replace function public.renderer_pair_start()
returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_code text := ''; i int; v_alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; v_rand bytea;
begin
  if v_uid is null then raise exception 'Please sign in again.' using errcode = '42501'; end if;
  if (select count(*) from public.renderer_pairings where user_id = v_uid and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many pairing codes this hour. Try again later.' using errcode = 'PT402';
  end if;
  -- 10 characters from a 32-letter alphabet, from strong random bytes (gen_random_uuid).
  v_rand := uuid_send(gen_random_uuid());
  for i in 0..9 loop v_code := v_code || substr(v_alpha, 1 + (get_byte(v_rand, i) % 32), 1); end loop;
  insert into public.renderer_pairings (user_id, code_hash, expires_at)
  values (v_uid, encode(sha256(convert_to(v_code, 'UTF8')), 'hex'), now() + interval '10 minutes');
  return v_code;
end $$;

create or replace function public.renderer_revoke(p_device uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  update public.renderer_devices set revoked_at = now() where id = p_device and user_id = v_uid and revoked_at is null;
  if not found then raise exception 'Computer not found.' using errcode = 'PT404'; end if;
  -- Its waiting jobs stop waiting.
  update public.storyboard_jobs set status = 'cancelled', error = 'This computer was disconnected from Studio.', completed_at = now()
   where device_id = p_device and status = 'queued';
end $$;

/** Hardware facts she types herself when the companion can't report them. Kept apart from
 *  what the companion detected, and labeled as hers. */
create or replace function public.renderer_set_manual(p_device uuid, p_manual jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_manual is null or jsonb_typeof(p_manual) <> 'object' or length(p_manual::text) > 2000 then raise exception 'Unexpected details.' using errcode = '22023'; end if;
  update public.renderer_devices
     set report = report || jsonb_build_object('manual', jsonb_strip_nulls(jsonb_build_object(
           'gpu', left(p_manual ->> 'gpu', 120), 'vramGb', case when (p_manual ->> 'vramGb') ~ '^\d{1,3}(\.\d)?$' then (p_manual ->> 'vramGb')::numeric end,
           'notes', left(p_manual ->> 'notes', 600))))
   where id = p_device and user_id = auth.uid() and revoked_at is null;
  if not found then raise exception 'Computer not found.' using errcode = 'PT404'; end if;
end $$;

-- SERVICE ROLE ONLY (the /api/renderer/pair route): exchange a code for a device token.
create or replace function public.renderer_pair_complete(p_code_hash text, p_token_hash text, p_name text, p_report jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare p public.renderer_pairings; v_id uuid;
begin
  select * into p from public.renderer_pairings where code_hash = p_code_hash for update;
  if p.id is null or p.used_at is not null or p.expires_at < now() then
    raise exception 'That pairing code is wrong or has expired. Make a new one in Studio.' using errcode = '22023';
  end if;
  insert into public.renderer_devices (user_id, name, token_hash, report, last_seen_at)
  values (p.user_id, left(coalesce(nullif(btrim(p_name), ''), 'My computer'), 80), p_token_hash,
          case when jsonb_typeof(p_report) = 'object' and length(p_report::text) < 60000 then p_report else '{}'::jsonb end, now())
  returning id into v_id;
  update public.renderer_pairings set used_at = now(), device_id = v_id where id = p.id;
  return v_id;
end $$;

-- SERVICE ROLE ONLY: who is this token? Also records that the computer is online.
create or replace function public.renderer_auth(p_token_hash text, p_report jsonb)
returns table (device_id uuid, user_id uuid)
language plpgsql security definer set search_path = '' as $$
declare d public.renderer_devices;
begin
  select * into d from public.renderer_devices where token_hash = p_token_hash and revoked_at is null;
  if d.id is null then return; end if;
  update public.renderer_devices set last_seen_at = now(),
         report = case when jsonb_typeof(p_report) = 'object' and length(p_report::text) < 60000
                       then (p_report - 'manual') || case when report ? 'manual' then jsonb_build_object('manual', report -> 'manual') else '{}'::jsonb end
                       else report end
   where id = d.id;
  return query select d.id, d.user_id;
end $$;

-- ---- Jobs (her side) --------------------------------------------------------------------
/** Submit ONE local generation for ONE frame. The bundle lists every reference with its role;
 *  each image must be a ready picture in this film. Same key = same job (no duplicate). */
create or replace function public.local_job_request(p_shot uuid, p_device uuid, p_workflow text, p_prompt text, p_params jsonb,
  p_bundle jsonb, p_base_asset uuid, p_idempotency_key text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare sh public.storyboard_shots; v_uid uuid; d public.renderer_devices; v_id uuid; v_inputs jsonb;
begin
  select * into sh from public.storyboard_shots where id = p_shot;
  v_uid := public.studio_require(sh.project_id, 3, 'generate frames');
  if sh.archived_at is not null then raise exception 'Frame not found.' using errcode = 'PT404'; end if;
  select j.id into v_id from public.storyboard_jobs j where j.project_id = sh.project_id and j.idempotency_key = p_idempotency_key;
  if v_id is not null then return v_id; end if;
  select * into d from public.renderer_devices where id = p_device and user_id = v_uid and revoked_at is null;
  if d.id is null then raise exception 'Connect your computer first (Connect Local Renderer).' using errcode = '22023'; end if;
  if coalesce(p_workflow, '') !~ '^[a-z0-9][a-z0-9._-]{1,60}$' then raise exception 'Unknown workflow.' using errcode = '22023'; end if;
  if length(coalesce(p_prompt, '')) not between 1 and 4000 then raise exception 'Describe the shot first.' using errcode = '22023'; end if;
  if p_params is null or jsonb_typeof(p_params) <> 'object' or length(p_params::text) > 4000 then raise exception 'Unexpected settings.' using errcode = '22023'; end if;
  if p_bundle is null or jsonb_typeof(p_bundle) <> 'object' or length(p_bundle::text) > 60000 then raise exception 'Unexpected reference bundle.' using errcode = '22023'; end if;
  v_inputs := coalesce(p_bundle -> 'inputs', '[]'::jsonb);
  if jsonb_typeof(v_inputs) <> 'array' or jsonb_array_length(v_inputs) = 0 or jsonb_array_length(v_inputs) > 12 then
    raise exception 'A local frame needs between 1 and 12 input images.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(v_inputs) x
              where coalesce(x ->> 'role', '') not in ('composition', 'start_frame', 'cast', 'location', 'look')
                 or not exists (select 1 from public.assets a where a.id::text = x ->> 'asset_id' and a.project_id = sh.project_id
                                  and a.upload_status = 'ready' and a.deleted_at is null and a.kind = 'image')) then
    raise exception 'A reference image isn''t available in this film.' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(v_inputs) x where x ->> 'role' in ('composition', 'start_frame')) <> 1 then
    raise exception 'A local frame starts from exactly one composition or earlier frame.' using errcode = '22023';
  end if;
  -- A conservative queue for one computer.
  if (select count(*) from public.storyboard_jobs j where j.device_id = p_device and j.status in ('queued', 'running')) >= 3 then
    raise exception 'Three frames are already waiting for your computer. Let them finish first.' using errcode = '22023';
  end if;
  insert into public.storyboard_jobs (project_id, sequence_id, shot_id, kind, mode, provider, model, prompt_version, prompt, params,
                                      reference_assets, source_revision, base_asset_id, idempotency_key, requested_by, device_id, bundle)
  values (sh.project_id, sh.sequence_id, sh.id, 'local', 'illustration', 'local', p_workflow, 'local-template-v1', p_prompt, p_params,
          (select jsonb_agg(jsonb_build_object('asset_id', x ->> 'asset_id', 'role', x ->> 'role')) from jsonb_array_elements(v_inputs) x),
          sh.composition_version, p_base_asset, p_idempotency_key, v_uid, p_device, p_bundle)
  returning id into v_id;
  perform public.studio_audit(sh.project_id, v_uid, 'user', 'storyboard.local_requested', 'storyboard_job', v_id, jsonb_build_object('workflow', p_workflow, 'device', p_device));
  return v_id;
end $$;

/** Cancel: a waiting job stops at once; a running one asks her computer to stop (it may
 *  already be finishing). If her computer has been away, Studio stops waiting. */
create or replace function public.local_job_cancel(p_job uuid)
returns text
language plpgsql security definer set search_path = '' as $$
declare j public.storyboard_jobs; v_uid uuid; v_seen timestamptz;
begin
  select * into j from public.storyboard_jobs where id = p_job and kind = 'local' for update;
  v_uid := public.studio_require(j.project_id, 3, 'cancel generation');
  if j.status = 'queued' then
    update public.storyboard_jobs set status = 'cancelled', error = 'Cancelled before it started.', completed_at = now() where id = p_job;
    return 'cancelled';
  elsif j.status = 'running' then
    select last_seen_at into v_seen from public.renderer_devices where id = j.device_id;
    if v_seen is null or v_seen < now() - interval '2 minutes' then
      update public.storyboard_jobs set status = 'cancelled', cancel_requested_at = now(),
             error = 'Studio stopped waiting: your computer wasn''t reachable. If it finishes later, the picture is still kept.', completed_at = now()
       where id = p_job;
      return 'stopped_waiting';
    end if;
    update public.storyboard_jobs set cancel_requested_at = now() where id = p_job;
    return 'stop_requested';
  end if;
  return j.status;
end $$;

-- ---- Jobs (her computer's side; SERVICE ROLE ONLY, after the token was checked) ---------
/** The next job for this computer, one at a time. Jobs the computer no longer has (it
 *  restarted) are marked failed, never retried automatically. */
create or replace function public.local_job_claim(p_device uuid, p_active uuid[])
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  update public.storyboard_jobs
     set status = 'failed', completed_at = now(),
         error = 'Your computer restarted or lost the job before finishing. Your frame and references are unchanged; press Generate Locally to try again.'
   where device_id = p_device and kind = 'local' and status = 'running' and not (id = any(coalesce(p_active, '{}')))
     and coalesce(progress ->> 'stage', '') <> 'upload_failed';
  if exists (select 1 from public.storyboard_jobs where device_id = p_device and kind = 'local' and status = 'running') then return null; end if;
  select id into v_id from public.storyboard_jobs
   where device_id = p_device and kind = 'local' and status = 'queued' order by created_at limit 1 for update skip locked;
  if v_id is null then return null; end if;
  update public.storyboard_jobs set status = 'running', started_at = now(), attempts = attempts + 1,
         progress = jsonb_build_object('stage', 'claimed', 'at', now())
   where id = v_id;
  return v_id;
end $$;

/** Progress from her computer; returns true when she asked to cancel. */
create or replace function public.local_job_progress(p_job uuid, p_device uuid, p_progress jsonb)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare j public.storyboard_jobs;
begin
  select * into j from public.storyboard_jobs where id = p_job and device_id = p_device and kind = 'local';
  if j.id is null then raise exception 'Job not found.' using errcode = 'PT404'; end if;
  if j.status = 'running' and jsonb_typeof(p_progress) = 'object' and length(p_progress::text) < 4000 then
    update public.storyboard_jobs set progress = p_progress || jsonb_build_object('at', now()) where id = p_job;
  end if;
  return j.cancel_requested_at is not null or j.status = 'cancelled';
end $$;

/** Reserve the result upload (same checked path as her own uploads). */
create or replace function public.local_job_reserve_output(p_job uuid, p_device uuid, p_mime text, p_byte_size bigint)
returns table (asset_id uuid, storage_bucket text, storage_key text)
language plpgsql security definer set search_path = '' as $$
declare j public.storyboard_jobs; s public.storyboard_sequences; v_id uuid := gen_random_uuid(); v_ext text; v_key text;
        v_bucket text := coalesce(nullif(current_setting('studio.storage_bucket', true), ''), 'studio-media');
begin
  select * into j from public.storyboard_jobs where id = p_job and device_id = p_device and kind = 'local';
  if j.id is null then raise exception 'Job not found.' using errcode = 'PT404'; end if;
  if j.status not in ('running', 'cancelled', 'failed') or j.output_asset_id is not null then raise exception 'This job can''t take a result now.' using errcode = 'PT409'; end if;
  if j.status = 'failed' and coalesce(j.progress ->> 'stage', '') <> 'upload_failed' then raise exception 'This job can''t take a result now.' using errcode = 'PT409'; end if;
  v_ext := case p_mime when 'image/png' then 'png' when 'image/jpeg' then 'jpg' end;
  if v_ext is null or p_byte_size is null or p_byte_size <= 0 or p_byte_size > 50 * 1024 * 1024 then
    raise exception 'Results must be PNG or JPEG up to 50 MB.' using errcode = '22023';
  end if;
  select * into s from public.storyboard_sequences where id = j.sequence_id;
  v_key := format('projects/%s/entities/%s/assets/%s/original.%s', j.project_id, s.entity_id, v_id, v_ext);
  insert into public.assets (id, project_id, entity_id, kind, origin, display_name, mime_type, file_extension,
                             storage_bucket, storage_key, is_immutable_original, created_by, upload_status, upload_expires_at, metadata)
  values (v_id, j.project_id, s.entity_id, 'image', 'generated', 'local-frame.' || v_ext, p_mime, v_ext, v_bucket, v_key, true, j.requested_by,
          'pending', now() + interval '15 minutes',
          jsonb_build_object('declared_byte_size', p_byte_size, 'storyboard_job_id', j.id, 'generated', true, 'kind', 'local', 'renderer_device', p_device));
  return query select v_id, v_bucket, v_key;
end $$;

/** Record a finished result. It becomes the frame's shown picture only if the frame is
 *  neither approved nor locked; otherwise it waits in the frame's history. */
create or replace function public.local_job_complete(p_job uuid, p_device uuid, p_asset uuid, p_meta jsonb)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare j public.storyboard_jobs; sh public.storyboard_shots; v_apply boolean := false;
begin
  select * into j from public.storyboard_jobs where id = p_job and device_id = p_device and kind = 'local' for update;
  if j.id is null then raise exception 'Job not found.' using errcode = 'PT404'; end if;
  if not exists (select 1 from public.assets a where a.id = p_asset and a.project_id = j.project_id and a.upload_status = 'ready'
                  and a.metadata ->> 'storyboard_job_id' = j.id::text) then
    raise exception 'The result upload isn''t finished.' using errcode = '22023';
  end if;
  if j.status = 'succeeded' then return j.applied; end if;
  select * into sh from public.storyboard_shots where id = j.shot_id for update;
  v_apply := (j.status = 'running' or (j.status = 'failed' and j.progress ->> 'stage' = 'upload_failed'))
             and not sh.locked and sh.state <> 'approved' and sh.archived_at is null;
  if v_apply then update public.storyboard_shots set illustration_asset_id = p_asset, updated_at = now() where id = j.shot_id; end if;
  update public.storyboard_jobs
     set status = case when j.status = 'cancelled' then 'cancelled' else 'succeeded' end, output_asset_id = p_asset, applied = v_apply,
         usage = case when jsonb_typeof(p_meta) = 'object' and length(p_meta::text) < 8000 then p_meta else null end,
         progress = jsonb_build_object('stage', 'done', 'at', now()), completed_at = now(),
         error = case when j.status = 'cancelled' then coalesce(j.error, 'Cancelled; the picture that finished anyway is kept.') else null end
   where id = p_job;
  return v_apply;
end $$;

/** A failure on her computer (out of memory, missing model, ...). Nothing retries. A
 *  finished picture that failed to upload stays on her computer and can still be sent. */
create or replace function public.local_job_fail(p_job uuid, p_device uuid, p_code text, p_message text, p_meta jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.storyboard_jobs
     set status = case when status = 'cancelled' or (cancel_requested_at is not null and p_code = 'cancelled') then 'cancelled' else 'failed' end,
         error = left(coalesce(nullif(p_message, ''), 'Failed on your computer.'), 1000),
         progress = jsonb_build_object('stage', case when p_code = 'upload_failed' then 'upload_failed' else coalesce(left(p_code, 40), 'failed') end, 'at', now())
                    || case when jsonb_typeof(p_meta) = 'object' and length(p_meta::text) < 4000 then p_meta else '{}'::jsonb end,
         completed_at = now()
   where id = p_job and device_id = p_device and kind = 'local' and status in ('queued', 'running', 'cancelled');
end $$;

-- ---- Grants -----------------------------------------------------------------------------
revoke all on function public.renderer_pair_start() from public, anon;
grant execute on function public.renderer_pair_start() to authenticated;
revoke all on function public.renderer_set_manual(uuid, jsonb) from public, anon;
grant execute on function public.renderer_set_manual(uuid, jsonb) to authenticated;
revoke all on function public.renderer_revoke(uuid) from public, anon;
grant execute on function public.renderer_revoke(uuid) to authenticated;
revoke all on function public.local_job_request(uuid, uuid, text, text, jsonb, jsonb, uuid, text) from public, anon;
grant execute on function public.local_job_request(uuid, uuid, text, text, jsonb, jsonb, uuid, text) to authenticated;
revoke all on function public.local_job_cancel(uuid) from public, anon;
grant execute on function public.local_job_cancel(uuid) to authenticated;
do $$ declare f text;
begin
  foreach f in array array['renderer_pair_complete(text, text, text, jsonb)', 'renderer_auth(text, jsonb)', 'local_job_claim(uuid, uuid[])',
    'local_job_progress(uuid, uuid, jsonb)', 'local_job_reserve_output(uuid, uuid, text, bigint)', 'local_job_complete(uuid, uuid, uuid, jsonb)',
    'local_job_fail(uuid, uuid, text, text, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

commit;
