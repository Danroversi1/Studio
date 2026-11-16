-- STUDIO — edit the outline in place: beats can be inserted between others, moved up or
-- down (also into the next or previous part), and edited. Order is a sortable number;
-- beats without one keep their creation order.
begin;

alter table public.story_notebook add column if not exists position double precision;

create or replace function public.place_notebook_item(p_item uuid, p_kind text, p_position double precision)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; n public.story_notebook;
begin
  select * into n from public.story_notebook where id = p_item;
  v_uid := public.studio_require(n.project_id, 3, 'edit the outline');
  if p_kind is not null and p_kind not in ('beginning', 'middle', 'ending') then
    raise exception 'Beats belong to the beginning, middle or ending.' using errcode = '22023';
  end if;
  if p_kind is not null and n.kind not in ('beginning', 'middle', 'ending') then
    raise exception 'Only outline beats can move between parts.' using errcode = '22023';
  end if;
  if p_position is null or p_position <> p_position or abs(p_position) > 1e12 then
    raise exception 'Unexpected position.' using errcode = '22023';
  end if;
  update public.story_notebook set position = p_position, kind = coalesce(p_kind, kind), updated_at = now(), updated_by = v_uid
   where id = p_item;
  perform public.studio_audit(n.project_id, v_uid, 'user', 'notebook.moved', 'story_notebook', p_item,
    jsonb_build_object('kind', coalesce(p_kind, n.kind)));
end $$;

revoke all on function public.place_notebook_item(uuid, text, double precision) from public, anon;
grant execute on function public.place_notebook_item(uuid, text, double precision) to authenticated;

commit;
