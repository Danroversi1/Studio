-- STUDIO — Lens shelf: lenses she picks while browsing Lens Addiction (or another source).
-- We keep her link and the few facts she types (lens, focal lengths, type, camera, the film
-- she saw it in, what she likes). Nothing is copied from the source site. Frames point at a
-- shelf lens via content.lensId; the camera notes use its focal length and squeeze.
begin;

create table if not exists public.storyboard_lens_shelf (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  focal_lengths numeric[] not null default '{}' check (cardinality(focal_lengths) <= 20),
  zoom boolean not null default false,
  optical text not null default 'spherical' check (optical in ('spherical', 'anamorphic')),
  squeeze numeric check (squeeze is null or (squeeze between 1 and 2.5)),
  max_aperture text not null default '' check (length(max_aperture) <= 20),
  camera text not null default '' check (length(camera) <= 120),
  seen_in text not null default '' check (length(seen_in) <= 200),
  note text not null default '' check (length(note) <= 600),
  source_url text check (source_url is null or (length(source_url) <= 2000 and source_url ~ '^https://')),
  source_name text not null default '' check (length(source_name) <= 80),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists storyboard_lens_shelf_project on public.storyboard_lens_shelf (project_id) where archived_at is null;

alter table public.storyboard_lens_shelf enable row level security;
drop policy if exists storyboard_lens_shelf_read on public.storyboard_lens_shelf;
create policy storyboard_lens_shelf_read on public.storyboard_lens_shelf for select to authenticated using (public.studio_level(project_id) >= 2);
revoke all on public.storyboard_lens_shelf from anon;
revoke insert, update, delete, truncate, references, trigger on public.storyboard_lens_shelf from authenticated;
grant select on public.storyboard_lens_shelf to authenticated;

create or replace function public.storyboard_lens_save(p_project uuid, p_item uuid, p_data jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_id uuid; v_focals numeric[]; v_url text; v_optical text; v_squeeze numeric; v_source text;
begin
  v_uid := public.studio_require(p_project, 3, 'add lenses to the shelf');
  if p_data is null or jsonb_typeof(p_data) <> 'object' or length(p_data::text) > 6000 then raise exception 'Unexpected lens.' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_data ->> 'name', ''))) not between 1 and 120 then raise exception 'Give the lens a name (up to 120 characters).' using errcode = '22023'; end if;
  begin
    select coalesce(array_agg(x::numeric order by x::numeric), '{}') into v_focals
      from jsonb_array_elements_text(coalesce(p_data -> 'focal_lengths', '[]'::jsonb)) x;
  exception when others then raise exception 'Focal lengths are numbers in mm, like 25, 40, 75.' using errcode = '22023';
  end;
  if exists (select 1 from unnest(v_focals) f where f < 4 or f > 2000) then raise exception 'Focal lengths are between 4 and 2000 mm.' using errcode = '22023'; end if;
  if cardinality(v_focals) > 20 then raise exception 'Up to 20 focal lengths.' using errcode = '22023'; end if;
  v_url := nullif(btrim(coalesce(p_data ->> 'source_url', '')), '');
  if v_url is not null and (v_url !~ '^https://' or length(v_url) > 2000) then raise exception 'Paste a link that starts with https://' using errcode = '22023'; end if;
  v_optical := coalesce(nullif(p_data ->> 'optical', ''), 'spherical');
  if v_optical not in ('spherical', 'anamorphic') then raise exception 'Spherical or anamorphic.' using errcode = '22023'; end if;
  v_squeeze := case when v_optical = 'anamorphic' then coalesce(nullif(p_data ->> 'squeeze', '')::numeric, 2) end;
  v_source := case when v_url ~* '^https://([a-z0-9-]+\.)*lensaddiction\.(net|com)(/|$)' or v_url ~* '^https://lensaddiction\.circle\.so' then 'Lens Addiction'
                   when v_url is null then '' else left(substring(v_url from '^https://([^/]+)'), 80) end;
  if p_item is null then
    insert into public.storyboard_lens_shelf (project_id, name, focal_lengths, zoom, optical, squeeze, max_aperture, camera, seen_in, note, source_url, source_name, created_by)
    values (p_project, btrim(p_data ->> 'name'), v_focals, coalesce((p_data ->> 'zoom')::boolean, false), v_optical, v_squeeze,
            left(coalesce(p_data ->> 'max_aperture', ''), 20), left(coalesce(p_data ->> 'camera', ''), 120), left(coalesce(p_data ->> 'seen_in', ''), 200),
            left(coalesce(p_data ->> 'note', ''), 600), v_url, v_source, v_uid)
    returning id into v_id;
  else
    update public.storyboard_lens_shelf
       set name = btrim(p_data ->> 'name'), focal_lengths = v_focals, zoom = coalesce((p_data ->> 'zoom')::boolean, false), optical = v_optical, squeeze = v_squeeze,
           max_aperture = left(coalesce(p_data ->> 'max_aperture', ''), 20), camera = left(coalesce(p_data ->> 'camera', ''), 120),
           seen_in = left(coalesce(p_data ->> 'seen_in', ''), 200), note = left(coalesce(p_data ->> 'note', ''), 600),
           source_url = v_url, source_name = v_source, updated_at = now()
     where id = p_item and project_id = p_project and archived_at is null
     returning id into v_id;
    if v_id is null then raise exception 'Lens not found.' using errcode = 'PT404'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.storyboard_lens_archive(p_item uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare l public.storyboard_lens_shelf; v_uid uuid;
begin
  select * into l from public.storyboard_lens_shelf where id = p_item;
  v_uid := public.studio_require(l.project_id, 3, 'remove lenses');
  update public.storyboard_lens_shelf set archived_at = now(), updated_at = now() where id = p_item;
end $$;

revoke all on function public.storyboard_lens_save(uuid, uuid, jsonb) from public, anon;
grant execute on function public.storyboard_lens_save(uuid, uuid, jsonb) to authenticated;
revoke all on function public.storyboard_lens_archive(uuid) from public, anon;
grant execute on function public.storyboard_lens_archive(uuid) to authenticated;

commit;
