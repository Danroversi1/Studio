-- STUDIO — Delete (soft-delete) a film.
-- Deleting hides the project from everyone at once: studio_my_membership() ignores projects
-- whose status is 'deleted', so every read policy and write function stops matching.
-- Nothing is destroyed; a trusted operator can restore it.
-- Authority: Admin AND Director creative authority. Deleting a film is both an administrative
-- and a creative decision, so an admin-only collaborator cannot delete the director's work.

create or replace function public.delete_project(p_project uuid, p_confirm_name text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; m public.project_members; p public.projects;
begin
  v_uid := public.studio_require(p_project, 1, 'view this project');
  select * into m from public.studio_my_membership(p_project);
  if not (m.can_admin and m.can_approve_creative) then
    raise exception 'Only the film''s Director with Admin access can delete it.' using errcode = '42501';
  end if;
  select * into p from public.projects where id = p_project for update;
  if lower(btrim(coalesce(p_confirm_name, ''))) <> lower(btrim(p.name)) then
    raise exception 'Type the film''s title exactly to confirm.' using errcode = '22023';
  end if;
  update public.projects set status = 'deleted', archived_at = now() where id = p_project;
  perform public.studio_audit(p_project, v_uid, 'user', 'project.deleted', 'project', p_project,
    jsonb_build_object('name', p.name));
end $$;

-- SERVICE ROLE ONLY. Undo a deletion.
create or replace function public.restore_project(p_project uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.projects set status = 'active', archived_at = null where id = p_project and status = 'deleted';
  if found then
    perform public.studio_audit(p_project, null, 'system', 'project.restored', 'project', p_project, '{}');
  end if;
end $$;

revoke execute on function public.delete_project(uuid, text) from public, anon;
revoke execute on function public.restore_project(uuid) from public, anon, authenticated;
grant execute on function public.delete_project(uuid, text) to authenticated;
grant execute on function public.restore_project(uuid) to service_role;
