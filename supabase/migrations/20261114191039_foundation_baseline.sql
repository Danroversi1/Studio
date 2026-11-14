-- STUDIO 0.1 — foundational schema
-- Target: Supabase PostgreSQL
-- Apply after creating a Supabase project. Supabase provides auth.users and auth.uid().
-- This migration intentionally establishes shared product primitives; module-specific
-- animation, editorial, scoring and lens-calibration tables are added in later migrations.

begin;

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Enumerated types
-- -----------------------------------------------------------------------------

do $$ begin
  create type public.project_status as enum ('active', 'archived', 'deleted');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.project_role as enum ('director', 'executive_producer', 'collaborator');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.access_level as enum ('view', 'review', 'edit', 'commit', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.entity_kind as enum (
    'story', 'treatment', 'screenplay', 'character', 'location', 'prop', 'costume',
    'sequence', 'scene', 'shot', 'storyboard', 'shot_blueprint', 'illustration',
    'animation_clip', 'camera_setup', 'lens_profile', 'editorial_sequence',
    'music_cue', 'audio_asset', 'research_board', 'document', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.entity_status as enum ('draft', 'proposed', 'in_review', 'approved', 'rejected', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.asset_kind as enum (
    'document', 'image', 'video', 'audio', 'project_file', 'font', 'reference', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.asset_origin as enum ('upload', 'import', 'generated', 'created_in_studio', 'external_reference');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.version_status as enum ('working', 'submitted', 'approved', 'rejected', 'superseded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.change_set_status as enum ('open', 'submitted', 'partially_accepted', 'accepted', 'rejected', 'withdrawn');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.review_status as enum ('pending', 'approved', 'changes_requested', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.approval_type as enum ('creative', 'resource', 'access', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.agent_domain as enum (
    'writer', 'production_designer', 'scenic_designer', 'costume_designer',
    'props_designer', 'cinematography', 'music', 'editor', 'research', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.agent_run_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.compute_location as enum ('local', 'cloud');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.compute_job_status as enum ('queued', 'awaiting_approval', 'running', 'succeeded', 'failed', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.approval_status as enum ('pending', 'approved', 'rejected', 'cancelled');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Common updated_at trigger
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Identity, organizations and projects
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_role text not null default 'member' check (organization_role in ('owner', 'admin', 'member')),
  invited_by uuid references auth.users(id) on delete set null,
  joined_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null,
  description text,
  status public.project_status not null default 'active',
  created_by uuid not null references auth.users(id),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists projects_org_status_idx on public.projects (organization_id, status);

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_role public.project_role not null default 'collaborator',
  access_level public.access_level not null default 'view',
  invited_by uuid references auth.users(id) on delete set null,
  invitation_email text,
  invited_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, user_id),
  constraint project_member_invitation_check check (accepted_at is not null or invitation_email is not null or invited_at is null)
);
create index if not exists project_members_user_idx on public.project_members (user_id, project_id);

-- Invitations exist independently of auth.users so a person can be invited by email
-- before creating an account. Token hashes are stored; raw invitation tokens are not.
create table if not exists public.project_invitations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  invited_email text not null,
  project_role public.project_role not null default 'collaborator',
  access_level public.access_level not null default 'view',
  token_hash text not null unique,
  invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_user_id uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint project_invitation_email_nonempty check (length(trim(invited_email)) > 0)
);
create unique index if not exists one_pending_invitation_per_email
  on public.project_invitations (project_id, lower(invited_email))
  where accepted_at is null and revoked_at is null;

-- -----------------------------------------------------------------------------
-- Creative Project Graph
-- `entities` are stable identities; versions hold changing creative states.
-- Relationships connect entities across modules without duplicating assets.
-- -----------------------------------------------------------------------------
create table if not exists public.entities (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind public.entity_kind not null,
  name text not null,
  description text,
  status public.entity_status not null default 'draft',
  module_key text not null default 'develop',
  current_version_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists entities_project_kind_idx on public.entities (project_id, kind, status);
create index if not exists entities_project_module_idx on public.entities (project_id, module_key);

create table if not exists public.entity_relationships (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  source_entity_id uuid not null references public.entities(id) on delete cascade,
  target_entity_id uuid not null references public.entities(id) on delete cascade,
  relationship_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint entity_relationship_not_self check (source_entity_id <> target_entity_id),
  constraint entity_relationship_unique unique (source_entity_id, target_entity_id, relationship_type)
);
create index if not exists entity_relationships_source_idx on public.entity_relationships (source_entity_id);
create index if not exists entity_relationships_target_idx on public.entity_relationships (target_entity_id);

-- -----------------------------------------------------------------------------
-- Documents, intake and assets
-- Storage paths refer to private object storage (e.g. Cloudflare R2), not public URLs.
-- -----------------------------------------------------------------------------
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  entity_id uuid references public.entities(id) on delete set null,
  title text not null,
  document_type text not null default 'source_material',
  source_format text,
  source_uri text,
  extracted_text text,
  extraction_metadata jsonb not null default '{}'::jsonb,
  provenance jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists documents_project_idx on public.documents (project_id, created_at desc);

create table if not exists public.project_imports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  source_name text not null,
  source_type text not null,
  source_uri text,
  import_status text not null default 'received' check (import_status in ('received', 'processing', 'completed', 'failed')),
  imported_asset_id uuid,
  extracted_entities jsonb not null default '[]'::jsonb,
  error_message text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  entity_id uuid references public.entities(id) on delete set null,
  kind public.asset_kind not null,
  origin public.asset_origin not null,
  display_name text not null,
  mime_type text,
  file_extension text,
  storage_provider text not null default 'cloudflare_r2',
  storage_bucket text not null,
  storage_key text not null,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  checksum_sha256 text,
  source_uri text,
  provenance jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  is_immutable_original boolean not null default false,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint assets_storage_key_unique unique (storage_bucket, storage_key)
);
create index if not exists assets_project_kind_idx on public.assets (project_id, kind) where deleted_at is null;
create index if not exists assets_entity_idx on public.assets (entity_id) where entity_id is not null;

create table if not exists public.asset_versions (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  storage_bucket text not null,
  storage_key text not null,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  checksum_sha256 text,
  change_summary text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint asset_version_number_unique unique (asset_id, version_number),
  constraint asset_version_storage_unique unique (storage_bucket, storage_key)
);

-- -----------------------------------------------------------------------------
-- Creative versioning, branches, change sets, reviews and approvals
-- -----------------------------------------------------------------------------
create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  description text,
  is_main boolean not null default false,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint branch_name_unique unique (project_id, name)
);
create unique index if not exists one_main_branch_per_project on public.branches (project_id) where is_main = true;

create table if not exists public.versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete restrict,
  parent_version_id uuid references public.versions(id) on delete set null,
  version_number integer not null check (version_number > 0),
  status public.version_status not null default 'working',
  content jsonb not null default '{}'::jsonb,
  content_asset_id uuid references public.assets(id) on delete set null,
  change_summary text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint entity_branch_version_unique unique (entity_id, branch_id, version_number)
);
create index if not exists versions_entity_created_idx on public.versions (entity_id, created_at desc);

alter table public.entities
  drop constraint if exists entities_current_version_fk;
alter table public.entities
  add constraint entities_current_version_fk
  foreign key (current_version_id) references public.versions(id) on delete set null;

create table if not exists public.change_sets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  title text not null,
  description text,
  status public.change_set_status not null default 'open',
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.change_set_items (
  id uuid primary key default gen_random_uuid(),
  change_set_id uuid not null references public.change_sets(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  proposed_version_id uuid not null references public.versions(id) on delete restrict,
  base_version_id uuid references public.versions(id) on delete set null,
  item_status text not null default 'pending' check (item_status in ('pending', 'accepted', 'rejected')),
  reviewer_note text,
  created_at timestamptz not null default now(),
  constraint change_set_entity_unique unique (change_set_id, entity_id)
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  change_set_id uuid references public.change_sets(id) on delete cascade,
  entity_id uuid references public.entities(id) on delete cascade,
  version_id uuid references public.versions(id) on delete cascade,
  reviewer_id uuid not null references auth.users(id),
  status public.review_status not null default 'pending',
  comments text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint review_target_required check (change_set_id is not null or entity_id is not null or version_id is not null)
);

create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  approval_type public.approval_type not null,
  target_type text not null,
  target_id uuid not null,
  requested_by uuid not null references auth.users(id),
  approver_id uuid references auth.users(id),
  status public.approval_status not null default 'pending',
  request_payload jsonb not null default '{}'::jsonb,
  decision_note text,
  requested_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists approvals_project_status_idx on public.approvals (project_id, status, approval_type);

-- -----------------------------------------------------------------------------
-- Domain Leads, research boards and reference provenance
-- Agents propose; they do not approve, commit or authorize spend.
-- -----------------------------------------------------------------------------
create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  domain public.agent_domain not null,
  name text not null,
  description text,
  system_configuration jsonb not null default '{}'::jsonb,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists agents_project_domain_name_unique
  on public.agents (project_id, domain, name) where project_id is not null;

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  domain public.agent_domain not null,
  status public.agent_run_status not null default 'queued',
  task_type text not null,
  input_payload jsonb not null default '{}'::jsonb,
  output_payload jsonb,
  model_provider text,
  model_name text,
  prompt_version text,
  token_usage jsonb not null default '{}'::jsonb,
  resource_estimate_id uuid,
  requested_by uuid not null references auth.users(id),
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);
create index if not exists agent_runs_project_created_idx on public.agent_runs (project_id, created_at desc);

create table if not exists public.research_boards (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  entity_id uuid references public.entities(id) on delete set null,
  title text not null,
  domain public.agent_domain,
  description text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.research_references (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.research_boards(id) on delete cascade,
  title text,
  source_url text not null,
  source_domain text,
  media_type text,
  preview_asset_id uuid references public.assets(id) on delete set null,
  attribution text,
  rights_status text not null default 'unknown' check (rights_status in ('unknown', 'licensed', 'public_domain', 'permission_granted', 'restricted', 'not_for_reuse')),
  observations text,
  metadata jsonb not null default '{}'::jsonb,
  added_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists research_references_board_idx on public.research_references (board_id, created_at);

-- -----------------------------------------------------------------------------
-- Compute, resource accounting and production decisions
-- -----------------------------------------------------------------------------
create table if not exists public.compute_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_name text not null,
  platform text not null,
  app_version text,
  capabilities jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz,
  is_enabled boolean not null default true,
  registered_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists compute_devices_user_idx on public.compute_devices (user_id, is_enabled);

create table if not exists public.resource_estimates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  requested_by uuid not null references auth.users(id),
  operation_type text not null,
  execution_location public.compute_location,
  estimate jsonb not null default '{}'::jsonb,
  requires_approval boolean not null default false,
  approval_id uuid references public.approvals(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  requested_by uuid not null references auth.users(id),
  device_id uuid references public.compute_devices(id) on delete set null,
  resource_estimate_id uuid references public.resource_estimates(id) on delete set null,
  job_type text not null,
  status public.compute_job_status not null default 'queued',
  execution_policy text not null default 'hybrid_optimized' check (execution_policy in ('local_only', 'local_preferred', 'hybrid_optimized', 'cloud_permitted')),
  selected_location public.compute_location,
  provider text,
  model_name text,
  input_payload jsonb not null default '{}'::jsonb,
  output_payload jsonb,
  output_asset_id uuid references public.assets(id) on delete set null,
  estimated_cost numeric(12,4),
  actual_cost numeric(12,4),
  estimated_compute_seconds integer,
  actual_compute_seconds integer,
  approval_id uuid references public.approvals(id) on delete set null,
  idempotency_key text,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  constraint ai_jobs_project_idempotency_unique unique (project_id, idempotency_key)
);
create index if not exists ai_jobs_project_status_idx on public.ai_jobs (project_id, status, created_at desc);

create table if not exists public.resource_transactions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  job_id uuid references public.ai_jobs(id) on delete set null,
  transaction_type text not null check (transaction_type in ('estimate', 'charge', 'credit', 'adjustment')),
  resource_type text not null,
  quantity numeric(14,4),
  unit text,
  amount numeric(12,4),
  currency text not null default 'USD',
  provider text,
  metadata jsonb not null default '{}'::jsonb,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists resource_transactions_project_created_idx on public.resource_transactions (project_id, created_at desc);

create table if not exists public.creative_decisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  entity_id uuid references public.entities(id) on delete set null,
  decision_type text not null,
  title text not null,
  rationale text,
  decision_payload jsonb not null default '{}'::jsonb,
  creative_impact jsonb not null default '{}'::jsonb,
  resource_impact jsonb not null default '{}'::jsonb,
  initiated_by uuid not null references auth.users(id),
  approved_by uuid references auth.users(id),
  approval_id uuid references public.approvals(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists creative_decisions_project_created_idx on public.creative_decisions (project_id, created_at desc);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_type text not null default 'user' check (actor_type in ('user', 'agent', 'system')),
  event_type text not null,
  target_type text,
  target_id uuid,
  event_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_events_project_created_idx on public.audit_events (project_id, created_at desc);

-- Add the resource estimate link now that both tables exist.
alter table public.agent_runs
  add constraint agent_runs_resource_estimate_fk
  foreign key (resource_estimate_id) references public.resource_estimates(id) on delete set null;

-- Bootstrap the creator as an organization owner and project director/admin.
-- This prevents newly created records from being inaccessible to their creator.
create or replace function public.bootstrap_organization_owner()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.organization_members (organization_id, user_id, organization_role)
  values (new.id, new.created_by, 'owner')
  on conflict (organization_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists organizations_bootstrap_owner on public.organizations;
create trigger organizations_bootstrap_owner
after insert on public.organizations
for each row execute function public.bootstrap_organization_owner();

create or replace function public.bootstrap_project_creator()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.project_members (project_id, user_id, project_role, access_level, accepted_at)
  values (new.id, new.created_by, 'director', 'admin', now())
  on conflict (project_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists projects_bootstrap_creator on public.projects;
create trigger projects_bootstrap_creator
after insert on public.projects
for each row execute function public.bootstrap_project_creator();

-- -----------------------------------------------------------------------------
-- Updated-at triggers
-- -----------------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array[
    'profiles', 'organizations', 'projects', 'project_members', 'entities',
    'documents', 'assets', 'change_sets', 'reviews', 'agents', 'research_boards',
    'compute_devices'
  ] loop
    execute format('drop trigger if exists %I_set_updated_at on public.%I', t, t);
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

commit;
