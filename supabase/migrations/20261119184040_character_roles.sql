-- A character's role in the film (protagonist / supporting / featured), set by the
-- Director and kept in the character's metadata. Used to order character menus.
begin;

create or replace function public.set_character_role(p_entity uuid, p_role text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; e public.entities;
begin
  select * into e from public.entities where id = p_entity;
  if e.id is null or e.kind <> 'character' then raise exception 'Character not found.' using errcode = 'PT404'; end if;
  v_uid := public.studio_require(e.project_id, 3, 'develop a character');
  if p_role is not null and p_role not in ('protagonist', 'supporting', 'featured') then
    raise exception 'Choose protagonist, supporting or featured.' using errcode = '22023';
  end if;
  update public.entities
     set metadata = case when p_role is null then metadata - 'cast_role' else metadata || jsonb_build_object('cast_role', p_role) end,
         updated_at = now()
   where id = p_entity;
end $$;

revoke all on function public.set_character_role(uuid, text) from public, anon;
grant execute on function public.set_character_role(uuid, text) to authenticated, service_role;

commit;
