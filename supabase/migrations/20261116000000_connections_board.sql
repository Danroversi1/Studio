-- STUDIO — Connections board: every part of the story on one corkboard.
--
-- Cards are the film's characters, locations, references (with a picture), her sticky
-- notes and, when shown, scenes. Positions are saved per card (story_board_positions).
-- Her strings (story_board_links) join two cards with a label in her words. Automatic
-- strings (who is in which scene, where scenes happen) are worked out from the script
-- each time and are never stored, so they can't go out of date.
-- Card keys: e:<entity id>, r:<reference id>, n:<note id>, s:<scene number>.
begin;

create table if not exists public.story_board_notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  body text not null check (length(body) between 1 and 600),
  color text not null default 'yellow' check (color in ('yellow', 'green', 'pink', 'blue')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.story_board_positions (
  project_id uuid not null references public.projects(id) on delete cascade,
  node_key text not null check (node_key ~ '^(e|r|n):[0-9a-f-]{36}$' or node_key ~ '^s:[0-9]{1,4}$'),
  x real not null check (x between -20000 and 20000),
  y real not null check (y between -20000 and 20000),
  updated_at timestamptz not null default now(),
  primary key (project_id, node_key)
);
create table if not exists public.story_board_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  from_key text not null check (from_key ~ '^(e|r|n):[0-9a-f-]{36}$'),
  to_key text not null check (to_key ~ '^(e|r|n):[0-9a-f-]{36}$'),
  label text check (label is null or length(label) <= 200),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_key <> to_key)
);
create unique index if not exists story_board_links_pair on public.story_board_links (project_id, least(from_key, to_key), greatest(from_key, to_key));

do $$ declare t text; begin
  foreach t in array array['story_board_notes', 'story_board_positions', 'story_board_links'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.studio_level(project_id) >= 2)', t || '_read', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- A card key must point at something in this film.
create or replace function public.studio_board_key_ok(p_project uuid, p_key text)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_key ~ '^s:[0-9]{1,4}$' then return true; end if;
  if p_key !~ '^(e|r|n):[0-9a-f-]{36}$' then return false; end if;
  v_id := substring(p_key from 3)::uuid;
  return case left(p_key, 1)
    when 'e' then exists (select 1 from public.entities where id = v_id and project_id = p_project and kind in ('character', 'location'))
    when 'n' then exists (select 1 from public.story_board_notes where id = v_id and project_id = p_project)
    when 'r' then exists (select 1 from public.research_references rr join public.research_boards b on b.id = rr.board_id
                           where rr.id = v_id and b.project_id = p_project)
    else false end;
end $$;
revoke all on function public.studio_board_key_ok(uuid, text) from public, anon;

create or replace function public.board_move(p_project uuid, p_moves jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; m jsonb; n integer := 0;
begin
  v_uid := public.studio_require(p_project, 3, 'arrange the Connections board');
  if jsonb_typeof(p_moves) <> 'array' or jsonb_array_length(p_moves) > 200 then
    raise exception 'Too many cards at once.' using errcode = '22023';
  end if;
  for m in select * from jsonb_array_elements(p_moves) loop
    continue when not public.studio_board_key_ok(p_project, m ->> 'key');
    insert into public.story_board_positions (project_id, node_key, x, y)
    values (p_project, m ->> 'key', (m ->> 'x')::real, (m ->> 'y')::real)
    on conflict (project_id, node_key) do update set x = excluded.x, y = excluded.y, updated_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.board_link(p_project uuid, p_from text, p_to text, p_label text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_id uuid; v_label text := nullif(btrim(coalesce(p_label, '')), '');
begin
  v_uid := public.studio_require(p_project, 3, 'connect cards on the board');
  if p_from = p_to or p_from ~ '^s:' or p_to ~ '^s:'
     or not public.studio_board_key_ok(p_project, p_from) or not public.studio_board_key_ok(p_project, p_to) then
    raise exception 'Those cards can''t be connected.' using errcode = '22023';
  end if;
  if length(v_label) > 200 then raise exception 'Keep the label under 200 characters.' using errcode = '22023'; end if;
  insert into public.story_board_links (project_id, from_key, to_key, label, created_by)
  values (p_project, p_from, p_to, v_label, v_uid)
  on conflict (project_id, least(from_key, to_key), greatest(from_key, to_key))
  do update set label = coalesce(excluded.label, public.story_board_links.label), updated_at = now()
  returning id into v_id;
  perform public.studio_audit(p_project, v_uid, 'user', 'board.linked', 'story_board_link', v_id, jsonb_build_object('from', p_from, 'to', p_to));
  return v_id;
end $$;

create or replace function public.board_link_label(p_link uuid, p_label text)
returns void
language plpgsql security definer set search_path = '' as $$
declare l public.story_board_links; v_uid uuid; v_label text := nullif(btrim(coalesce(p_label, '')), '');
begin
  select * into l from public.story_board_links where id = p_link;
  v_uid := public.studio_require(l.project_id, 3, 'label a connection');
  if length(v_label) > 200 then raise exception 'Keep the label under 200 characters.' using errcode = '22023'; end if;
  update public.story_board_links set label = v_label, updated_at = now() where id = p_link;
end $$;

create or replace function public.board_unlink(p_link uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare l public.story_board_links; v_uid uuid;
begin
  select * into l from public.story_board_links where id = p_link;
  v_uid := public.studio_require(l.project_id, 3, 'remove a connection');
  delete from public.story_board_links where id = p_link;
  perform public.studio_audit(l.project_id, v_uid, 'user', 'board.unlinked', 'story_board_link', p_link,
    jsonb_build_object('from', l.from_key, 'to', l.to_key, 'label', l.label));
end $$;

create or replace function public.board_note_save(p_project uuid, p_note uuid, p_body text, p_color text, p_x real, p_y real)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_id uuid; v_body text := btrim(coalesce(p_body, ''));
begin
  v_uid := public.studio_require(p_project, 3, 'write notes on the board');
  if length(v_body) not between 1 and 600 then raise exception 'Notes are 1–600 characters.' using errcode = '22023'; end if;
  if coalesce(p_color, 'yellow') not in ('yellow', 'green', 'pink', 'blue') then raise exception 'Unknown color.' using errcode = '22023'; end if;
  if p_note is null then
    insert into public.story_board_notes (project_id, body, color, created_by) values (p_project, v_body, coalesce(p_color, 'yellow'), v_uid)
    returning id into v_id;
    if p_x is not null and p_y is not null then
      insert into public.story_board_positions (project_id, node_key, x, y) values (p_project, 'n:' || v_id, p_x, p_y);
    end if;
  else
    update public.story_board_notes set body = v_body, color = coalesce(p_color, color), updated_at = now()
     where id = p_note and project_id = p_project returning id into v_id;
    if v_id is null then raise exception 'Note not found.' using errcode = 'PT404'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.board_note_delete(p_note uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare n public.story_board_notes; v_uid uuid;
begin
  select * into n from public.story_board_notes where id = p_note;
  v_uid := public.studio_require(n.project_id, 3, 'remove a note');
  delete from public.story_board_links where project_id = n.project_id and ('n:' || p_note) in (from_key, to_key);
  delete from public.story_board_positions where project_id = n.project_id and node_key = 'n:' || p_note;
  delete from public.story_board_notes where id = p_note;
end $$;

-- Existing connections made with the old Connect buttons become strings on the board.
insert into public.story_board_links (project_id, from_key, to_key, label, created_by, created_at)
select r.project_id, 'e:' || r.source_entity_id, 'e:' || r.target_entity_id,
       case r.relationship_type when 'appears_in' then 'appears in' when 'set_in' then 'set in' else null end, r.created_by, r.created_at
  from public.entity_relationships r
  join public.entities a on a.id = r.source_entity_id and a.kind in ('character', 'location')
  join public.entities b on b.id = r.target_entity_id and b.kind in ('character', 'location')
on conflict do nothing;

revoke all on function public.board_move(uuid, jsonb) from public, anon;
revoke all on function public.board_link(uuid, text, text, text) from public, anon;
revoke all on function public.board_link_label(uuid, text) from public, anon;
revoke all on function public.board_unlink(uuid) from public, anon;
revoke all on function public.board_note_save(uuid, uuid, text, text, real, real) from public, anon;
revoke all on function public.board_note_delete(uuid) from public, anon;
grant execute on function public.board_move(uuid, jsonb), public.board_link(uuid, text, text, text), public.board_link_label(uuid, text),
  public.board_unlink(uuid), public.board_note_save(uuid, uuid, text, text, real, real), public.board_note_delete(uuid) to authenticated;

commit;
