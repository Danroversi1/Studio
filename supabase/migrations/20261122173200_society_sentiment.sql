-- STUDIO — Society's mood: public survey data (US and EU) about jobs, prices, affordability and
-- well-being, plus reports from established pollsters. Fetched once a day for every film
-- together (public data, shared; nothing per film is fetched twice) by Studio's own code, no
-- model. Films choose which societies their story lives in.
begin;

create table if not exists public.society_sources (
  id text primary key check (id ~ '^[a-z0-9_.-]{2,60}$'),
  label text not null check (length(label) <= 200),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 500),
  latest_period date
);

create table if not exists public.society_points (
  series text not null check (series ~ '^[a-z0-9_.-]{2,80}$'),
  period date not null,                       -- the survey month (first day)
  value numeric not null,
  source_id text not null references public.society_sources(id) on delete cascade,
  fetched_at timestamptz not null default now(),
  primary key (series, period)
);
create index if not exists society_points_series_idx on public.society_points (series, period desc);

create table if not exists public.society_reports (
  id uuid primary key default gen_random_uuid(),
  url text not null unique check (length(url) <= 2000),
  title text not null check (length(title) <= 500),
  publisher text not null check (length(publisher) <= 120),
  region text not null check (region in ('US', 'EU', 'World')),
  themes text[] not null default '{}',
  published_at timestamptz,
  fetched_at timestamptz not null default now()
);
create index if not exists society_reports_recent_idx on public.society_reports (published_at desc nulls last);

-- Public data: any signed-in user can read; only the server writes.
do $$ declare t text;
begin
  foreach t in array array['society_sources', 'society_points', 'society_reports'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- Which societies a film's story lives in (default: both).
alter table public.bubble_settings add column if not exists society_regions text[] not null default '{US,EU}'
  check (society_regions <@ array['US', 'EU']::text[]);

create or replace function public.society_set_regions(p_project uuid, p_regions text[])
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'change the world');
  if p_regions is null or not (p_regions <@ array['US', 'EU']::text[]) then raise exception 'Choose US, EU or both.' using errcode = '22023'; end if;
  insert into public.bubble_settings (project_id, society_regions, updated_by) values (p_project, p_regions, v_uid)
  on conflict (project_id) do update set society_regions = p_regions, version = public.bubble_settings.version + 1, updated_by = v_uid, updated_at = now();
end $$;
revoke all on function public.society_set_regions(uuid, text[]) from public, anon;
grant execute on function public.society_set_regions(uuid, text[]) to authenticated, service_role;

commit;
