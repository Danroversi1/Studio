-- STUDIO — the treatment's slide list (each slide's permanent ID and the start of its
-- text), kept with the treatment link so a character or location's thumbnail picker can
-- open on its own slide ("Casting/Johnny") without asking Google every time. Text only;
-- no images are stored.
begin;

create or replace function public.save_treatment_slides(p_project uuid, p_file text, p_slides jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_n int;
begin
  v_uid := public.studio_require(p_project, 3, 'read the treatment');
  if p_file is null or p_file !~ '^[A-Za-z0-9_-]{10,200}$' then
    raise exception 'Unknown treatment.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_slides) <> 'array' or jsonb_array_length(p_slides) > 500 or length(p_slides::text) > 200000 then
    raise exception 'Unexpected slide list.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_slides) s
              where jsonb_typeof(s) <> 'object' or coalesce(s ->> 'id', '') !~ '^[A-Za-z0-9_.-]{1,100}$'
                 or length(coalesce(s ->> 'text', '')) > 300) then
    raise exception 'Unexpected slide list.' using errcode = '22023';
  end if;
  update public.research_references rr
     set metadata = coalesce(rr.metadata, '{}'::jsonb) || jsonb_build_object('slides', p_slides, 'slides_read_at', now())
    from public.research_boards b
   where b.id = rr.board_id and b.project_id = p_project and rr.source_url like '%/presentation/d/' || p_file || '%';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'That treatment isn''t linked to this film.' using errcode = '22023';
  end if;
end $$;

revoke all on function public.save_treatment_slides(uuid, text, jsonb) from public, anon;
grant execute on function public.save_treatment_slides(uuid, text, jsonb) to authenticated;

commit;
