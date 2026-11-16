-- STUDIO — Look & Feel: references, directions (versions, default), storyboard links, bundle.
\set ON_ERROR_STOP 1
\pset footer off
set client_min_messages = warning;

\set as_dir      'reset role; select tests.claims(''dir'');      set role authenticated;'
\set as_viewer   'reset role; select tests.claims(''viewer'');   set role authenticated;'
\set as_reviewer 'reset role; select tests.claims(''reviewer''); set role authenticated;'
\set as_owner    'reset role;'

:as_owner
delete from tests.results;

:as_reviewer
select tests.throws(format($q$select public.look_owner_entity(%L)$q$, tests.v('A')), '42501', 'review access cannot add references');
:as_dir
select tests.put('lookent', public.look_owner_entity(tests.v('A')));
select tests.ok(public.look_owner_entity(tests.v('A')) = tests.v('lookent'), 'one Look & Feel owner entity per film');
select tests.put('lkcast', public.create_entity(tests.v('A'), 'character', 'Marie', '{}'::jsonb, null));
:as_owner
insert into public.assets (id, project_id, entity_id, kind, origin, display_name, storage_bucket, storage_key, created_by, upload_status, mime_type, file_extension, checksum_sha256)
values (gen_random_uuid(), tests.v('A'), tests.v('lookent'), 'image', 'upload', 'fog.png', 'b', 'lk-1', tests.v('dir'), 'ready', 'image/png', 'png', md5('look-fixture') || md5('feel-fixture'))
returning tests.put('lkimg', id) is null;
insert into public.assets (id, project_id, entity_id, kind, origin, display_name, storage_bucket, storage_key, created_by, upload_status, mime_type, file_extension)
values (gen_random_uuid(), tests.v('A'), tests.v('lkcast'), 'image', 'upload', 'marie.png', 'b', 'lk-2', tests.v('dir'), 'ready', 'image/png', 'png')
returning tests.put('lkcastimg', id) is null;
:as_dir
-- Same bytes are found again (no duplicate upload).
select tests.ok((select asset_id from public.look_find_asset(tests.v('A'), md5('look-fixture') || md5('feel-fixture'))) = tests.v('lkimg'), 'a re-upload finds the existing image');
select tests.put('r1', public.look_reference_save(tests.v('A'), null, jsonb_build_object('asset_id', tests.v('lkimg'), 'title', 'Fog street',
  'tags', '["colors","lighting"]'::jsonb, 'reason', 'I like the soft shadows and muted greens.', 'leave_out', 'Ignore the furniture and the person''s appearance.')));
select tests.ok((select reason from public.look_references where id = tests.v('r1')) = 'I like the soft shadows and muted greens.', 'her words are kept as written');
-- Reusing a cast picture points at the same asset.
select tests.put('r2', public.look_reference_save(tests.v('A'), null, jsonb_build_object('asset_id', tests.v('lkcastimg'), 'source_entity_id', tests.v('lkcast'), 'title', 'Marie light')));
select tests.ok((select count(*) from public.assets where project_id = tests.v('A') and storage_key in ('lk-1', 'lk-2')) = 2, 'reusing a cast image stores nothing new');
select tests.put('r3', public.look_reference_save(tests.v('A'), null, '{"source_url":"https://pinterest.com/board/x","title":"Pinterest board"}'));
select tests.ok((select asset_id is null and thumb_asset_id is null from public.look_references where id = tests.v('r3')), 'a link stays a link (no image claimed)');
select tests.put('r4', public.look_reference_save(tests.v('A'), null, '{"crop":{"file_id":"16z7naEf0h3v6","slide":3,"slide_id":"g1","x":0.1,"y":0.1,"w":0.5,"h":0.5},"title":"Slide 3 sky"}'));
select tests.throws(format($q$select public.look_reference_save(%L, null, '{"title":"empty"}')$q$, tests.v('A')), '22023', 'a reference needs an image, crop or link');
select tests.throws(format($q$select public.look_reference_save(%L, null, '{"source_url":"javascript:x"}')$q$, tests.v('A')), '22023', 'only https links');
select tests.throws(format($q$select public.look_reference_save(%L, %L, '{"tags":["sparkles"]}')$q$, tests.v('A'), tests.v('r1')), '22023', 'only known tags');
select public.look_reference_save(tests.v('A'), tests.v('r1'), jsonb_build_object('applies', jsonb_build_object('entities', jsonb_build_array(tests.v('lkcast')), 'scenes', '[2,3]'::jsonb), 'status', 'approved',
  'palette', '[{"hex":"#556b2f","source":"suggested"}]'::jsonb));
select tests.ok((select status = 'approved' and applies -> 'scenes' = '[2,3]'::jsonb and title = 'Fog street' from public.look_references where id = tests.v('r1')), 'partial edits keep other fields');
select tests.throws(format($q$select public.look_reference_save(%L, %L, '{"palette":[{"hex":"green"}]}')$q$, tests.v('A'), tests.v('r1')), '22023', 'palette colors are #RRGGBB');
select public.look_reference_move(tests.v('r3'), 1);
select tests.ok((select id from public.look_references where project_id = tests.v('A') and archived_at is null order by position limit 1) = tests.v('r3'), 'references can be reordered');

-- Directions: versions, single default, conflicts left to her.
select tests.put('d1', (select direction_id from public.look_direction_save(tests.v('A'), null, jsonb_build_object('name', 'Everyday warmth', 'intention', 'Soft and close',
  'reference_ids', jsonb_build_array(tests.v('r1'), tests.v('r4'))), null)));
select tests.put('d2', (select direction_id from public.look_direction_save(tests.v('A'), null, '{"name":"Cold and controlled"}', null)));
select tests.ok((select array_agg(reference_id order by position) from public.look_direction_refs where direction_id = tests.v('d1')) = array[tests.v('r1'), tests.v('r4')], 'ordered references');
select tests.throws(format($q$select public.look_direction_set_default(%L, %L)$q$, tests.v('A'), tests.v('d1')), '22023', 'only an approved direction can be the default');
select public.look_direction_save(tests.v('A'), tests.v('d1'), '{"status":"approved"}', 1);
select tests.ok((select version from public.look_directions where id = tests.v('d1')) = 2, 'approving makes a new version');
select tests.throws(format($q$select * from public.look_direction_save(%L, %L, '{"name":"x"}', 1)$q$, tests.v('A'), tests.v('d1')), 'PT409', 'a stale edit is refused');
select public.look_direction_set_default(tests.v('A'), tests.v('d1'));
select public.look_direction_save(tests.v('A'), tests.v('d2'), '{"status":"approved"}', 1);
select public.look_direction_set_default(tests.v('A'), tests.v('d2'));
select tests.ok((select count(*) from public.look_directions where project_id = tests.v('A') and is_default) = 1 and
  (select is_default from public.look_directions where id = tests.v('d2')), 'one default direction');
select public.look_direction_set_default(tests.v('A'), tests.v('d1'));

-- Storyboard: frames follow the default; editing the direction flags approved frames only.
select tests.put('lksb', public.storyboard_create(tests.v('A'), 'Look test', '', '{}'));
select tests.put('f1', public.storyboard_shot_save(tests.v('lksb'), null, '{"action":"Marie at the window."}', 'director', null, null, null));
select tests.put('f2', public.storyboard_shot_save(tests.v('lksb'), null, '{"action":"Street."}', 'director', null, null, null));
select tests.put('f3', public.storyboard_shot_save(tests.v('lksb'), null, '{"action":"Night."}', 'director', null, null, null));
select public.storyboard_shot_state(tests.v('f1'), 'approved', null);
select public.storyboard_shot_state(tests.v('f3'), 'approved', null);
select public.storyboard_shot_look(tests.v('f3'), jsonb_build_object('mode', 'direction', 'direction_id', tests.v('d2')));
select tests.ok((select look ->> 'version' from public.storyboard_shots where id = tests.v('f3')) = '2', 'a frame records the direction version');
select tests.ok((select flagged from public.look_direction_save(tests.v('A'), tests.v('d1'), '{"intention":"Soft, close, green"}', null)) = 1,
  'editing the default flags its approved frame only');
select tests.ok((select review is not null from public.storyboard_shots where id = tests.v('f1')) and
  (select review is null from public.storyboard_shots where id = tests.v('f2')) and (select review is null from public.storyboard_shots where id = tests.v('f3')),
  'unapproved frames and frames on another direction are not flagged');
select tests.ok((select composition from public.storyboard_shots where id = tests.v('f1')) = '{}'::jsonb and
  (select count(*) from public.storyboard_jobs where shot_id = tests.v('f1')) = 0, 'nothing is redrawn or generated');
select tests.ok((select count(*) from public.look_direction_versions where direction_id = tests.v('d1')) = 3, 'every version is kept');
select public.storyboard_shot_look(tests.v('f2'), jsonb_build_object('mode', 'references', 'reference_ids', jsonb_build_array(tests.v('r2'))));
select tests.throws(format($q$select public.storyboard_shot_look(%L, '{"mode":"references","reference_ids":[]}')$q$, tests.v('f2')), '22023', 'reference mode needs references');
select public.storyboard_sequence_look(tests.v('lksb'), tests.v('d2'));
select public.storyboard_shot_state(tests.v('f1'), null, true);
select tests.throws(format($q$select public.storyboard_shot_look(%L, null)$q$, tests.v('f1')), '22023', 'locked frames keep their look');

-- Bundle for a future renderer: one direction, a specific version, roles and notes.
select tests.ok((public.look_bundle(tests.v('d1'), 1) -> 'references' -> 0 ->> 'leave_out') = 'Ignore the furniture and the person''s appearance.'
  and (public.look_bundle(tests.v('d1'), 1) -> 'references' -> 0 ->> 'role') = 'look_and_feel'
  and (public.look_bundle(tests.v('d1'), 1) -> 'references' -> 1 ->> 'access') = 'treatment_crop', 'bundle carries roles, access and her notes');
select tests.ok((public.look_bundle(tests.v('d1')) -> 'direction' ->> 'intention') = 'Soft, close, green', 'current bundle has the latest version');

-- Removing a reference leaves shared images alone and updates directions (flagging frames).
select tests.ok(public.look_reference_remove(tests.v('r2')) = 0, 'removing a reference in no direction');
select tests.ok((select deleted_at is null from public.assets where id = tests.v('lkcastimg')), 'the cast image is untouched');
select public.storyboard_shot_save(tests.v('lksb'), tests.v('f2'), '{"action":"Street at dusk."}', 'director', null, null, null);
select tests.ok(public.look_reference_remove(tests.v('r4')) = 1, 'removing a reference updates its direction');
select tests.ok((select array_agg(reference_id) from public.look_direction_refs where direction_id = tests.v('d1')) = array[tests.v('r1')]
  and (select version from public.look_directions where id = tests.v('d1')) = 4, 'the direction gets a new version');

:as_reviewer
select tests.ok((select count(*) from public.look_references where project_id = tests.v('A')) = 4, 'the team can see references');
select tests.ok(public.look_bundle(tests.v('d1')) is not null, 'the team can read a bundle');
select tests.throws(format($q$insert into public.look_references (project_id, position) values (%L, 1)$q$, tests.v('A')), '42501', 'no direct writes');
:as_viewer
select tests.ok((select count(*) from public.look_references where project_id = tests.v('A')) = 0, 'outsiders see nothing');
select tests.throws(format($q$select public.look_bundle(%L)$q$, tests.v('d1')), '42501', 'outsiders cannot read a bundle');

:as_owner
select n, case when passed then 'PASS' else 'FAIL' end as result, label, detail from tests.results order by n;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from tests.results;
do $$ begin
  if exists (select 1 from tests.results where not passed) then
    raise exception 'Look & Feel test suite FAILED';
  end if;
end $$;
