-- STUDIO milestone 1 — database security and integrity tests.
-- Run with scripts/db-test.sh (plain PostgreSQL + auth shim) or against a local Supabase
-- database (supabase start; psql "$DB_URL" -f this file). Uses seeded users only.
\set ON_ERROR_STOP 1
\pset footer off
set client_min_messages = warning;

-- ---------------------------------------------------------------------------
-- Minimal test harness
-- ---------------------------------------------------------------------------
drop schema if exists tests cascade;
create schema tests;
grant usage on schema tests to anon, authenticated, service_role;
create table tests.results (n serial, label text, passed boolean, detail text);
create table tests.ctx (k text primary key, v uuid);
grant all on all tables in schema tests to anon, authenticated, service_role;
grant all on all sequences in schema tests to anon, authenticated, service_role;

create function tests.v(p text) returns uuid language sql stable as $$ select v from tests.ctx where k = p $$;
create function tests.put(p text, val uuid) returns uuid language sql as $$
  insert into tests.ctx values (p, val) on conflict (k) do update set v = excluded.v returning v $$;
create function tests.claims(p text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', tests.v(p), 'role', 'authenticated')::text, false);
end $$;
create function tests.ok(cond boolean, label text) returns void language sql as $$
  insert into tests.results (label, passed, detail) values (label, coalesce(cond, false), case when cond then null else 'condition false' end) $$;
create function tests.throws(q text, state text, label text) returns void language plpgsql as $$
begin
  execute q;
  insert into tests.results (label, passed, detail) values (label, false, 'no error raised');
exception when others then
  insert into tests.results (label, passed, detail)
  values (label, sqlstate = state, case when sqlstate = state then sqlerrm else format('got %s: %s', sqlstate, sqlerrm) end);
end $$;
create function tests.lives(q text, label text) returns void language plpgsql as $$
begin
  execute q;
  insert into tests.results (label, passed) values (label, true);
exception when others then
  insert into tests.results (label, passed, detail) values (label, false, format('%s: %s', sqlstate, sqlerrm));
end $$;
create function tests.n(q text) returns bigint language plpgsql as $$
declare c bigint; begin execute format('select count(*) from (%s) s', q) into c; return c; end $$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

\set as_dir       'reset role; select tests.claims(''dir'');       set role authenticated;'
\set as_viewer    'reset role; select tests.claims(''viewer'');    set role authenticated;'
\set as_reviewer  'reset role; select tests.claims(''reviewer'');  set role authenticated;'
\set as_editor    'reset role; select tests.claims(''editor'');    set role authenticated;'
\set as_committer 'reset role; select tests.claims(''committer''); set role authenticated;'
\set as_admin     'reset role; select tests.claims(''admin_only'');set role authenticated;'
\set as_ep        'reset role; select tests.claims(''ep'');        set role authenticated;'
\set as_outsider  'reset role; select tests.claims(''outsider'');  set role authenticated;'
\set as_anon      'reset role; select set_config(''request.jwt.claims'', '''', false); set role anon;'
\set as_service   'reset role; select set_config(''request.jwt.claims'', '''', false); set role service_role;'
\set as_owner     'reset role;'

-- ---------------------------------------------------------------------------
-- Seed users (seeded directly; invitation delivery is out of scope)
-- ---------------------------------------------------------------------------
:as_owner
select tests.put(k, gen_random_uuid()) from unnest(array[
  'dir','viewer','reviewer','editor','committer','admin_only','ep','outsider']) k;
insert into auth.users (id, email) select v, k || '@studio.test' from tests.ctx;

-- ---------------------------------------------------------------------------
-- Creative workflow as the director (project creator)
-- ---------------------------------------------------------------------------
:as_dir
select tests.put('A', public.create_project('The Lighthouse Keeper', 'Short film'));
select tests.put('story', (select id from public.entities where project_id = tests.v('A') and kind = 'story'));
select tests.ok((public.my_project_capabilities(tests.v('A')) ->> 'can_approve_canonical')::boolean,
  'creator explicitly receives commit + creative approval');
select tests.ok((public.my_project_capabilities(tests.v('A')) ->> 'can_admin')::boolean, 'creator explicitly receives admin');

select tests.put('s_v1', public.create_revision(tests.v('story'), '{"body":"A girl keeps the light."}', 'first pass'));
select public.approve_revision(tests.v('s_v1'), null);
select tests.put('mira', public.create_entity(tests.v('A'), 'character', 'Mira', '{"summary":"Keeper, age 12"}'));
select tests.put('c_v1', (select id from public.versions where entity_id = tests.v('mira')));
select tests.put('lighthouse', public.create_entity(tests.v('A'), 'location', 'Lighthouse', '{"summary":"Rocky point"}'));
select public.link_entities(tests.v('mira'), tests.v('story'), 'appears_in');
select public.link_entities(tests.v('story'), tests.v('lighthouse'), 'set_in');
select tests.put('art1', (select asset_id from public.begin_asset_upload(tests.v('mira'), 'mira_v1.png', 'image/png', 2048)));
select tests.ok(tests.n($$select 1 from public.assets where id = tests.v('art1')$$) = 0, 'pending upload is not visible, even to its uploader');
:as_service
select public.complete_asset_upload(tests.v('art1'), 2048, repeat('a', 64), 'image/png');
:as_dir
select tests.ok(tests.n($$select 1 from public.assets where id = tests.v('art1')$$) = 1, 'completed upload becomes visible');
select tests.ok((select storage_key from public.assets where id = tests.v('art1'))
  = format('projects/%s/entities/%s/assets/%s/original.png', tests.v('A'), tests.v('mira'), tests.v('art1')),
  'storage key is generated server-side from ids');
select tests.put('c_v2', public.create_revision(tests.v('mira'), '{"summary":"Keeper, age 12","notes":"Yellow raincoat"}',
  'add costume note', tests.v('c_v1'), null, array[tests.v('art1')]));
select public.approve_revision(tests.v('c_v2'), null);
select public.add_reference(tests.v('mira'), 'https://example.org/raincoat', 'Raincoat study', 'Example Museum', 'Colour reference', 'unknown');
-- a second upload that is NOT in the approved version
select tests.put('art2', (select asset_id from public.begin_asset_upload(tests.v('mira'), 'mira_wip.jpg', 'image/jpeg', 1000)));
:as_service
select public.complete_asset_upload(tests.v('art2'), 1000, repeat('b', 64), 'image/jpeg');

-- Outsider's own project
:as_outsider
select tests.put('B', public.create_project('Other film'));
select tests.put('b_char', public.create_entity(tests.v('B'), 'character', 'Other', '{"summary":"x"}'));
select tests.put('b_v1', (select id from public.versions where entity_id = tests.v('b_char')));
select tests.put('b_art', (select asset_id from public.begin_asset_upload(tests.v('b_char'), 'b.png', 'image/png', 10)));
:as_service
select public.complete_asset_upload(tests.v('b_art'), 10, repeat('c', 64), 'image/png');

-- Seed collaborators on project A (trusted path; no membership UI in this milestone)
:as_owner
insert into public.project_members (project_id, user_id, project_role, access_level, can_admin, can_approve_creative, can_authorize_spend, accepted_at)
select tests.v('A'), tests.v(k), r::public.project_role, l::public.access_level, a, c, s, now()
from (values ('viewer','collaborator','view',false,false,false),
             ('reviewer','collaborator','review',false,false,false),
             ('editor','collaborator','edit',false,false,false),
             ('committer','collaborator','commit',false,false,false),
             ('admin_only','collaborator','view',true,false,false),
             ('ep','executive_producer','edit',false,false,true)) t(k,r,l,a,c,s);

-- ---------------------------------------------------------------------------
-- Persistence and visibility for the director
-- ---------------------------------------------------------------------------
:as_dir
select tests.ok(tests.n($$select 1 from public.projects$$) = 1, 'director sees exactly their project');
select tests.ok(tests.n($$select 1 from public.entities where project_id = tests.v('A')$$) = 3, 'story, character and location persisted');
select tests.ok(tests.n($$select 1 from public.entity_relationships where project_id = tests.v('A')$$) = 2, 'relationships persisted');
select tests.ok(tests.n($$select 1 from public.versions where entity_id = tests.v('mira')$$) = 2, 'revision history persisted');
select tests.ok((select current_version_id from public.entities where id = tests.v('mira')) = tests.v('c_v2'), 'approved revision is canonical');
select tests.ok(tests.n($$select 1 from public.research_references where project_id = tests.v('A') and attribution = 'Example Museum'$$) = 1, 'reference with attribution persisted');

-- ---------------------------------------------------------------------------
-- Project isolation
-- ---------------------------------------------------------------------------
select tests.ok(tests.n($$select 1 from public.projects where id = tests.v('B')$$) = 0, 'A director cannot see project B');
select tests.ok(tests.n($$select 1 from public.assets where id = tests.v('b_art')$$) = 0, 'A director cannot see project B assets');
:as_outsider
select tests.ok(tests.n($$select 1 from public.projects where id = tests.v('A')$$) = 0, 'outsider cannot see project A');
select tests.ok(tests.n($$select 1 from public.entities where project_id = tests.v('A')$$) = 0, 'outsider cannot see A entities');
select tests.ok(tests.n($$select 1 from public.versions where project_id = tests.v('A')$$) = 0, 'outsider cannot see A versions');
select tests.ok(tests.n($$select 1 from public.assets where project_id = tests.v('A')$$) = 0, 'outsider cannot see A assets (no key to sign)');
select tests.ok(tests.n($$select 1 from public.audit_events where project_id = tests.v('A')$$) = 0, 'outsider cannot see A audit');
select tests.ok(tests.n($$select 1 from public.project_members where project_id = tests.v('A')$$) = 0, 'outsider cannot see A members');
select tests.throws($$select public.create_revision(tests.v('story'), '{"body":"hijack"}')$$, 'PT404', 'outsider cannot write to A (looks like not-found)');
select tests.throws($$select * from public.begin_asset_upload(tests.v('mira'), 'x.png', 'image/png', 10)$$, 'PT404', 'outsider cannot upload into A');
select tests.throws($$select public.link_entities(tests.v('b_char'), tests.v('story'), 'related_to')$$, '22023', 'outsider cannot link into A');
select tests.ok((public.my_project_capabilities(tests.v('A')) ->> 'member')::boolean = false, 'outsider has no capabilities on A');

-- ---------------------------------------------------------------------------
-- View
-- ---------------------------------------------------------------------------
:as_viewer
select tests.ok(tests.n($$select 1 from public.entities where id in (tests.v('story'), tests.v('mira'))$$) = 2, 'viewer sees approved items');
select tests.ok(tests.n($$select 1 from public.entities where id = tests.v('lighthouse')$$) = 0, 'viewer does not see unapproved location');
select tests.ok(tests.n($$select 1 from public.versions where id = tests.v('c_v2')$$) = 1, 'viewer sees canonical version');
select tests.ok(tests.n($$select 1 from public.versions where id = tests.v('c_v1')$$) = 0, 'viewer does not see non-canonical history');
select tests.ok(tests.n($$select 1 from public.assets where id = tests.v('art1')$$) = 1, 'viewer sees artwork of the approved version');
select tests.ok(tests.n($$select 1 from public.assets where id = tests.v('art2')$$) = 0, 'viewer does not see unapproved artwork');
select tests.throws($$select public.create_revision(tests.v('mira'), '{"summary":"x"}')$$, '42501', 'viewer cannot save revisions');
select tests.throws($$select public.add_review_comment(tests.v('c_v2'), 'nice')$$, '42501', 'viewer cannot comment');
select tests.throws($$insert into public.versions (project_id, entity_id, branch_id, version_number, created_by)
  select project_id, id, (select id from public.branches where project_id = tests.v('A')), 99, auth.uid() from public.entities where id = tests.v('mira')$$,
  '42501', 'viewer cannot insert versions directly');
select tests.throws($$update public.entities set name = 'Hacked' where id = tests.v('mira')$$, '42501', 'viewer cannot update entities directly');

-- ---------------------------------------------------------------------------
-- Review
-- ---------------------------------------------------------------------------
:as_reviewer
select tests.ok(tests.n($$select 1 from public.versions where entity_id = tests.v('mira')$$) = 2, 'reviewer sees full history');
select tests.ok(tests.n($$select 1 from public.assets where id = tests.v('art2')$$) = 1, 'reviewer sees work-in-progress artwork');
select tests.lives($$select public.add_review_comment(tests.v('c_v2'), 'Love the raincoat')$$, 'reviewer can comment');
select tests.throws($$select public.create_revision(tests.v('mira'), '{"summary":"x"}')$$, '42501', 'reviewer cannot save revisions');
select tests.throws($$select public.create_entity(tests.v('A'), 'character', 'X')$$, '42501', 'reviewer cannot create characters');
select tests.throws($$select * from public.begin_asset_upload(tests.v('mira'), 'x.png', 'image/png', 10)$$, '42501', 'reviewer cannot upload');

-- ---------------------------------------------------------------------------
-- Edit
-- ---------------------------------------------------------------------------
:as_editor
select tests.put('e_v3', public.create_revision(tests.v('mira'), '{"summary":"Keeper, age 13"}', 'older', tests.v('c_v2'), tests.v('c_v2')));
select tests.ok((select created_by from public.versions where id = tests.v('e_v3')) = tests.v('editor'), 'revision author is the authenticated caller');
select tests.ok((select status from public.versions where id = tests.v('e_v3')) = 'submitted', 'editor revision is a proposal, not approved');
select tests.throws($$select public.approve_revision(tests.v('e_v3'), tests.v('c_v2'))$$, '42501', 'editor cannot approve');
select tests.throws($$update public.entities set current_version_id = tests.v('e_v3') where id = tests.v('mira')$$, '42501', 'editor cannot set canonical version directly');
select tests.throws($$update public.versions set status = 'approved' where id = tests.v('e_v3')$$, '42501', 'editor cannot mark a version approved directly');
select tests.throws($$insert into public.approvals (project_id, approval_type, target_type, target_id, requested_by, approver_id, status)
  values (tests.v('A'), 'creative', 'version', tests.v('e_v3'), auth.uid(), auth.uid(), 'approved')$$, '42501', 'editor cannot forge an approval');
select tests.throws($$insert into public.audit_events (project_id, actor_user_id, event_type) values (tests.v('A'), tests.v('dir'), 'version.approved')$$,
  '42501', 'editor cannot forge audit events');
select tests.throws($$update public.change_set_items set item_status = 'accepted'$$, '42501', 'editor cannot accept change-set items');
select tests.throws($$select public.create_revision(tests.v('mira'), '{"summary":"x"}', null, null, null, array[tests.v('b_art')])$$,
  '22023', 'editor cannot attach another project''s artwork');
select tests.throws($$select public.create_revision(tests.v('mira'), '{"summary":"x","script":"y"}')$$, '22023', 'unknown content fields rejected');
select tests.throws($$select public.create_revision(tests.v('mira'), '{"summary":"x"}', null, tests.v('s_v1'))$$, '22023', 'parent from another entity rejected');

-- ---------------------------------------------------------------------------
-- Commit without Director authority, Admin alone, Executive Producer
-- ---------------------------------------------------------------------------
:as_committer
select tests.throws($$select public.approve_revision(tests.v('e_v3'), tests.v('c_v2'))$$, '42501', 'commit without director authority cannot approve');
:as_admin
select tests.throws($$select public.approve_revision(tests.v('e_v3'), tests.v('c_v2'))$$, '42501', 'admin alone cannot approve creative work');
select tests.throws($$select public.create_revision(tests.v('mira'), '{"summary":"x"}')$$, '42501', 'admin alone cannot edit creative work');
select tests.ok(tests.n($$select 1 from public.audit_events where project_id = tests.v('A')$$) > 0, 'admin can read the audit trail');
:as_ep
select tests.throws($$select public.approve_revision(tests.v('e_v3'), tests.v('c_v2'))$$, '42501', 'executive producer cannot approve creative work');
:as_owner
select tests.throws($$update public.project_members set can_approve_creative = true where user_id = tests.v('ep')$$,
  '23514', 'EP cannot hold creative-approval authority (constraint)');
select tests.throws($$update public.project_members set access_level = 'admin' where user_id = tests.v('editor')$$,
  '23514', 'legacy admin access level can no longer be assigned');

-- ---------------------------------------------------------------------------
-- Atomic approval and stale-base detection
-- ---------------------------------------------------------------------------
:as_editor
select tests.put('e_v4', public.create_revision(tests.v('mira'), '{"summary":"Keeper, age 12, braver"}', 'parallel idea', tests.v('c_v2'), tests.v('c_v2')));
:as_dir
select tests.lives($$select public.approve_revision(tests.v('e_v3'), tests.v('c_v2'))$$, 'director approves editor proposal');
select tests.ok((select current_version_id from public.entities where id = tests.v('mira')) = tests.v('e_v3'), 'canonical pointer moved');
select tests.ok((select status from public.versions where id = tests.v('c_v2')) = 'superseded', 'previous canonical superseded');
select tests.ok((select status from public.versions where id = tests.v('e_v3')) = 'approved', 'new canonical marked approved');
select tests.ok(tests.n($$select 1 from public.approvals where target_id = tests.v('e_v3') and approver_id = tests.v('dir') and approval_type = 'creative'$$) = 1,
  'creative approval recorded with the authenticated approver');
select tests.ok(tests.n($$select 1 from public.audit_events where target_id = tests.v('e_v3') and event_type = 'version.approved' and actor_user_id = tests.v('dir')$$) = 1,
  'approval audit event recorded by trusted function');
-- e_v4 was written against c_v2; e_v3 is now canonical.
select tests.throws($$select public.approve_revision(tests.v('e_v4'), tests.v('c_v2'))$$, 'PT409', 'approval with outdated expected-current is rejected');
select tests.throws($$select public.approve_revision(tests.v('e_v4'), tests.v('e_v3'))$$, 'PT409', 'approval of stale-base revision is rejected');
select tests.throws($$select public.approve_revision(tests.v('c_v1'), tests.v('e_v3'))$$, 'PT409', 'approval of very old revision is rejected');
select tests.ok((select current_version_id from public.entities where id = tests.v('mira')) = tests.v('e_v3')
  and (select status from public.versions where id = tests.v('e_v4')) = 'submitted'
  and tests.n($$select 1 from public.approvals where target_id = tests.v('e_v4')$$) = 0,
  'rejected approval left no partial changes');
select tests.throws($$select public.approve_revision(tests.v('e_v3'), tests.v('e_v3'))$$, 'PT409', 'already-canonical approval rejected clearly');

-- ---------------------------------------------------------------------------
-- Cross-project and wrong-entity references (constraints hold even for trusted code)
-- ---------------------------------------------------------------------------
:as_owner
select tests.throws($$insert into public.entity_relationships (project_id, source_entity_id, target_entity_id, relationship_type, created_by)
  values (tests.v('A'), tests.v('mira'), tests.v('b_char'), 'related_to', tests.v('dir'))$$, '23503', 'cross-project relationship rejected');
select tests.throws($$update public.entities set current_version_id = tests.v('s_v1') where id = tests.v('mira')$$, '23503',
  'canonical pointer to another entity''s version rejected');
select tests.throws($$update public.entities set current_version_id = tests.v('b_v1') where id = tests.v('mira')$$, '23503',
  'canonical pointer to another project''s version rejected');
select tests.throws($$insert into public.versions (project_id, entity_id, branch_id, version_number, created_by)
  values (tests.v('A'), tests.v('b_char'), (select id from public.branches where project_id = tests.v('A')), 1, tests.v('dir'))$$, '23503',
  'version for another project''s entity rejected');
select tests.throws($$insert into public.version_assets (project_id, version_id, asset_id) values (tests.v('A'), tests.v('e_v3'), tests.v('b_art'))$$, '23503',
  'cross-project artwork attachment rejected');
select tests.throws($$insert into public.project_imports (project_id, source_name, source_type, imported_asset_id, created_by)
  values (tests.v('A'), 'x', 'file', tests.v('b_art'), tests.v('dir'))$$, '23503', 'project_imports.imported_asset_id now has a same-project FK');
select tests.throws($$insert into public.assets (project_id, entity_id, kind, origin, display_name, storage_bucket, storage_key, created_by)
  values (tests.v('A'), tests.v('b_char'), 'image', 'upload', 'x', 'b', 'k-cross', tests.v('dir'))$$, '23503', 'asset linked to another project''s entity rejected');

-- ---------------------------------------------------------------------------
-- Immutability of history, originals and audit
-- ---------------------------------------------------------------------------
select tests.throws($$update public.versions set content = '{"summary":"rewritten"}' where id = tests.v('c_v1')$$, '42501', 'historical content immutable (even as owner)');
select tests.throws($$update public.versions set status = 'working' where id = tests.v('e_v3')$$, '22023', 'approved version cannot revert to draft');
select tests.throws($$update public.assets set storage_key = 'overwrite.png' where id = tests.v('art1')$$, '42501', 'original storage key immutable');
select tests.throws($$update public.assets set byte_size = 1, checksum_sha256 = repeat('0', 64) where id = tests.v('art1')$$, '42501', 'completed original metadata immutable');
select tests.throws($$update public.audit_events set event_type = 'nothing' where project_id = tests.v('A')$$, '42501', 'audit events append-only');
select tests.throws($$update public.approvals set approver_id = tests.v('ep') where target_id = tests.v('e_v3')$$, '42501', 'decided approval immutable');
:as_service
select tests.throws($$update public.versions set content = '{}' where id = tests.v('c_v1')$$, '42501', 'service role cannot rewrite history either');
:as_dir
select tests.throws($$delete from public.versions where id = tests.v('c_v1')$$, '42501', 'director cannot delete history');
select tests.throws($$delete from public.audit_events$$, '42501', 'director cannot delete audit events');

-- ---------------------------------------------------------------------------
-- Upload lifecycle
-- ---------------------------------------------------------------------------
select tests.throws($$select * from public.begin_asset_upload(tests.v('mira'), 'a.gif', 'image/gif', 10)$$, '22023', 'non-PNG/JPEG rejected');
select tests.throws($$select * from public.begin_asset_upload(tests.v('mira'), 'big.png', 'image/png', 60 * 1024 * 1024)$$, '22023', 'oversize upload rejected');
select tests.throws($$select public.complete_asset_upload(tests.v('art1'), 2048, repeat('a', 64), 'image/png')$$, '42501', 'clients cannot mark uploads complete');
select tests.put('art3', (select asset_id from public.begin_asset_upload(tests.v('mira'), '../../etc/passwd.png', 'image/png', 500)));
select tests.ok((select storage_key !~ '\.\.' from public.assets where id = tests.v('art3')) is not false, 'file name never reaches the storage key');
:as_service
select tests.throws($$select public.complete_asset_upload(tests.v('art3'), 499, repeat('d', 64), 'image/png')$$, '22023', 'size mismatch on completion rejected');
select tests.throws($$select public.complete_asset_upload(tests.v('art1'), 2048, repeat('a', 64), 'image/png')$$, 'PT409', 'cannot complete twice');
select public.fail_asset_upload(tests.v('art3'), 'object missing');
select tests.ok((select upload_status from public.assets where id = tests.v('art3')) = 'failed', 'incomplete upload marked failed, not ready');
select tests.throws($$update public.assets set upload_status = 'ready' where id = tests.v('art3')$$, '22023', 'failed upload cannot be revived');
:as_dir
select tests.put('art4', (select asset_id from public.begin_asset_upload(tests.v('mira'), 'late.png', 'image/png', 500)));
:as_owner
alter table public.assets disable trigger assets_guard;
update public.assets set upload_expires_at = now() - interval '1 minute' where id = tests.v('art4');
alter table public.assets enable trigger assets_guard;
:as_service
select public.complete_asset_upload(tests.v('art4'), 500, repeat('e', 64), 'image/png');
select tests.ok((select upload_status from public.assets where id = tests.v('art4')) = 'failed', 'expired upload is failed on completion');

-- ---------------------------------------------------------------------------
-- Anonymous access
-- ---------------------------------------------------------------------------
:as_anon
select tests.throws($$select * from public.projects$$, '42501', 'anon cannot read tables');
select tests.throws($$select public.create_project('x')$$, '42501', 'anon cannot call RPCs');

-- ---------------------------------------------------------------------------
-- Trusted project deletion still works (cascades are not blocked by guards)
-- ---------------------------------------------------------------------------
:as_service
select tests.lives($$delete from public.projects where id = tests.v('B')$$, 'service role can hard-delete a project (cascade)');

-- ---------------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------------
:as_owner
select n, case when passed then 'PASS' else 'FAIL' end as result, label, detail from tests.results order by n;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from tests.results;
do $$ begin
  if exists (select 1 from tests.results where not passed) then
    raise exception 'Security test suite FAILED';
  end if;
end $$;
