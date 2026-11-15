-- STUDIO — developer comments layer. Pins on the live site that only developers can see:
-- page path, where on the page, what element, and the note. Not part of any film, not
-- visible to the Director or the team. Developers are listed in studio_developers (added
-- with SQL by the owner; there is no way to add yourself from the app).
begin;

create table if not exists public.studio_developers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.studio_developers enable row level security;
revoke all on public.studio_developers from anon, authenticated;
grant all on public.studio_developers to service_role;

create or replace function public.is_studio_developer()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.studio_developers where user_id = (select auth.uid()))
$$;
revoke all on function public.is_studio_developer() from public, anon;
grant execute on function public.is_studio_developer() to authenticated;

create table if not exists public.dev_comments (
  id uuid primary key default gen_random_uuid(),
  path text not null check (length(path) between 1 and 500 and path like '/%'),
  anchor jsonb not null default '{}'::jsonb,   -- {x_pct, y_px, selector, snippet, vw, vh}
  body text not null check (length(body) between 1 and 4000),
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolution_note text check (resolution_note is null or length(resolution_note) <= 2000),
  author_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id)
);
create index if not exists dev_comments_path_idx on public.dev_comments (path, status, created_at);

alter table public.dev_comments enable row level security;
drop policy if exists dev_comments_read on public.dev_comments;
create policy dev_comments_read on public.dev_comments for select to authenticated using (public.is_studio_developer());
revoke all on public.dev_comments from anon;
revoke insert, update, delete, truncate, references, trigger on public.dev_comments from authenticated;
grant select on public.dev_comments to authenticated;
grant all on public.dev_comments to service_role;

create or replace function public.add_dev_comment(p_path text, p_anchor jsonb, p_body text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_studio_developer() then
    raise exception 'Developers only.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_anchor, '{}'::jsonb)) <> 'object' or length(p_anchor::text) > 4000 then
    raise exception 'Bad anchor.' using errcode = '22023';
  end if;
  insert into public.dev_comments (path, anchor, body, author_id)
  values (left(p_path, 500), coalesce(p_anchor, '{}'::jsonb), btrim(p_body), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.set_dev_comment_status(p_comment uuid, p_status text, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_studio_developer() then
    raise exception 'Developers only.' using errcode = '42501';
  end if;
  if p_status not in ('open', 'resolved') then
    raise exception 'Unknown status.' using errcode = '22023';
  end if;
  update public.dev_comments
     set status = p_status,
         resolution_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), resolution_note),
         resolved_at = case when p_status = 'resolved' then now() end,
         resolved_by = case when p_status = 'resolved' then auth.uid() end
   where id = p_comment;
end $$;

revoke all on function public.add_dev_comment(text, jsonb, text) from public, anon;
revoke all on function public.set_dev_comment_status(uuid, text, text) from public, anon;
grant execute on function public.add_dev_comment(text, jsonb, text), public.set_dev_comment_status(uuid, text, text) to authenticated;

commit;
