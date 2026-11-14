-- STUDIO — Milestone 1 corrective hardening
-- Applies on top of 20261114000001_foundation_baseline.sql (the supplied 0001, unchanged).
--
-- What this migration does (see docs/architecture.md and docs/permissions.md):
--   1. Separates technical access (view/review/edit/commit) from administration,
--      creative-approval authority and spending authority.
--   2. Enforces same-project and same-entity reference integrity with composite FKs.
--   3. Enforces immutability of creative history, ready originals and audit events.
--   4. Enables RLS on every public table, read-only for clients; all writes go through
--      SECURITY DEFINER functions that derive the actor from auth.uid().
--   5. Implements atomic approve-as-canonical with stale-base conflict detection.
--   6. Implements trusted upload completion (service role only).
--
-- The README references 0002_access_control.sql, which was never supplied. This migration
-- does not assume it exists: it drops every existing policy on public tables and replaces
-- them. If 0002 was applied somewhere, reconcile that environment before pushing.

begin;

-- -----------------------------------------------------------------------------
-- 1. Effective capabilities
-- -----------------------------------------------------------------------------
alter table public.project_members
  add column if not exists can_admin boolean not null default false,
  add column if not exists can_approve_creative boolean not null default false,
  add column if not exists can_authorize_spend boolean not null default false;

alter table public.project_invitations
  add column if not exists can_admin boolean not null default false,
  add column if not exists can_approve_creative boolean not null default false,
  add column if not exists can_authorize_spend boolean not null default false;

-- Legacy 'admin' access_level conflated administration with creative commit.
-- Convert conservatively: keep administration, grant NO creative capability beyond View.
-- Any affected rows must be reviewed by a person and upgraded explicitly.
update public.project_members  set can_admin = true, access_level = 'view' where access_level = 'admin';
update public.project_invitations set can_admin = true, access_level = 'view' where access_level = 'admin';

alter table public.project_members
  drop constraint if exists project_members_no_admin_level,
  add constraint project_members_no_admin_level check (access_level <> 'admin'),
  drop constraint if exists project_members_creative_approval_role,
  add constraint project_members_creative_approval_role
    check (not can_approve_creative or project_role = 'director'),
  drop constraint if exists project_members_spend_role,
  add constraint project_members_spend_role
    check (not can_authorize_spend or project_role = 'executive_producer');

alter table public.project_invitations
  drop constraint if exists project_invitations_no_admin_level,
  add constraint project_invitations_no_admin_level check (access_level <> 'admin'),
  drop constraint if exists project_invitations_creative_approval_role,
  add constraint project_invitations_creative_approval_role
    check (not can_approve_creative or project_role = 'director'),
  drop constraint if exists project_invitations_spend_role,
  add constraint project_invitations_spend_role
    check (not can_authorize_spend or project_role = 'executive_producer');

-- The baseline trigger silently made every creator director + admin. Creator grants are
-- now explicit inside create_project().
drop trigger if exists projects_bootstrap_creator on public.projects;

-- -----------------------------------------------------------------------------
-- 2. New columns and tables needed by milestone 1
-- -----------------------------------------------------------------------------
-- The canonical version the author was looking at when they wrote this revision.
alter table public.versions add column if not exists base_version_id uuid;

alter table public.assets
  add column if not exists upload_status text not null default 'pending',
  add column if not exists upload_expires_at timestamptz,
  add column if not exists completed_at timestamptz;
alter table public.assets
  drop constraint if exists assets_upload_status_check,
  add constraint assets_upload_status_check check (upload_status in ('pending', 'ready', 'failed'));
-- Existing asset rows (if any) start as 'pending' and stay invisible until re-verified.

alter table public.research_references add column if not exists project_id uuid;
update public.research_references r set project_id = b.project_id
  from public.research_boards b where b.id = r.board_id and r.project_id is null;
alter table public.research_references alter column project_id set not null;

alter table public.change_set_items add column if not exists project_id uuid;
update public.change_set_items i set project_id = c.project_id
  from public.change_sets c where c.id = i.change_set_id and i.project_id is null;
alter table public.change_set_items alter column project_id set not null;

-- Artwork attached to a specific revision. Immutable once written.
create table if not exists public.version_assets (
  project_id uuid not null,
  version_id uuid not null,
  asset_id uuid not null,
  position integer not null default 0 check (position >= 0),
  primary key (version_id, asset_id)
);
create index if not exists version_assets_asset_idx on public.version_assets (asset_id);

-- -----------------------------------------------------------------------------
-- 3. Same-project / same-entity integrity (composite keys + composite FKs)
-- -----------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select * from (values
    ('entities',        'entities_project_id_id_key',        '(project_id, id)'),
    ('branches',        'branches_project_id_id_key',        '(project_id, id)'),
    ('assets',          'assets_project_id_id_key',          '(project_id, id)'),
    ('versions',        'versions_project_id_id_key',        '(project_id, id)'),
    ('versions',        'versions_entity_id_id_key',         '(entity_id, id)'),
    ('research_boards', 'research_boards_project_id_id_key', '(project_id, id)'),
    ('change_sets',     'change_sets_project_id_id_key',     '(project_id, id)')
  ) as t(tbl, name, cols) loop
    if not exists (select 1 from pg_constraint where conname = r.name) then
      execute format('alter table public.%I add constraint %I unique %s', r.tbl, r.name, r.cols);
    end if;
  end loop;
end $$;

-- The baseline's single-column `on delete set null` FKs would silently rewrite version
-- lineage and content links. Composite NO ACTION FKs below replace them.
alter table public.versions drop constraint if exists versions_parent_version_id_fkey;
alter table public.versions drop constraint if exists versions_content_asset_id_fkey;

do $$
declare r record;
begin
  for r in select * from (values
    ('entity_relationships', 'er_source_same_project', '(project_id, source_entity_id)', 'entities(project_id, id)', 'on delete cascade'),
    ('entity_relationships', 'er_target_same_project', '(project_id, target_entity_id)', 'entities(project_id, id)', 'on delete cascade'),
    ('versions', 'versions_entity_same_project',  '(project_id, entity_id)',        'entities(project_id, id)', 'on delete cascade'),
    ('versions', 'versions_branch_same_project',  '(project_id, branch_id)',        'branches(project_id, id)', ''),
    ('versions', 'versions_content_asset_same_project', '(project_id, content_asset_id)', 'assets(project_id, id)', ''),
    ('versions', 'versions_parent_same_entity',   '(entity_id, parent_version_id)', 'versions(entity_id, id)',  ''),
    ('versions', 'versions_base_same_entity',     '(entity_id, base_version_id)',   'versions(entity_id, id)',  ''),
    ('entities', 'entities_current_version_same_entity', '(id, current_version_id)', 'versions(entity_id, id)', ''),
    ('assets',    'assets_entity_same_project',    '(project_id, entity_id)', 'entities(project_id, id)', ''),
    ('documents', 'documents_entity_same_project', '(project_id, entity_id)', 'entities(project_id, id)', ''),
    ('research_boards', 'research_boards_entity_same_project', '(project_id, entity_id)', 'entities(project_id, id)', ''),
    ('research_references', 'research_references_board_same_project', '(project_id, board_id)', 'research_boards(project_id, id)', 'on delete cascade'),
    ('research_references', 'research_references_preview_same_project', '(project_id, preview_asset_id)', 'assets(project_id, id)', ''),
    ('project_imports', 'project_imports_asset_same_project', '(project_id, imported_asset_id)', 'assets(project_id, id)', ''),
    ('change_sets', 'change_sets_branch_same_project', '(project_id, branch_id)', 'branches(project_id, id)', ''),
    ('change_set_items', 'csi_change_set_same_project', '(project_id, change_set_id)', 'change_sets(project_id, id)', 'on delete cascade'),
    ('change_set_items', 'csi_entity_same_project',     '(project_id, entity_id)',     'entities(project_id, id)', 'on delete cascade'),
    ('change_set_items', 'csi_proposed_same_entity',    '(entity_id, proposed_version_id)', 'versions(entity_id, id)', ''),
    ('change_set_items', 'csi_base_same_entity',        '(entity_id, base_version_id)',     'versions(entity_id, id)', ''),
    ('reviews', 'reviews_entity_same_project',     '(project_id, entity_id)',     'entities(project_id, id)', 'on delete cascade'),
    ('reviews', 'reviews_version_same_project',    '(project_id, version_id)',    'versions(project_id, id)', 'on delete cascade'),
    ('reviews', 'reviews_change_set_same_project', '(project_id, change_set_id)', 'change_sets(project_id, id)', 'on delete cascade'),
    ('creative_decisions', 'creative_decisions_entity_same_project', '(project_id, entity_id)', 'entities(project_id, id)', ''),
    ('version_assets', 'version_assets_version_same_project', '(project_id, version_id)', 'versions(project_id, id)', 'on delete cascade'),
    ('version_assets', 'version_assets_asset_same_project',   '(project_id, asset_id)',   'assets(project_id, id)', 'on delete cascade'),
    ('version_assets', 'version_assets_project_fk',           '(project_id)',             'projects(id)', 'on delete cascade')
  ) as t(tbl, name, cols, ref, action) loop
    if not exists (select 1 from pg_constraint where conname = r.name) then
      execute format('alter table public.%I add constraint %I foreign key %s references public.%s %s',
                     r.tbl, r.name, r.cols, r.ref, r.action);
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Identity helpers
-- -----------------------------------------------------------------------------
-- True when the statement is running directly as an API client role, i.e. not inside a
-- SECURITY DEFINER function (which runs as its owner) and not as service_role.
create or replace function public.studio_is_client_role()
returns boolean language sql stable set search_path = '' as $$
  select current_user in ('anon', 'authenticated')
$$;

create or replace function public.studio_level_rank(p public.access_level)
returns integer language sql immutable set search_path = '' as $$
  select case p when 'view' then 1 when 'review' then 2 when 'edit' then 3 when 'commit' then 4 else 0 end
$$;

-- Accepted membership of the calling user, or no row.
create or replace function public.studio_my_membership(p_project uuid)
returns public.project_members
language sql stable security definer set search_path = '' as $$
  select m.* from public.project_members m
  join public.projects p on p.id = m.project_id
  where m.project_id = p_project
    and m.user_id = auth.uid()
    and m.accepted_at is not null
    and p.status <> 'deleted'
$$;

-- Creative access rank of the caller in a project (0 = no access).
create or replace function public.studio_level(p_project uuid)
returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select public.studio_level_rank(m.access_level)
                   from public.studio_my_membership(p_project) m), 0)
$$;

create or replace function public.studio_is_admin(p_project uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select m.can_admin from public.studio_my_membership(p_project) m), false)
$$;

-- Is this version the canonical (current) version of its entity?
create or replace function public.studio_is_canonical(p_version uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.entities e where e.current_version_id = p_version)
$$;

-- Effective capabilities for the UI. Display only; every write re-checks in the database.
create or replace function public.my_project_capabilities(p_project uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m public.project_members; r integer;
begin
  select * into m from public.studio_my_membership(p_project);
  if m.user_id is null then
    return jsonb_build_object('member', false);
  end if;
  r := public.studio_level_rank(m.access_level);
  return jsonb_build_object(
    'member', true,
    'project_role', m.project_role,
    'access_level', m.access_level,
    'can_view', r >= 1,
    'can_review', r >= 2,
    'can_edit', r >= 3,
    'can_commit', r >= 4,
    'can_admin', m.can_admin,
    'can_approve_creative', m.can_approve_creative,
    'can_authorize_spend', m.can_authorize_spend,
    'can_approve_canonical', r >= 4 and m.can_approve_creative
  );
end $$;

-- Raise unless the caller has at least p_min rank. Returns the caller's user id.
create or replace function public.studio_require(p_project uuid, p_min integer, p_action text)
returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;
  if public.studio_level(p_project) = 0 then
    -- Same message for "missing" and "not yours" so project ids cannot be probed.
    raise exception 'Project not found.' using errcode = 'PT404';
  end if;
  if public.studio_level(p_project) < p_min then
    raise exception 'Your access level does not allow you to %.', p_action using errcode = '42501';
  end if;
  return v_uid;
end $$;

-- Internal audit writer. Not executable by clients.
create or replace function public.studio_audit(
  p_project uuid, p_actor uuid, p_actor_type text, p_event text,
  p_target_type text, p_target uuid, p_payload jsonb default '{}'::jsonb)
returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_events (project_id, actor_user_id, actor_type, event_type, target_type, target_id, event_payload)
  values (p_project, p_actor, p_actor_type, p_event, p_target_type, p_target, coalesce(p_payload, '{}'::jsonb))
$$;

-- -----------------------------------------------------------------------------
-- 5. Immutability and protected-field triggers
-- -----------------------------------------------------------------------------
create or replace function public.studio_guard_versions()
returns trigger language plpgsql set search_path = '' as $$
begin
  if public.studio_is_client_role() then
    raise exception 'Creative versions cannot be changed directly.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  -- Content and lineage are immutable for everyone, including trusted functions.
  if (new.id, new.project_id, new.entity_id, new.branch_id, new.version_number,
      new.content, new.content_asset_id, new.change_summary, new.created_by, new.created_at,
      new.base_version_id)
     is distinct from
     (old.id, old.project_id, old.entity_id, old.branch_id, old.version_number,
      old.content, old.content_asset_id, old.change_summary, old.created_by, old.created_at,
      old.base_version_id)
  then
    raise exception 'Historical creative content is immutable.' using errcode = '42501';
  end if;
  if new.parent_version_id is distinct from old.parent_version_id then
    raise exception 'Version lineage is immutable.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and not (
       (old.status in ('working', 'submitted') and new.status in ('approved', 'rejected', 'superseded'))
    or (old.status = 'approved' and new.status = 'superseded'))
  then
    raise exception 'Invalid version status change % -> %.', old.status, new.status using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists versions_guard on public.versions;
create trigger versions_guard before update or delete on public.versions
  for each row execute function public.studio_guard_versions();

create or replace function public.studio_guard_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    raise exception '% is append-only.', tg_table_name using errcode = '42501';
  end if;
  if public.studio_is_client_role() then
    raise exception '% rows cannot be deleted by clients.', tg_table_name using errcode = '42501';
  end if;
  return old;
end $$;
drop trigger if exists audit_events_append_only on public.audit_events;
create trigger audit_events_append_only before update or delete on public.audit_events
  for each row execute function public.studio_guard_append_only();
drop trigger if exists version_assets_append_only on public.version_assets;
create trigger version_assets_append_only before update or delete on public.version_assets
  for each row execute function public.studio_guard_append_only();

create or replace function public.studio_guard_assets()
returns trigger language plpgsql set search_path = '' as $$
begin
  if public.studio_is_client_role() then
    raise exception 'Assets cannot be changed directly.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if (new.id, new.project_id, new.storage_provider, new.storage_bucket, new.storage_key,
      new.kind, new.origin, new.is_immutable_original, new.created_by, new.created_at)
     is distinct from
     (old.id, old.project_id, old.storage_provider, old.storage_bucket, old.storage_key,
      old.kind, old.origin, old.is_immutable_original, old.created_by, old.created_at)
  then
    raise exception 'Asset identity and storage location are immutable.' using errcode = '42501';
  end if;
  if old.upload_status = 'ready' and (
       new.upload_status is distinct from old.upload_status
    or (new.byte_size, new.checksum_sha256, new.mime_type, new.file_extension, new.entity_id)
       is distinct from (old.byte_size, old.checksum_sha256, old.mime_type, old.file_extension, old.entity_id))
  then
    raise exception 'A completed original cannot be modified.' using errcode = '42501';
  end if;
  if old.upload_status = 'failed' and new.upload_status is distinct from 'failed' then
    raise exception 'A failed upload cannot be revived; start a new upload.' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists assets_guard on public.assets;
create trigger assets_guard before update or delete on public.assets
  for each row execute function public.studio_guard_assets();

create or replace function public.studio_guard_entities()
returns trigger language plpgsql set search_path = '' as $$
begin
  if public.studio_is_client_role() then
    raise exception 'Entities cannot be changed directly.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.id, new.project_id, new.kind, new.created_by, new.created_at)
       is distinct from (old.id, old.project_id, old.kind, old.created_by, old.created_at) then
    raise exception 'Entity identity is immutable.' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists entities_guard on public.entities;
create trigger entities_guard before update or delete on public.entities
  for each row execute function public.studio_guard_entities();

create or replace function public.studio_guard_approvals()
returns trigger language plpgsql set search_path = '' as $$
begin
  if public.studio_is_client_role() then
    raise exception 'Approvals cannot be changed directly.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.status <> 'pending' then
    raise exception 'A decided approval is immutable.' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists approvals_guard on public.approvals;
create trigger approvals_guard before update or delete on public.approvals
  for each row execute function public.studio_guard_approvals();

-- -----------------------------------------------------------------------------
-- 6. Content validation (deterministic, per entity kind)
-- -----------------------------------------------------------------------------
create or replace function public.studio_validate_content(p_kind public.entity_kind, p_content jsonb)
returns void language plpgsql immutable set search_path = '' as $$
declare k text; allowed text[]; limit_chars integer;
begin
  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    raise exception 'Revision content must be an object.' using errcode = '22023';
  end if;
  if p_kind in ('story', 'treatment') then
    allowed := array['body']; limit_chars := 200000;
  elsif p_kind in ('character', 'location') then
    allowed := array['summary', 'notes']; limit_chars := 50000;
  else
    raise exception 'Revisions for % are not available yet.', p_kind using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_content) loop
    if not k = any(allowed) then
      raise exception 'Unknown field "%" for a %.', k, p_kind using errcode = '22023';
    end if;
    if jsonb_typeof(p_content -> k) <> 'string' then
      raise exception 'Field "%" must be text.', k using errcode = '22023';
    end if;
    if length(p_content ->> k) > limit_chars then
      raise exception 'Field "%" is longer than % characters.', k, limit_chars using errcode = '22023';
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 7. Trusted operations (the only client write path)
-- -----------------------------------------------------------------------------
create or replace function public.create_project(p_name text, p_description text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_org uuid; v_project uuid; v_story uuid; v_name text := btrim(p_name);
begin
  if v_uid is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;
  if v_name is null or length(v_name) = 0 or length(v_name) > 120 then
    raise exception 'Project name must be 1–120 characters.' using errcode = '22023';
  end if;
  if p_description is not null and length(p_description) > 2000 then
    raise exception 'Description must be 2000 characters or fewer.' using errcode = '22023';
  end if;

  -- Personal workspace organization; created once per user.
  select o.id into v_org from public.organizations o
    join public.organization_members om on om.organization_id = o.id
   where om.user_id = v_uid and om.organization_role = 'owner' and o.created_by = v_uid
   order by o.created_at limit 1;
  if v_org is null then
    insert into public.organizations (name, created_by) values ('Personal studio', v_uid) returning id into v_org;
  end if;

  insert into public.projects (organization_id, name, description, created_by)
  values (v_org, v_name, nullif(btrim(p_description), ''), v_uid) returning id into v_project;

  insert into public.branches (project_id, name, is_main, created_by) values (v_project, 'main', true, v_uid);

  -- Explicit creator grant: administration AND creative authority, as separate flags.
  insert into public.project_members
    (project_id, user_id, project_role, access_level, can_admin, can_approve_creative, accepted_at)
  values (v_project, v_uid, 'director', 'commit', true, true, now());

  insert into public.entities (project_id, kind, name, module_key, created_by)
  values (v_project, 'story', 'Story', 'write', v_uid) returning id into v_story;

  perform public.studio_audit(v_project, v_uid, 'user', 'project.created', 'project', v_project,
    jsonb_build_object('creator_grants', jsonb_build_array('commit', 'admin', 'creative_approval')));
  return v_project;
end $$;

create or replace function public.create_entity(
  p_project uuid, p_kind public.entity_kind, p_name text,
  p_content jsonb default null, p_change_summary text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_entity uuid; v_branch uuid; v_name text := btrim(p_name);
begin
  v_uid := public.studio_require(p_project, 3, 'create characters or locations');
  if p_kind not in ('character', 'location', 'story') then
    raise exception 'Only stories, characters and locations can be created right now.' using errcode = '22023';
  end if;
  if v_name is null or length(v_name) = 0 or length(v_name) > 120 then
    raise exception 'Name must be 1–120 characters.' using errcode = '22023';
  end if;
  if p_content is not null then
    perform public.studio_validate_content(p_kind, p_content);
  end if;

  insert into public.entities (project_id, kind, name, module_key, created_by)
  values (p_project, p_kind, v_name, case when p_kind = 'story' then 'write' else 'develop' end, v_uid)
  returning id into v_entity;

  if p_content is not null then
    select id into strict v_branch from public.branches where project_id = p_project and is_main;
    insert into public.versions (project_id, entity_id, branch_id, version_number, status, content, change_summary, created_by)
    values (p_project, v_entity, v_branch, 1, 'submitted', p_content, coalesce(p_change_summary, 'First draft'), v_uid);
  end if;

  perform public.studio_audit(p_project, v_uid, 'user', 'entity.created', 'entity', v_entity,
    jsonb_build_object('kind', p_kind, 'name', v_name));
  return v_entity;
end $$;

create or replace function public.rename_entity(p_entity uuid, p_name text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_project uuid; v_old text; v_name text := btrim(p_name);
begin
  select project_id, name into v_project, v_old from public.entities where id = p_entity;
  v_uid := public.studio_require(v_project, 3, 'rename items');
  if v_name is null or length(v_name) = 0 or length(v_name) > 120 then
    raise exception 'Name must be 1–120 characters.' using errcode = '22023';
  end if;
  update public.entities set name = v_name where id = p_entity;
  perform public.studio_audit(v_project, v_uid, 'user', 'entity.renamed', 'entity', p_entity,
    jsonb_build_object('from', v_old, 'to', v_name));
end $$;

-- Save a new revision. Never approves. p_base_version is the canonical version the author
-- was looking at; approval is rejected later if the canonical version has moved on.
create or replace function public.create_revision(
  p_entity uuid, p_content jsonb, p_change_summary text default null,
  p_parent_version uuid default null, p_base_version uuid default null,
  p_asset_ids uuid[] default '{}', p_status public.version_status default 'submitted')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid; e public.entities; v_branch uuid; v_number integer; v_version uuid; v_asset uuid; i integer := 0;
begin
  select * into e from public.entities where id = p_entity;
  v_uid := public.studio_require(e.project_id, 3, 'save revisions');
  perform 1 from public.entities where id = p_entity for update; -- serialize version numbering

  if p_status not in ('working', 'submitted') then
    raise exception 'New revisions start as a draft or a proposal.' using errcode = '22023';
  end if;
  perform public.studio_validate_content(e.kind, p_content);
  if p_change_summary is not null and length(p_change_summary) > 500 then
    raise exception 'Change note must be 500 characters or fewer.' using errcode = '22023';
  end if;
  if p_parent_version is not null and not exists
     (select 1 from public.versions where id = p_parent_version and entity_id = p_entity) then
    raise exception 'The previous revision does not belong to this item.' using errcode = '22023';
  end if;
  if p_base_version is not null and not exists
     (select 1 from public.versions where id = p_base_version and entity_id = p_entity) then
    raise exception 'The base version does not belong to this item.' using errcode = '22023';
  end if;

  select id into strict v_branch from public.branches where project_id = e.project_id and is_main;
  select coalesce(max(version_number), 0) + 1 into v_number from public.versions where entity_id = p_entity;

  insert into public.versions (project_id, entity_id, branch_id, parent_version_id, base_version_id,
                               version_number, status, content, change_summary, created_by)
  values (e.project_id, p_entity, v_branch, p_parent_version, p_base_version,
          v_number, p_status, p_content, nullif(btrim(p_change_summary), ''), v_uid)
  returning id into v_version;

  foreach v_asset in array coalesce(p_asset_ids, '{}') loop
    if not exists (select 1 from public.assets a
                    where a.id = v_asset and a.project_id = e.project_id and a.entity_id = p_entity
                      and a.upload_status = 'ready' and a.deleted_at is null) then
      raise exception 'Artwork % is not a finished upload for this item.', v_asset using errcode = '22023';
    end if;
    insert into public.version_assets (project_id, version_id, asset_id, position)
    values (e.project_id, v_version, v_asset, i);
    i := i + 1;
  end loop;

  perform public.studio_audit(e.project_id, v_uid, 'user', 'version.created', 'version', v_version,
    jsonb_build_object('entity_id', p_entity, 'version_number', v_number, 'status', p_status,
                       'base_version_id', p_base_version, 'artwork_count', i));
  return v_version;
end $$;

-- Atomic approve-as-canonical. Requires Commit access AND Director creative-approval authority.
-- p_expected_current: what the approver saw as canonical (null if nothing approved yet).
create or replace function public.approve_revision(p_version uuid, p_expected_current uuid default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid; v public.versions; e public.entities; m public.project_members; v_base_no integer; v_cur_no integer;
begin
  select * into v from public.versions where id = p_version;
  v_uid := public.studio_require(v.project_id, 1, 'view this project');
  select * into m from public.studio_my_membership(v.project_id);
  if public.studio_level_rank(m.access_level) < 4 or not m.can_approve_creative then
    raise exception 'Approving a canonical version needs Commit access and Director approval authority.'
      using errcode = '42501';
  end if;

  select * into e from public.entities where id = v.entity_id for update;  -- serialize approvals

  if e.current_version_id is not distinct from p_version then
    raise exception 'This revision is already the approved version.' using errcode = 'PT409';
  end if;
  if e.current_version_id is distinct from p_expected_current then
    raise exception 'The approved version changed while you were looking. Reload to see the latest.'
      using errcode = 'PT409';
  end if;
  if v.status not in ('working', 'submitted') then
    raise exception 'Only draft or proposed revisions can be approved (this one is %).', v.status
      using errcode = '22023';
  end if;
  if v.base_version_id is distinct from e.current_version_id then
    select version_number into v_base_no from public.versions where id = v.base_version_id;
    select version_number into v_cur_no  from public.versions where id = e.current_version_id;
    raise exception 'Revision % was written against %, but % is now approved. Save a new revision from the current version first.',
      v.version_number,
      coalesce('version ' || v_base_no, 'no approved version'),
      'version ' || v_cur_no
      using errcode = 'PT409';
  end if;

  if e.current_version_id is not null then
    update public.versions set status = 'superseded' where id = e.current_version_id;
  end if;
  update public.versions set status = 'approved' where id = p_version;
  update public.entities set current_version_id = p_version, status = 'approved' where id = e.id;

  insert into public.approvals (project_id, approval_type, target_type, target_id, requested_by,
                                approver_id, status, decided_at, request_payload)
  values (v.project_id, 'creative', 'version', p_version, v.created_by, v_uid, 'approved', now(),
          jsonb_build_object('entity_id', e.id, 'previous_version_id', e.current_version_id));

  perform public.studio_audit(v.project_id, v_uid, 'user', 'version.approved', 'version', p_version,
    jsonb_build_object('entity_id', e.id, 'version_number', v.version_number,
                       'previous_version_id', e.current_version_id));
  return jsonb_build_object('entity_id', e.id, 'version_id', p_version, 'version_number', v.version_number);
end $$;

create or replace function public.link_entities(p_source uuid, p_target uuid, p_type text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; s public.entities; t public.entities; v_id uuid;
begin
  select * into s from public.entities where id = p_source;
  select * into t from public.entities where id = p_target;
  v_uid := public.studio_require(s.project_id, 3, 'link items');
  if t.id is null or t.project_id <> s.project_id then
    raise exception 'Both items must belong to the same project.' using errcode = '22023';
  end if;
  if p_type not in ('appears_in', 'set_in', 'related_to') then
    raise exception 'Unknown link type.' using errcode = '22023';
  end if;
  insert into public.entity_relationships (project_id, source_entity_id, target_entity_id, relationship_type, created_by)
  values (s.project_id, p_source, p_target, p_type, v_uid)
  on conflict (source_entity_id, target_entity_id, relationship_type) do nothing
  returning id into v_id;
  if v_id is not null then
    perform public.studio_audit(s.project_id, v_uid, 'user', 'relationship.created', 'entity_relationship', v_id,
      jsonb_build_object('source', p_source, 'target', p_target, 'type', p_type));
  end if;
  return v_id;
end $$;

create or replace function public.unlink_entities(p_relationship uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; r public.entity_relationships;
begin
  select * into r from public.entity_relationships where id = p_relationship;
  v_uid := public.studio_require(r.project_id, 3, 'unlink items');
  delete from public.entity_relationships where id = p_relationship;
  perform public.studio_audit(r.project_id, v_uid, 'user', 'relationship.removed', 'entity_relationship', p_relationship,
    to_jsonb(r) - 'metadata');
end $$;

create or replace function public.add_reference(
  p_entity uuid, p_url text, p_title text default null, p_attribution text default null,
  p_notes text default null, p_rights_status text default 'unknown')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; e public.entities; v_board uuid; v_id uuid; v_url text := btrim(p_url);
begin
  select * into e from public.entities where id = p_entity;
  v_uid := public.studio_require(e.project_id, 3, 'add references');
  if v_url is null or v_url !~* '^https?://[^\s/]+' or length(v_url) > 2000 then
    raise exception 'Enter a full web address starting with http:// or https://.' using errcode = '22023';
  end if;
  if p_attribution is null or length(btrim(p_attribution)) = 0 then
    raise exception 'Say who made this reference (attribution).' using errcode = '22023';
  end if;
  if length(coalesce(p_title, '')) > 300 or length(p_attribution) > 500 or length(coalesce(p_notes, '')) > 5000 then
    raise exception 'Title, attribution or notes are too long.' using errcode = '22023';
  end if;

  select id into v_board from public.research_boards where project_id = e.project_id and entity_id = p_entity
   order by created_at limit 1;
  if v_board is null then
    insert into public.research_boards (project_id, entity_id, title, created_by)
    values (e.project_id, p_entity, 'References', v_uid) returning id into v_board;
  end if;

  insert into public.research_references (project_id, board_id, title, source_url, source_domain,
                                          attribution, rights_status, observations, added_by)
  values (e.project_id, v_board, nullif(btrim(p_title), ''), v_url,
          lower(substring(v_url from '^https?://([^/:?#]+)')),
          btrim(p_attribution), p_rights_status, nullif(btrim(p_notes), ''), v_uid)
  returning id into v_id;
  perform public.studio_audit(e.project_id, v_uid, 'user', 'reference.added', 'research_reference', v_id,
    jsonb_build_object('entity_id', p_entity, 'url', v_url));
  return v_id;
end $$;

create or replace function public.add_review_comment(p_version uuid, p_comment text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v public.versions; v_id uuid;
begin
  select * into v from public.versions where id = p_version;
  v_uid := public.studio_require(v.project_id, 2, 'comment');
  if p_comment is null or length(btrim(p_comment)) = 0 or length(p_comment) > 5000 then
    raise exception 'Comment must be 1–5000 characters.' using errcode = '22023';
  end if;
  insert into public.reviews (project_id, entity_id, version_id, reviewer_id, status, comments)
  values (v.project_id, v.entity_id, p_version, v_uid, 'pending', btrim(p_comment)) returning id into v_id;
  perform public.studio_audit(v.project_id, v_uid, 'user', 'review.commented', 'review', v_id,
    jsonb_build_object('version_id', p_version));
  return v_id;
end $$;

-- Reserve an upload. The server generates the storage key; the client never chooses it.
create or replace function public.begin_asset_upload(
  p_entity uuid, p_file_name text, p_mime_type text, p_byte_size bigint)
returns table (asset_id uuid, storage_bucket text, storage_key text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid; e public.entities; v_id uuid := gen_random_uuid(); v_ext text; v_key text; v_exp timestamptz;
  v_bucket text := coalesce(nullif(current_setting('studio.storage_bucket', true), ''), 'studio-media');
  v_max bigint := 50 * 1024 * 1024;
  v_name text := left(regexp_replace(coalesce(btrim(p_file_name), ''), '[^A-Za-z0-9._ -]', '_', 'g'), 200);
begin
  select * into e from public.entities where id = p_entity;
  v_uid := public.studio_require(e.project_id, 3, 'upload artwork');
  v_ext := case p_mime_type when 'image/png' then 'png' when 'image/jpeg' then 'jpg' end;
  if v_ext is null then
    raise exception 'Artwork must be a PNG or JPEG export.' using errcode = '22023';
  end if;
  if p_byte_size is null or p_byte_size <= 0 or p_byte_size > v_max then
    raise exception 'Artwork must be between 1 byte and 50 MB.' using errcode = '22023';
  end if;
  v_key := format('projects/%s/entities/%s/assets/%s/original.%s', e.project_id, e.id, v_id, v_ext);
  v_exp := now() + interval '15 minutes';

  insert into public.assets (id, project_id, entity_id, kind, origin, display_name, mime_type, file_extension,
                             storage_bucket, storage_key, is_immutable_original, created_by,
                             upload_status, upload_expires_at, metadata)
  values (v_id, e.project_id, e.id, 'image', 'upload', coalesce(nullif(v_name, ''), 'artwork.' || v_ext),
          p_mime_type, v_ext, v_bucket, v_key, true, v_uid, 'pending', v_exp,
          jsonb_build_object('declared_byte_size', p_byte_size));
  perform public.studio_audit(e.project_id, v_uid, 'user', 'asset.upload_started', 'asset', v_id,
    jsonb_build_object('entity_id', e.id, 'mime_type', p_mime_type, 'declared_byte_size', p_byte_size));
  return query select v_id, v_bucket, v_key, v_exp;
end $$;

-- SERVICE ROLE ONLY. Called after the server has verified the stored object itself
-- (size, content type, signature bytes, checksum).
create or replace function public.complete_asset_upload(
  p_asset uuid, p_byte_size bigint, p_checksum_sha256 text, p_mime_type text)
returns void
language plpgsql security definer set search_path = '' as $$
declare a public.assets;
begin
  select * into a from public.assets where id = p_asset for update;
  if a.id is null then
    raise exception 'Upload not found.' using errcode = 'PT404';
  end if;
  if a.upload_status <> 'pending' then
    raise exception 'Upload is already %.', a.upload_status using errcode = 'PT409';
  end if;
  if a.upload_expires_at < now() then
    update public.assets set upload_status = 'failed', metadata = metadata || '{"failure":"expired"}' where id = p_asset;
    perform public.studio_audit(a.project_id, a.created_by, 'system', 'asset.upload_expired', 'asset', p_asset, '{}');
    return;
  end if;
  if p_mime_type is distinct from a.mime_type
     or p_byte_size is distinct from (a.metadata ->> 'declared_byte_size')::bigint
     or p_checksum_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Uploaded object does not match the reserved upload.' using errcode = '22023';
  end if;
  update public.assets set upload_status = 'ready', byte_size = p_byte_size, checksum_sha256 = p_checksum_sha256,
         completed_at = now() where id = p_asset;
  perform public.studio_audit(a.project_id, a.created_by, 'system', 'asset.upload_completed', 'asset', p_asset,
    jsonb_build_object('byte_size', p_byte_size, 'checksum_sha256', p_checksum_sha256));
end $$;

-- SERVICE ROLE ONLY.
create or replace function public.fail_asset_upload(p_asset uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare a public.assets;
begin
  select * into a from public.assets where id = p_asset for update;
  if a.upload_status = 'pending' then
    update public.assets set upload_status = 'failed',
           metadata = metadata || jsonb_build_object('failure', left(coalesce(p_reason, 'unknown'), 200))
     where id = p_asset;
    perform public.studio_audit(a.project_id, a.created_by, 'system', 'asset.upload_failed', 'asset', p_asset,
      jsonb_build_object('reason', left(coalesce(p_reason, 'unknown'), 200)));
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 8. Row-level security: enabled everywhere, read-only policies for clients
-- -----------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' loop
    execute format('alter table public.%I enable row level security', r.relname);
  end loop;
end $$;

create policy projects_read on public.projects for select to authenticated
  using (public.studio_level(id) >= 1);
create policy members_read on public.project_members for select to authenticated
  using (public.studio_level(project_id) >= 1);
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid());
create policy branches_read on public.branches for select to authenticated
  using (public.studio_level(project_id) >= 1);

-- View: only items that have an approved version. Review and above: everything.
create policy entities_read on public.entities for select to authenticated
  using (public.studio_level(project_id) >= 2
     or (public.studio_level(project_id) >= 1 and current_version_id is not null));
create policy versions_read on public.versions for select to authenticated
  using (public.studio_level(project_id) >= 2
     or (public.studio_level(project_id) >= 1 and public.studio_is_canonical(id)));
create policy version_assets_read on public.version_assets for select to authenticated
  using (public.studio_level(project_id) >= 2
     or (public.studio_level(project_id) >= 1 and public.studio_is_canonical(version_id)));
-- Only completed uploads are ever readable. View sees artwork attached to approved versions.
create policy assets_read on public.assets for select to authenticated
  using (upload_status = 'ready' and deleted_at is null and (
         public.studio_level(project_id) >= 2
      or (public.studio_level(project_id) >= 1 and exists (
            select 1 from public.version_assets va
             where va.asset_id = assets.id and public.studio_is_canonical(va.version_id)))));
create policy relationships_read on public.entity_relationships for select to authenticated
  using (public.studio_level(project_id) >= 2
     or (public.studio_level(project_id) >= 1 and exists (
           select 1 from public.entities s, public.entities t
            where s.id = source_entity_id and t.id = target_entity_id
              and s.current_version_id is not null and t.current_version_id is not null)));
create policy research_boards_read on public.research_boards for select to authenticated
  using (public.studio_level(project_id) >= 2
     or (public.studio_level(project_id) >= 1 and exists (
           select 1 from public.entities e where e.id = entity_id and e.current_version_id is not null)));
create policy research_references_read on public.research_references for select to authenticated
  using (public.studio_level(project_id) >= 2
     or (public.studio_level(project_id) >= 1 and exists (
           select 1 from public.research_boards b join public.entities e on e.id = b.entity_id
            where b.id = board_id and e.current_version_id is not null)));
create policy approvals_read on public.approvals for select to authenticated
  using (public.studio_level(project_id) >= 2);
create policy reviews_read on public.reviews for select to authenticated
  using (public.studio_level(project_id) >= 2);
create policy audit_read on public.audit_events for select to authenticated
  using (public.studio_level(project_id) >= 2 or public.studio_is_admin(project_id));
-- All other tables (deferred features) have RLS enabled and no policy: deny by default.

-- -----------------------------------------------------------------------------
-- 9. Privileges. Done last so Supabase's default grants on new objects are overridden.
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke insert, update, delete, truncate, references, trigger on tables from authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.studio_is_client_role(),
  public.studio_level_rank(public.access_level),
  public.studio_my_membership(uuid),
  public.studio_level(uuid),
  public.studio_is_admin(uuid),
  public.studio_is_canonical(uuid),
  public.my_project_capabilities(uuid),
  public.create_project(text, text),
  public.create_entity(uuid, public.entity_kind, text, jsonb, text),
  public.rename_entity(uuid, text),
  public.create_revision(uuid, jsonb, text, uuid, uuid, uuid[], public.version_status),
  public.approve_revision(uuid, uuid),
  public.link_entities(uuid, uuid, text),
  public.unlink_entities(uuid),
  public.add_reference(uuid, text, text, text, text, text),
  public.add_review_comment(uuid, text),
  public.begin_asset_upload(uuid, text, text, bigint)
to authenticated;

grant execute on function
  public.complete_asset_upload(uuid, bigint, text, text),
  public.fail_asset_upload(uuid, text)
to service_role;

commit;
