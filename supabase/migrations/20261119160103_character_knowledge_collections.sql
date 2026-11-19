-- STUDIO — Each character can have their own knowledge collection, so the director can add
-- research directly to a character from the Knowledge Base. It is an ordinary collection
-- (items can also sit in other collections) connected to that character with a normal,
-- editable connection. Additive only.
begin;

alter table public.knowledge_collections add column if not exists character_id uuid references public.entities(id) on delete set null;
create unique index if not exists knowledge_collections_character_idx on public.knowledge_collections (character_id)
  where character_id is not null and archived_at is null;

/** The character's own collection (made, and connected to them, on first use). */
create or replace function public.kb_character_collection(p_project uuid, p_character uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_id uuid; v_name text; v_try text; n integer := 1;
begin
  v_uid := public.studio_require(p_project, 3, 'add research to a character');
  perform public.character_check(p_project, p_character);
  select id into v_id from public.knowledge_collections
   where project_id = p_project and character_id = p_character and archived_at is null;
  if v_id is null then
    select left(name, 100) into v_name from public.entities where id = p_character;
    v_try := v_name || '''s knowledge';
    while exists (select 1 from public.knowledge_collections where project_id = p_project and archived_at is null and lower(btrim(name)) = lower(v_try)) loop
      n := n + 1; v_try := v_name || '''s knowledge ' || n;
    end loop;
    insert into public.knowledge_collections (project_id, name, description, character_id, created_by)
    values (p_project, v_try, 'Research added for ' || v_name || '.', p_character, v_uid) returning id into v_id;
    -- Connected once, when made; she can change or remove the connection on the Connections desk.
    insert into public.character_knowledge (project_id, character_id, collection_id, purpose, temporal, note, created_by)
    values (p_project, p_character, v_id, 'profession', 'background', 'Their own research collection.', v_uid)
    on conflict do nothing;
  end if;
  return v_id;
end $$;
revoke all on function public.kb_character_collection(uuid, uuid) from public, anon;
grant execute on function public.kb_character_collection(uuid, uuid) to authenticated, service_role;

commit;
