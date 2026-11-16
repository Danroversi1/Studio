-- STUDIO — thumbnail crops remember the slide's permanent Google ID (slide_id), so they
-- stay on the same slide when slides are added, removed or reordered. The slide number
-- is kept as where it was when chosen; x, y, w, h are the spot and size on that slide.
begin;

create or replace function public.set_entity_thumbnail_crop(p_entity uuid, p_crop jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; e public.entities; v_file text; v_slide int; v_slide_id text; x numeric; y numeric; w numeric; h numeric;
begin
  select * into e from public.entities where id = p_entity;
  v_uid := public.studio_require(e.project_id, 3, 'choose a thumbnail');
  if e.kind not in ('character', 'location') then
    raise exception 'Only characters and locations have thumbnails.' using errcode = '22023';
  end if;
  if p_crop is not null then
    v_file := p_crop ->> 'file_id';
    if v_file is null or v_file !~ '^[A-Za-z0-9_-]{10,200}$' then
      raise exception 'Unknown treatment.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.research_references rr join public.research_boards b on b.id = rr.board_id
                    where b.project_id = e.project_id and rr.source_url like '%/presentation/d/' || v_file || '%') then
      raise exception 'That treatment isn''t linked to this film.' using errcode = '22023';
    end if;
    v_slide_id := nullif(p_crop ->> 'slide_id', '');
    if v_slide_id is not null and v_slide_id !~ '^[A-Za-z0-9_.-]{1,100}$' then
      raise exception 'Unexpected slide.' using errcode = '22023';
    end if;
    begin
      v_slide := (p_crop ->> 'slide')::int;
      x := (p_crop ->> 'x')::numeric; y := (p_crop ->> 'y')::numeric; w := (p_crop ->> 'w')::numeric; h := (p_crop ->> 'h')::numeric;
    exception when others then
      raise exception 'Unexpected crop.' using errcode = '22023';
    end;
    if v_slide is null or v_slide not between 1 and 500 or x is null or y is null or w is null or h is null
       or w < 0.02 or h < 0.02 or x < 0 or y < 0 or x + w > 1.0001 or y + h > 1.0001 then
      raise exception 'Unexpected crop.' using errcode = '22023';
    end if;
  end if;
  update public.entities
     set metadata = case when p_crop is null then metadata - 'thumbnail_crop'
                         else (metadata - 'thumbnail_asset_id') || jsonb_build_object('thumbnail_crop',
                                jsonb_strip_nulls(jsonb_build_object('file_id', v_file, 'slide', v_slide, 'slide_id', v_slide_id,
                                  'x', round(x, 4), 'y', round(y, 4), 'w', round(w, 4), 'h', round(h, 4)))) end,
         updated_at = now()
   where id = p_entity;
  perform public.studio_audit(e.project_id, v_uid, 'user', 'entity.thumbnail_set', 'entity', p_entity,
    jsonb_build_object('crop', p_crop is not null));
end $$;

commit;
