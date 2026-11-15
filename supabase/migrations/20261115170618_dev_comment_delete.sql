-- STUDIO — developers can delete developer comments.
begin;

create or replace function public.delete_dev_comment(p_comment uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_studio_developer() then
    raise exception 'Developers only.' using errcode = '42501';
  end if;
  delete from public.dev_comments where id = p_comment;
end $$;

revoke all on function public.delete_dev_comment(uuid) from public, anon;
grant execute on function public.delete_dev_comment(uuid) to authenticated;

commit;
