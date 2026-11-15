-- STUDIO — developers can edit a developer comment's text.
begin;

create or replace function public.edit_dev_comment(p_comment uuid, p_body text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_body text := btrim(coalesce(p_body, ''));
begin
  if not public.is_studio_developer() then
    raise exception 'Developers only.' using errcode = '42501';
  end if;
  if length(v_body) = 0 or length(v_body) > 4000 then
    raise exception 'Comments are 1–4,000 characters.' using errcode = '22023';
  end if;
  update public.dev_comments set body = v_body where id = p_comment;
end $$;

revoke all on function public.edit_dev_comment(uuid, text) from public, anon;
grant execute on function public.edit_dev_comment(uuid, text) to authenticated;

commit;
