-- STUDIO — Knowledge Base, character agents, knowledge → character connections,
-- outline-driven dialogue proposals, and optional bounded Auto-draft.
--
-- Additive and backward compatible: new tables and functions only. Nothing existing is
-- changed or removed.
--
-- Principles enforced here:
-- * Everything is scoped to one project; reads need review access, writes need edit access.
-- * The Knowledge Base is research, not story truth: an item keeps the source's claim
--   (content), her interpretation (director_note) and verification notes separately.
--   Story facts never live here.
-- * Feeds: a failed refresh never deletes or blanks collected items; pausing or
--   disconnecting keeps everything already saved. Feed refresh never creates dialogue.
-- * A connection from a collection to a character is a rule about what the character
--   COULD draw on (purpose, scope, time); it never deletes either record.
-- * Dialogue proposals are proposals: accepting one is a separate, recorded decision, and
--   every proposal keeps the provenance needed to reconstruct it.
begin;

-- ---- Knowledge Base --------------------------------------------------------------------
create table if not exists public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('note', 'link', 'document', 'reference', 'feed')),
  adapter text not null default 'manual' check (adapter in ('manual', 'rss', 'bluesky', 'mastodon')),
  -- link_saved: only the address and its public metadata. imported: content is stored
  -- (her own note, her chosen excerpt, a document's text, or feed items).
  -- stored: a file is kept but its text was not imported. connected: a feed that refreshed
  -- successfully. pending: a feed that hasn't been checked yet. error: the last refresh
  -- failed (items already collected are kept). needs_authorization / unsupported: the
  -- address belongs to a service we can't read without permission or at all.
  status text not null check (status in ('link_saved', 'imported', 'stored', 'pending', 'connected', 'error', 'needs_authorization', 'unsupported')),
  title text not null check (length(title) between 1 and 300),
  url text check (url is null or (url ~ '^https?://' and length(url) <= 2000)),
  feed_url text check (feed_url is null or (feed_url ~ '^https?://' and length(feed_url) <= 2000)),
  origin text check (origin is null or length(origin) <= 200),
  asset_id uuid references public.assets(id) on delete set null,
  reference_id uuid references public.research_references(id) on delete set null,
  director_note text check (director_note is null or length(director_note) <= 4000),
  -- Feeds
  paused boolean not null default false,
  disconnected_at timestamptz,
  refresh_hours integer check (refresh_hours is null or refresh_hours between 6 and 168),
  next_refresh_at timestamptz,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 500),
  failures integer not null default 0,
  http_etag text check (http_etag is null or length(http_etag) <= 300),
  http_last_modified text check (http_last_modified is null or length(http_last_modified) <= 100),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (kind <> 'feed' or (feed_url is not null and refresh_hours is not null))
);
create index if not exists knowledge_sources_project_idx on public.knowledge_sources (project_id, created_at desc) where archived_at is null;
create index if not exists knowledge_sources_due_idx on public.knowledge_sources (next_refresh_at)
  where kind = 'feed' and archived_at is null and not paused and disconnected_at is null;

create table if not exists public.knowledge_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  source_id uuid not null references public.knowledge_sources(id) on delete cascade,
  dedupe_key text not null check (length(dedupe_key) between 1 and 500),
  title text not null check (length(title) between 1 and 500),
  url text check (url is null or (url ~ '^https?://' and length(url) <= 2000)),
  author text check (author is null or length(author) <= 300),
  -- When the source says it was published or the event happened. NULL means unknown, and
  -- unknown stays unknown: it is never treated as "before" a scene.
  published_at timestamptz,
  retrieved_at timestamptz not null default now(),
  content text not null default '' check (length(content) <= 40000),
  content_status text not null check (content_status in ('full_text', 'excerpt', 'summary', 'metadata_only')),
  content_hash text not null,
  version integer not null default 1,
  director_note text check (director_note is null or length(director_note) <= 4000),
  verification text not null default 'unverified' check (verification in ('unverified', 'checked', 'uncertain', 'disputed')),
  verification_note text check (verification_note is null or length(verification_note) <= 2000),
  search tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', left(coalesce(content, ''), 20000)), 'B')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (source_id, dedupe_key)
);
create index if not exists knowledge_items_project_idx on public.knowledge_items (project_id, published_at desc nulls last) where archived_at is null;
create index if not exists knowledge_items_search_idx on public.knowledge_items using gin (search);

-- Every content version of an item, so a pinned snapshot can always be reproduced.
create table if not exists public.knowledge_item_versions (
  item_id uuid not null references public.knowledge_items(id) on delete cascade,
  version integer not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  content text not null,
  content_hash text not null,
  published_at timestamptz,
  captured_at timestamptz not null default now(),
  primary key (item_id, version)
);

create table if not exists public.knowledge_collections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  description text check (description is null or length(description) <= 1000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create unique index if not exists knowledge_collections_name_idx on public.knowledge_collections (project_id, lower(btrim(name))) where archived_at is null;

-- A collection holds whole sources (every item, including future feed items) and/or
-- single items. Membership never copies content.
create table if not exists public.knowledge_collection_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  collection_id uuid not null references public.knowledge_collections(id) on delete cascade,
  source_id uuid references public.knowledge_sources(id) on delete cascade,
  item_id uuid references public.knowledge_items(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check ((source_id is null) <> (item_id is null))
);
create unique index if not exists kcm_source_idx on public.knowledge_collection_members (collection_id, source_id) where source_id is not null;
create unique index if not exists kcm_item_idx on public.knowledge_collection_members (collection_id, item_id) where item_id is not null;

-- ---- Characters ------------------------------------------------------------------------
-- The agent configuration for a character, attached to the existing character record.
-- confirmed: her facts, by field. proposed: interpretations offered by the character
-- partner, waiting for her decision (never used as fact until accepted).
create table if not exists public.character_profiles (
  entity_id uuid primary key references public.entities(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  version integer not null default 1,
  confirmed jsonb not null default '{}'::jsonb check (jsonb_typeof(confirmed) = 'object' and length(confirmed::text) <= 40000),
  proposed jsonb not null default '[]'::jsonb check (jsonb_typeof(proposed) = 'array' and length(proposed::text) <= 40000),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
create table if not exists public.character_profile_versions (
  entity_id uuid not null references public.entities(id) on delete cascade,
  version integer not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  confirmed jsonb not null,
  saved_by uuid references auth.users(id),
  saved_at timestamptz not null default now(),
  primary key (entity_id, version)
);

-- Knowledge collection → character.
create table if not exists public.character_knowledge (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  character_id uuid not null references public.entities(id) on delete cascade,
  collection_id uuid not null references public.knowledge_collections(id) on delete cascade,
  purpose text not null check (purpose in ('profession', 'interests', 'story_info', 'belief', 'director_only')),
  -- story_dated: in-world knowledge, only material dated on or before the scene's story
  -- date. background: informs how they think and talk, never an in-world event.
  -- inspiration: real developments she may choose to adapt; always offered as a proposal.
  temporal text not null check (temporal in ('story_dated', 'background', 'inspiration')),
  scope_terms text[] not null default '{}' check (cardinality(scope_terms) <= 12),
  from_beat uuid references public.story_notebook(id) on delete set null,
  note text check (note is null or length(note) <= 1000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create unique index if not exists character_knowledge_pair_idx on public.character_knowledge (character_id, collection_id) where archived_at is null;

-- ---- Scenes, snapshots, proposals ------------------------------------------------------
-- A scene is keyed by its outline beat when it came from one (b:<beat>:<n>) or by its
-- heading (h:<slug>:<n>). Story time lives here, separate from real-world dates.
create table if not exists public.scene_contexts (
  project_id uuid not null references public.projects(id) on delete cascade,
  scene_key text not null check (length(scene_key) between 3 and 200),
  beat_id uuid references public.story_notebook(id) on delete set null,
  story_date date,
  story_date_note text check (story_date_note is null or length(story_date_note) <= 300),
  objectives jsonb not null default '{}'::jsonb check (jsonb_typeof(objectives) = 'object' and length(objectives::text) <= 8000),
  runtime_seconds integer check (runtime_seconds is null or runtime_seconds between 5 and 1800),
  tone text check (tone is null or length(tone) <= 200),
  pinned_snapshot_id uuid,
  version integer not null default 1,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (project_id, scene_key)
);

create table if not exists public.knowledge_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  scene_key text not null,
  -- [{item_id, version, character_id, use: in_world|background|adaptation, reason}]
  items jsonb not null check (jsonb_typeof(items) = 'array' and length(items::text) <= 100000),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.scene_contexts drop constraint if exists scene_contexts_pinned_fk;
alter table public.scene_contexts add constraint scene_contexts_pinned_fk foreign key (pinned_snapshot_id) references public.knowledge_snapshots(id) on delete set null;

create table if not exists public.dialogue_settings (
  project_id uuid primary key references public.projects(id) on delete cascade,
  auto_draft boolean not null default false,
  paused boolean not null default false,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.dialogue_proposals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  scene_key text not null check (length(scene_key) between 3 and 200),
  beat_id uuid references public.story_notebook(id) on delete set null,
  parent_id uuid references public.dialogue_proposals(id) on delete set null,
  trigger text not null check (trigger in ('on_demand', 'auto', 'revision')),
  status text not null default 'queued' check (status in ('queued', 'drafting', 'ready', 'failed', 'cancelled', 'accepted', 'rejected', 'superseded')),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  request jsonb not null default '{}'::jsonb check (length(request::text) <= 200000),
  director_note text check (director_note is null or length(director_note) <= 2000),
  -- {elements:[{type, speaker?, parenthetical?, text, basis, item_ids?}], assumptions:[], open_choices:[], new_facts:[]}
  result jsonb,
  snapshot_id uuid references public.knowledge_snapshots(id) on delete set null,
  provenance jsonb not null default '{}'::jsonb,
  reviews jsonb not null default '[]'::jsonb check (jsonb_typeof(reviews) = 'array'),
  flags jsonb not null default '{}'::jsonb,
  error text check (error is null or length(error) <= 1000),
  agent_run_id uuid references public.agent_runs(id) on delete set null,
  cancel_requested_at timestamptz,
  accepted_version_id uuid references public.versions(id) on delete set null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  decided_at timestamptz,
  decided_by uuid references auth.users(id)
);
create index if not exists dialogue_proposals_scene_idx on public.dialogue_proposals (project_id, scene_key, created_at desc);
-- One live request per identical input: an unchanged request is never generated twice.
create unique index if not exists dialogue_proposals_dedupe_idx on public.dialogue_proposals (project_id, request_hash)
  where status in ('queued', 'drafting', 'ready', 'accepted');

-- ---- Access ----------------------------------------------------------------------------
do $$ declare t text;
begin
  foreach t in array array['knowledge_sources', 'knowledge_items', 'knowledge_item_versions', 'knowledge_collections',
    'knowledge_collection_members', 'character_profiles', 'character_profile_versions', 'character_knowledge',
    'scene_contexts', 'knowledge_snapshots', 'dialogue_settings', 'dialogue_proposals'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.studio_level(project_id) >= 2)', t || '_read', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
-- Feed housekeeping (validators) is server-only detail.
revoke select on public.knowledge_sources from authenticated;
grant select (id, project_id, kind, adapter, status, title, url, feed_url, origin, asset_id, reference_id, director_note, paused,
  disconnected_at, refresh_hours, next_refresh_at, last_attempt_at, last_success_at, last_error, failures, created_by, created_at,
  updated_at, archived_at) on public.knowledge_sources to authenticated;

-- ---- Helpers ---------------------------------------------------------------------------
create or replace function public.kb_txt(p jsonb, k text, maxlen integer)
returns text language sql immutable set search_path = '' as $$
  select nullif(left(btrim(coalesce(p ->> k, '')), maxlen), '')
$$;

create or replace function public.kb_hash(p text)
returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(coalesce(p, ''), 'UTF8')), 'hex')
$$;

create or replace function public.kb_check_url(p text)
returns text language plpgsql immutable set search_path = '' as $$
begin
  if p is null then return null; end if;
  if p !~ '^https?://[^\s/$.?#][^\s]*$' or length(p) > 2000 then
    raise exception 'That doesn''t look like a web address (it should start with https://).' using errcode = '22023';
  end if;
  return p;
end $$;

/** The entity that owns uploaded research documents (created on first use). */
create or replace function public.kb_owner_entity(p_project uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_id uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'add research');
  select id into v_id from public.entities where project_id = p_project and module_key = 'knowledge' and kind = 'research_board' order by created_at limit 1;
  if v_id is null then
    insert into public.entities (project_id, kind, name, module_key, created_by)
    values (p_project, 'research_board', 'Knowledge Base', 'knowledge', v_uid) returning id into v_id;
  end if;
  return v_id;
end $$;

-- Writes one item (insert or content change → new version). Internal.
create or replace function public.kb_put_item(p_project uuid, p_source uuid, p_key text, p_title text, p_url text, p_author text,
  p_published timestamptz, p_content text, p_status text)
returns table (item_id uuid, changed boolean)
language plpgsql security definer set search_path = '' as $$
declare r public.knowledge_items; v_hash text; v_id uuid;
begin
  v_hash := public.kb_hash(coalesce(p_title, '') || E'\n' || coalesce(p_content, ''));
  select * into r from public.knowledge_items where source_id = p_source and dedupe_key = p_key for update;
  if r.id is null then
    insert into public.knowledge_items (project_id, source_id, dedupe_key, title, url, author, published_at, content, content_status, content_hash)
    values (p_project, p_source, p_key, p_title, p_url, p_author, p_published, coalesce(p_content, ''), p_status, v_hash)
    returning id into v_id;
    insert into public.knowledge_item_versions (item_id, version, project_id, title, content, content_hash, published_at)
    values (v_id, 1, p_project, p_title, coalesce(p_content, ''), v_hash, p_published);
    return query select v_id, true;
  elsif r.content_hash <> v_hash then
    update public.knowledge_items set title = p_title, url = coalesce(p_url, url), author = coalesce(p_author, author),
           published_at = coalesce(p_published, published_at), content = coalesce(p_content, ''), content_status = p_status,
           content_hash = v_hash, version = version + 1, retrieved_at = now(), updated_at = now(), archived_at = null
     where id = r.id;
    insert into public.knowledge_item_versions (item_id, version, project_id, title, content, content_hash, published_at)
    values (r.id, r.version + 1, p_project, p_title, coalesce(p_content, ''), v_hash, coalesce(p_published, r.published_at));
    return query select r.id, true;
  else
    return query select r.id, false;
  end if;
end $$;
revoke all on function public.kb_put_item(uuid, uuid, text, text, text, text, timestamptz, text, text) from public, anon, authenticated;

create or replace function public.kb_collections_assign(p_project uuid, p_uid uuid, p_source uuid, p_collections jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare c uuid;
begin
  if p_collections is null or jsonb_typeof(p_collections) <> 'array' then return; end if;
  for c in select (x)::uuid from jsonb_array_elements_text(p_collections) x loop
    if not exists (select 1 from public.knowledge_collections where id = c and project_id = p_project and archived_at is null) then
      raise exception 'That collection isn''t in this film.' using errcode = '22023';
    end if;
    insert into public.knowledge_collection_members (project_id, collection_id, source_id, created_by)
    values (p_project, c, p_source, p_uid) on conflict do nothing;
  end loop;
end $$;
revoke all on function public.kb_collections_assign(uuid, uuid, uuid, jsonb) from public, anon, authenticated;

-- ---- Research library (her own material) -------------------------------------------------
/** Adds or edits manual research: a note, a saved link (with an optional excerpt she is
 *  allowed to keep), an uploaded document, or one of the film's existing references.
 *  p_data: {kind, title, body?, url?, origin?, author?, published_at?, asset_id?, reference_id?,
 *           director_note?, collections?: [uuid]} */
create or replace function public.kb_research_save(p_project uuid, p_source uuid, p_data jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; s public.knowledge_sources; v_kind text; v_title text; v_body text; v_url text; v_status text;
        v_cstatus text; v_pub timestamptz; v_asset uuid; v_ref uuid; v_id uuid; v_key text;
begin
  v_uid := public.studio_require(p_project, 3, 'add research');
  if p_data is null or jsonb_typeof(p_data) <> 'object' or length(p_data::text) > 60000 then
    raise exception 'Unexpected research.' using errcode = '22023';
  end if;
  if p_source is not null then
    select * into s from public.knowledge_sources where id = p_source and project_id = p_project and archived_at is null for update;
    if s.id is null then raise exception 'Research not found.' using errcode = 'PT404'; end if;
    if s.kind = 'feed' then raise exception 'Feeds are edited from their own settings.' using errcode = '22023'; end if;
    v_kind := s.kind;
  else
    v_kind := p_data ->> 'kind';
    if v_kind not in ('note', 'link', 'document', 'reference') then raise exception 'Unknown kind of research.' using errcode = '22023'; end if;
  end if;
  v_title := coalesce(public.kb_txt(p_data, 'title', 300), s.title);
  v_body := case when p_data ? 'body' then left(coalesce(p_data ->> 'body', ''), 40000)
                 when p_source is not null then (select content from public.knowledge_items where source_id = p_source and dedupe_key = 'main')
                 else null end;
  v_url := public.kb_check_url(case when p_data ? 'url' then public.kb_txt(p_data, 'url', 2000) else s.url end);
  v_pub := case when nullif(p_data ->> 'published_at', '') is not null then (p_data ->> 'published_at')::timestamptz else null end;
  v_asset := case when p_data ? 'asset_id' then nullif(p_data ->> 'asset_id', '')::uuid else s.asset_id end;
  v_ref := case when p_data ? 'reference_id' then nullif(p_data ->> 'reference_id', '')::uuid else s.reference_id end;

  if v_kind = 'note' then
    if v_title is null and coalesce(btrim(v_body), '') = '' then raise exception 'Write something first.' using errcode = '22023'; end if;
    v_title := coalesce(v_title, left(regexp_replace(btrim(v_body), '\s+', ' ', 'g'), 80));
    v_status := 'imported'; v_cstatus := 'full_text';
  elsif v_kind = 'link' then
    if v_url is null then raise exception 'Add the link.' using errcode = '22023'; end if;
    v_title := coalesce(v_title, v_url);
    -- An excerpt is content she chose to keep; without one only the link and its metadata are saved.
    v_status := case when coalesce(btrim(coalesce(v_body, '')), '') <> '' then 'imported' else 'link_saved' end;
    v_cstatus := case when v_status = 'imported' then 'excerpt' else 'metadata_only' end;
    if length(coalesce(v_body, '')) > 6000 then raise exception 'Keep an excerpt to a few paragraphs (6,000 characters).' using errcode = '22023'; end if;
  elsif v_kind = 'document' then
    if v_asset is null or not exists (select 1 from public.assets a where a.id = v_asset and a.project_id = p_project and a.upload_status = 'ready' and a.deleted_at is null) then
      raise exception 'That file isn''t in this film.' using errcode = '22023';
    end if;
    v_title := coalesce(v_title, 'Document');
    v_status := case when coalesce(btrim(coalesce(v_body, '')), '') <> '' then 'imported' else 'stored' end;
    v_cstatus := case when v_status = 'imported' then 'full_text' else 'metadata_only' end;
  else
    if v_ref is null or not exists (select 1 from public.research_references r where r.id = v_ref and r.project_id = p_project) then
      raise exception 'That reference isn''t in this film.' using errcode = '22023';
    end if;
    if p_source is null and exists (select 1 from public.knowledge_sources where project_id = p_project and reference_id = v_ref and archived_at is null) then
      raise exception 'That reference is already in the Knowledge Base.' using errcode = '23505';
    end if;
    select coalesce(v_title, nullif(r.title, ''), r.source_domain, 'Reference'),
           coalesce(v_url, case when r.source_url ~ '^https?://' then r.source_url end),
           coalesce(v_body, concat_ws(E'\n\n', nullif(r.observations, ''), nullif(r.attribution, '')))
      into v_title, v_url, v_body from public.research_references r where r.id = v_ref;
    v_status := 'imported'; v_cstatus := 'full_text';
  end if;

  if p_source is null then
    insert into public.knowledge_sources (project_id, kind, status, title, url, origin, asset_id, reference_id, director_note, created_by)
    values (p_project, v_kind, v_status, v_title, v_url, public.kb_txt(p_data, 'origin', 200), v_asset, v_ref,
            public.kb_txt(p_data, 'director_note', 4000), v_uid)
    returning id into v_id;
  else
    v_id := p_source;
    update public.knowledge_sources set title = v_title, url = v_url, status = v_status,
           origin = case when p_data ? 'origin' then public.kb_txt(p_data, 'origin', 200) else origin end,
           director_note = case when p_data ? 'director_note' then public.kb_txt(p_data, 'director_note', 4000) else director_note end,
           updated_at = now()
     where id = v_id;
  end if;
  v_key := 'main';
  if p_source is null or v_body is not null or p_data ? 'title' or p_data ? 'published_at' then
    perform public.kb_put_item(p_project, v_id, v_key, v_title, v_url, public.kb_txt(p_data, 'author', 300), v_pub,
      coalesce(v_body, (select content from public.knowledge_items where source_id = v_id and dedupe_key = v_key), ''), v_cstatus);
    if p_data ? 'published_at' and v_pub is null then
      update public.knowledge_items set published_at = null where source_id = v_id and dedupe_key = v_key;
    end if;
  end if;
  perform public.kb_collections_assign(p_project, v_uid, v_id, p_data -> 'collections');
  perform public.studio_audit(p_project, v_uid, 'user', case when p_source is null then 'knowledge.added' else 'knowledge.edited' end,
    'knowledge_source', v_id, jsonb_build_object('kind', v_kind, 'status', v_status));
  return v_id;
end $$;

/** Her notes on one item: interpretation, verification, a corrected date (null = unknown). */
create or replace function public.kb_item_annotate(p_project uuid, p_item uuid, p_data jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; r public.knowledge_items;
begin
  v_uid := public.studio_require(p_project, 3, 'annotate research');
  select * into r from public.knowledge_items where id = p_item and project_id = p_project for update;
  if r.id is null then raise exception 'Research not found.' using errcode = 'PT404'; end if;
  if p_data ? 'verification' and p_data ->> 'verification' not in ('unverified', 'checked', 'uncertain', 'disputed') then
    raise exception 'Unknown verification.' using errcode = '22023';
  end if;
  update public.knowledge_items set
    director_note = case when p_data ? 'director_note' then public.kb_txt(p_data, 'director_note', 4000) else director_note end,
    verification = coalesce(p_data ->> 'verification', verification),
    verification_note = case when p_data ? 'verification_note' then public.kb_txt(p_data, 'verification_note', 2000) else verification_note end,
    published_at = case when p_data ? 'published_at' then nullif(p_data ->> 'published_at', '')::timestamptz else published_at end,
    updated_at = now()
  where id = p_item;
end $$;

/** Removes research from the library view. The rows stay (pinned snapshots and accepted
 *  dialogue keep their provenance). */
create or replace function public.kb_source_archive(p_project uuid, p_source uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'remove research');
  update public.knowledge_sources set archived_at = now(), updated_at = now() where id = p_source and project_id = p_project and archived_at is null;
  if not found then raise exception 'Research not found.' using errcode = 'PT404'; end if;
  perform public.studio_audit(p_project, v_uid, 'user', 'knowledge.removed', 'knowledge_source', p_source, '{}'::jsonb);
end $$;

-- ---- Collections ---------------------------------------------------------------------------
create or replace function public.kb_collection_save(p_project uuid, p_collection uuid, p_name text, p_description text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_id uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'organize research');
  if coalesce(btrim(p_name), '') = '' or length(btrim(p_name)) > 120 then raise exception 'Give the collection a short name.' using errcode = '22023'; end if;
  if exists (select 1 from public.knowledge_collections where project_id = p_project and archived_at is null
             and lower(btrim(name)) = lower(btrim(p_name)) and id is distinct from p_collection) then
    raise exception 'There''s already a collection with that name.' using errcode = '23505';
  end if;
  if p_collection is null then
    insert into public.knowledge_collections (project_id, name, description, created_by)
    values (p_project, btrim(p_name), nullif(left(btrim(coalesce(p_description, '')), 1000), ''), v_uid) returning id into v_id;
  else
    update public.knowledge_collections set name = btrim(p_name), description = nullif(left(btrim(coalesce(p_description, '')), 1000), ''), updated_at = now()
     where id = p_collection and project_id = p_project and archived_at is null returning id into v_id;
    if v_id is null then raise exception 'Collection not found.' using errcode = 'PT404'; end if;
  end if;
  return v_id;
end $$;

/** Archiving a collection keeps its sources and items; character connections to it stop. */
create or replace function public.kb_collection_archive(p_project uuid, p_collection uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'organize research');
  update public.knowledge_collections set archived_at = now() where id = p_collection and project_id = p_project and archived_at is null;
  if not found then raise exception 'Collection not found.' using errcode = 'PT404'; end if;
  update public.character_knowledge set archived_at = now() where collection_id = p_collection and archived_at is null;
end $$;

create or replace function public.kb_collection_member(p_project uuid, p_collection uuid, p_source uuid, p_item uuid, p_on boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'organize research');
  if (p_source is null) = (p_item is null) then raise exception 'Choose a source or an item.' using errcode = '22023'; end if;
  if not exists (select 1 from public.knowledge_collections where id = p_collection and project_id = p_project and archived_at is null) then
    raise exception 'Collection not found.' using errcode = 'PT404';
  end if;
  if p_source is not null and not exists (select 1 from public.knowledge_sources where id = p_source and project_id = p_project) then
    raise exception 'Research not found.' using errcode = 'PT404';
  end if;
  if p_item is not null and not exists (select 1 from public.knowledge_items where id = p_item and project_id = p_project) then
    raise exception 'Research not found.' using errcode = 'PT404';
  end if;
  if p_on then
    insert into public.knowledge_collection_members (project_id, collection_id, source_id, item_id, created_by)
    values (p_project, p_collection, p_source, p_item, v_uid) on conflict do nothing;
  else
    delete from public.knowledge_collection_members where collection_id = p_collection
       and source_id is not distinct from p_source and item_id is not distinct from p_item;
  end if;
end $$;

/** Items in a set of collections (through whole sources or single items), active only. */
create or replace function public.kb_collection_items(p_project uuid, p_collections uuid[])
returns table (item_id uuid, collection_id uuid)
language sql stable security definer set search_path = '' as $$
  select i.id, m.collection_id from public.knowledge_collection_members m
    join public.knowledge_items i on i.source_id = m.source_id
    join public.knowledge_sources s on s.id = i.source_id
   where m.project_id = p_project and m.collection_id = any(p_collections) and m.source_id is not null
     and i.archived_at is null and s.archived_at is null and public.studio_level(p_project) >= 2
  union
  select i.id, m.collection_id from public.knowledge_collection_members m
    join public.knowledge_items i on i.id = m.item_id
    join public.knowledge_sources s on s.id = i.source_id
   where m.project_id = p_project and m.collection_id = any(p_collections) and m.item_id is not null
     and i.archived_at is null and s.archived_at is null and public.studio_level(p_project) >= 2
$$;

/** Keyword search inside chosen collections (Postgres full-text search; no model). */
create or replace function public.kb_search(p_project uuid, p_collections uuid[], p_terms text[], p_limit integer)
returns table (item_id uuid, rank real)
language plpgsql stable security definer set search_path = '' as $$
declare q tsquery;
begin
  if public.studio_level(p_project) < 2 then return; end if;
  select to_tsquery('english', string_agg(quote_literal(t) || ':*', ' | '))
    into q
    from (select distinct lower(regexp_replace(x, '[^[:alnum:]]+', '', 'g')) t from unnest(coalesce(p_terms, '{}')) x) y
   where length(t) between 3 and 40;
  if q is null then return; end if;
  return query
  select i.id, ts_rank(i.search, q)::real
    from public.knowledge_items i
   where i.project_id = p_project and i.archived_at is null
     and i.id in (select ci.item_id from public.kb_collection_items(p_project, p_collections) ci)
     and i.search @@ q
   order by 2 desc, i.published_at desc nulls last
   limit least(greatest(coalesce(p_limit, 8), 1), 40);
end $$;

-- ---- Feeds ---------------------------------------------------------------------------------
/** Adds an updating source after the server has identified a readable feed address.
 *  Status starts as pending until the first refresh succeeds. */
create or replace function public.kb_feed_add(p_project uuid, p_data jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_id uuid; v_adapter text; v_hours integer; v_feed text;
begin
  v_uid := public.studio_require(p_project, 3, 'add an updating source');
  v_adapter := coalesce(p_data ->> 'adapter', 'rss');
  if v_adapter not in ('rss', 'bluesky', 'mastodon') then raise exception 'That kind of source isn''t supported.' using errcode = '22023'; end if;
  v_hours := coalesce((p_data ->> 'refresh_hours')::integer, 24);
  if v_hours not in (6, 12, 24, 72, 168) then raise exception 'Choose how often to check.' using errcode = '22023'; end if;
  v_feed := public.kb_check_url(public.kb_txt(p_data, 'feed_url', 2000));
  if v_feed is null then raise exception 'No feed address.' using errcode = '22023'; end if;
  if exists (select 1 from public.knowledge_sources where project_id = p_project and kind = 'feed' and feed_url = v_feed and archived_at is null) then
    raise exception 'That feed is already in the Knowledge Base.' using errcode = '23505';
  end if;
  if (select count(*) from public.knowledge_sources where project_id = p_project and kind = 'feed' and archived_at is null) >= 30 then
    raise exception 'A film can follow up to 30 feeds.' using errcode = '22023';
  end if;
  insert into public.knowledge_sources (project_id, kind, adapter, status, title, url, feed_url, origin, refresh_hours, next_refresh_at, director_note, created_by)
  values (p_project, 'feed', v_adapter, 'pending', coalesce(public.kb_txt(p_data, 'title', 300), v_feed),
          public.kb_check_url(public.kb_txt(p_data, 'url', 2000)), v_feed, public.kb_txt(p_data, 'origin', 200), v_hours, now(),
          public.kb_txt(p_data, 'director_note', 4000), v_uid)
  returning id into v_id;
  perform public.kb_collections_assign(p_project, v_uid, v_id, p_data -> 'collections');
  perform public.studio_audit(p_project, v_uid, 'user', 'knowledge.feed_added', 'knowledge_source', v_id, jsonb_build_object('adapter', v_adapter));
  return v_id;
end $$;

/** Feed settings: title, note, interval, pause/resume, disconnect/reconnect. Disconnecting
 *  stops refreshing and keeps every item already collected. */
create or replace function public.kb_feed_update(p_project uuid, p_source uuid, p_data jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; s public.knowledge_sources; v_hours integer;
begin
  v_uid := public.studio_require(p_project, 3, 'change an updating source');
  select * into s from public.knowledge_sources where id = p_source and project_id = p_project and kind = 'feed' and archived_at is null for update;
  if s.id is null then raise exception 'Feed not found.' using errcode = 'PT404'; end if;
  v_hours := coalesce((p_data ->> 'refresh_hours')::integer, s.refresh_hours);
  if v_hours not in (6, 12, 24, 72, 168) then raise exception 'Choose how often to check.' using errcode = '22023'; end if;
  update public.knowledge_sources set
    title = coalesce(public.kb_txt(p_data, 'title', 300), title),
    director_note = case when p_data ? 'director_note' then public.kb_txt(p_data, 'director_note', 4000) else director_note end,
    refresh_hours = v_hours,
    paused = coalesce((p_data ->> 'paused')::boolean, paused),
    disconnected_at = case when (p_data ->> 'disconnected')::boolean is true then coalesce(disconnected_at, now())
                           when (p_data ->> 'disconnected')::boolean is false then null else disconnected_at end,
    next_refresh_at = case when (p_data ->> 'paused')::boolean is false or (p_data ->> 'disconnected')::boolean is false then now() else next_refresh_at end,
    updated_at = now()
  where id = p_source;
  perform public.studio_audit(p_project, v_uid, 'user', 'knowledge.feed_changed', 'knowledge_source', p_source, p_data - 'director_note');
end $$;

/** A member asks for a refresh now. Rate-limited; returns false when one just ran. */
create or replace function public.kb_feed_request_refresh(p_project uuid, p_source uuid)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; s public.knowledge_sources;
begin
  v_uid := public.studio_require(p_project, 3, 'refresh an updating source');
  select * into s from public.knowledge_sources where id = p_source and project_id = p_project and kind = 'feed' and archived_at is null for update;
  if s.id is null then raise exception 'Feed not found.' using errcode = 'PT404'; end if;
  if s.disconnected_at is not null then raise exception 'Reconnect the feed first.' using errcode = '22023'; end if;
  if s.last_attempt_at > now() - interval '1 minute' then return false; end if;
  update public.knowledge_sources set next_refresh_at = now() where id = p_source;
  return true;
end $$;

/** SERVICE ROLE ONLY. Claims a feed for one refresh attempt (no overlapping refreshes). */
create or replace function public.kb_feed_claim(p_source uuid, p_force boolean)
returns table (id uuid, feed_url text, adapter text, http_etag text, http_last_modified text)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  update public.knowledge_sources s set last_attempt_at = now()
   where s.id = p_source and s.kind = 'feed' and s.archived_at is null and s.disconnected_at is null
     and (p_force or not s.paused)
     and (s.last_attempt_at is null or s.last_attempt_at < now() - interval '1 minute')
     and (p_force or s.next_refresh_at is null or s.next_refresh_at <= now())
  returning s.id, s.feed_url, s.adapter, s.http_etag, s.http_last_modified;
end $$;

/** SERVICE ROLE ONLY. Stores fetched items, deduplicated by their key. Never removes items. */
create or replace function public.kb_feed_ingest(p_source uuid, p_items jsonb, p_meta jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.knowledge_sources; it jsonb; v_new integer := 0; v_changed integer := 0; r record; v_exists boolean;
begin
  select * into s from public.knowledge_sources where id = p_source and kind = 'feed' for update;
  if s.id is null then raise exception 'Feed not found.' using errcode = 'PT404'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 or length(p_items::text) > 3000000 then
    raise exception 'Too many items.' using errcode = '22023';
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    continue when coalesce(it ->> 'key', '') = '' or coalesce(it ->> 'title', '') = '';
    v_exists := exists (select 1 from public.knowledge_items where source_id = s.id and dedupe_key = left(it ->> 'key', 500));
    select * into r from public.kb_put_item(s.project_id, s.id, left(it ->> 'key', 500), left(it ->> 'title', 500),
      case when (it ->> 'url') ~ '^https?://' then left(it ->> 'url', 2000) end, left(nullif(it ->> 'author', ''), 300),
      nullif(it ->> 'published_at', '')::timestamptz, left(coalesce(it ->> 'content', ''), 20000),
      case when coalesce(it ->> 'content', '') = '' then 'metadata_only' else 'summary' end);
    if not v_exists then v_new := v_new + 1; elsif r.changed then v_changed := v_changed + 1; end if;
  end loop;
  update public.knowledge_sources set status = 'connected', last_success_at = now(), last_error = null, failures = 0,
         next_refresh_at = now() + make_interval(hours => refresh_hours),
         title = case when title = feed_url and nullif(p_meta ->> 'title', '') is not null then left(p_meta ->> 'title', 300) else title end,
         url = coalesce(url, case when (p_meta ->> 'site_url') ~ '^https?://' then left(p_meta ->> 'site_url', 2000) end),
         http_etag = left(nullif(p_meta ->> 'etag', ''), 300), http_last_modified = left(nullif(p_meta ->> 'last_modified', ''), 100),
         updated_at = now()
   where id = s.id;
  return jsonb_build_object('new', v_new, 'changed', v_changed);
end $$;

/** SERVICE ROLE ONLY. Records a failed refresh. Collected items are untouched; retries back off. */
create or replace function public.kb_feed_fail(p_source uuid, p_error text, p_status text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.knowledge_sources set
    status = case when p_status in ('needs_authorization', 'unsupported') then p_status else 'error' end,
    last_error = left(coalesce(p_error, 'The refresh failed.'), 500), failures = failures + 1,
    next_refresh_at = now() + least(make_interval(hours => refresh_hours), make_interval(hours => (power(2, least(failures, 6)))::integer)),
    updated_at = now()
  where id = p_source and kind = 'feed';
end $$;

/** SERVICE ROLE ONLY. A 304 Not Modified: the feed is fine and unchanged. */
create or replace function public.kb_feed_unchanged(p_source uuid)
returns void
language sql security definer set search_path = '' as $$
  update public.knowledge_sources set status = 'connected', last_success_at = now(), last_error = null, failures = 0,
         next_refresh_at = now() + make_interval(hours => refresh_hours), updated_at = now()
   where id = p_source and kind = 'feed';
$$;

-- ---- Characters ----------------------------------------------------------------------------
create or replace function public.character_check(p_project uuid, p_entity uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.entities where id = p_entity and project_id = p_project and kind = 'character') then
    raise exception 'Character not found.' using errcode = 'PT404';
  end if;
end $$;
revoke all on function public.character_check(uuid, uuid) from public, anon, authenticated;

create or replace function public.character_fields_ok(p jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'object' and not exists (
    select 1 from jsonb_each(p) e
     where e.key not in ('backstory', 'desires', 'fears', 'beliefs', 'relationships', 'expertise', 'voice', 'knows', 'misbeliefs', 'conceals', 'pressure')
        or jsonb_typeof(e.value) <> 'string' or length(e.value #>> '{}') > 4000)
$$;

/** Saves her confirmed character facts (all fields optional). Conflict-safe by version. */
create or replace function public.character_profile_save(p_project uuid, p_entity uuid, p_base_version integer, p_confirmed jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; r public.character_profiles; v_clean jsonb;
begin
  v_uid := public.studio_require(p_project, 3, 'develop a character');
  perform public.character_check(p_project, p_entity);
  if not public.character_fields_ok(p_confirmed) then raise exception 'Unexpected character fields.' using errcode = '22023'; end if;
  select coalesce(jsonb_object_agg(key, btrim(value #>> '{}')) filter (where btrim(value #>> '{}') <> ''), '{}'::jsonb)
    into v_clean from jsonb_each(p_confirmed);
  select * into r from public.character_profiles where entity_id = p_entity for update;
  if r.entity_id is null then
    insert into public.character_profiles (entity_id, project_id, confirmed, updated_by) values (p_entity, p_project, v_clean, v_uid);
    insert into public.character_profile_versions (entity_id, version, project_id, confirmed, saved_by) values (p_entity, 1, p_project, v_clean, v_uid);
    return 1;
  end if;
  if p_base_version is not null and p_base_version <> r.version then
    raise exception 'Someone else changed this character. Reload to see the latest.' using errcode = 'PT409';
  end if;
  if r.confirmed = v_clean then return r.version; end if;
  update public.character_profiles set confirmed = v_clean, version = version + 1, updated_by = v_uid, updated_at = now() where entity_id = p_entity;
  insert into public.character_profile_versions (entity_id, version, project_id, confirmed, saved_by) values (p_entity, r.version + 1, p_project, v_clean, v_uid);
  return r.version + 1;
end $$;

/** Accept (optionally edited) or dismiss one proposed interpretation. Accepting appends it to
 *  the confirmed field; nothing else in the profile changes. */
create or replace function public.character_proposal_decide(p_project uuid, p_entity uuid, p_proposal text, p_accept boolean, p_text text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; r public.character_profiles; p jsonb; v_field text; v_text text; v_new jsonb; v_rest jsonb;
begin
  v_uid := public.studio_require(p_project, 3, 'develop a character');
  perform public.character_check(p_project, p_entity);
  select * into r from public.character_profiles where entity_id = p_entity for update;
  if r.entity_id is null then raise exception 'Nothing to decide.' using errcode = 'PT404'; end if;
  select x into p from jsonb_array_elements(r.proposed) x where x ->> 'id' = p_proposal;
  if p is null then raise exception 'That suggestion is gone.' using errcode = 'PT404'; end if;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_rest from jsonb_array_elements(r.proposed) x where x ->> 'id' <> p_proposal;
  if not p_accept then
    update public.character_profiles set proposed = v_rest, updated_at = now() where entity_id = p_entity;
    return r.version;
  end if;
  v_field := p ->> 'field';
  v_text := left(btrim(coalesce(nullif(btrim(coalesce(p_text, '')), ''), p ->> 'text')), 4000);
  v_new := r.confirmed || jsonb_build_object(v_field,
    left(case when coalesce(r.confirmed ->> v_field, '') = '' then v_text else (r.confirmed ->> v_field) || E'\n' || v_text end, 4000));
  if not public.character_fields_ok(v_new) then raise exception 'Unexpected character field.' using errcode = '22023'; end if;
  update public.character_profiles set confirmed = v_new, proposed = v_rest, version = version + 1, updated_by = v_uid, updated_at = now()
   where entity_id = p_entity;
  insert into public.character_profile_versions (entity_id, version, project_id, confirmed, saved_by) values (p_entity, r.version + 1, p_project, v_new, v_uid);
  return r.version + 1;
end $$;

/** Starts one character-partner turn (budget-checked). Returns the agent run id. */
create or replace function public.character_talk_request(p_project uuid, p_entity uuid, p_message text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_run uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'develop a character');
  perform public.character_check(p_project, p_entity);
  if length(coalesce(p_message, '')) > 4000 then raise exception 'Keep it shorter.' using errcode = '22023'; end if;
  if exists (select 1 from public.agent_runs where project_id = p_project and task_type = 'character_talk' and status in ('queued', 'running')
             and created_at > now() - interval '2 minutes' and input_payload ->> 'entity_id' = p_entity::text) then
    raise exception 'The character partner is still answering.' using errcode = 'PT409';
  end if;
  if public.studio_ai_budget_usd(p_project) - public.studio_ai_spent_month_usd(p_project) < 0.05 then
    raise exception 'The team has used this month''s AI budget. Ask your Executive Producer.' using errcode = 'PT402';
  end if;
  insert into public.agent_runs (project_id, domain, status, task_type, input_payload, model_provider, prompt_version, requested_by)
  values (p_project, 'writer', 'queued', 'character_talk', jsonb_build_object('entity_id', p_entity, 'message', coalesce(p_message, '')),
          'anthropic', 'character-partner-v1', v_uid) returning id into v_run;
  return v_run;
end $$;

/** SERVICE ROLE ONLY. Records the partner's reply and its proposed interpretations. */
create or replace function public.character_talk_complete(p_run uuid, p_reply text, p_proposals jsonb, p_usage jsonb, p_cost_usd numeric, p_model text)
returns void
language plpgsql security definer set search_path = '' as $$
declare r public.agent_runs; v_entity uuid; v_add jsonb;
begin
  select * into r from public.agent_runs where id = p_run for update;
  if r.id is null or r.task_type <> 'character_talk' or r.status <> 'running' then raise exception 'Run not running.' using errcode = 'PT409'; end if;
  if jsonb_typeof(p_proposals) <> 'array' or jsonb_array_length(p_proposals) > 6 then raise exception 'Too many suggestions.' using errcode = '22023'; end if;
  v_entity := (r.input_payload ->> 'entity_id')::uuid;
  select coalesce(jsonb_agg(jsonb_build_object('id', gen_random_uuid()::text, 'field', x ->> 'field', 'text', left(x ->> 'text', 1000),
                                                'why', left(coalesce(x ->> 'why', ''), 500), 'at', now())), '[]'::jsonb)
    into v_add from jsonb_array_elements(p_proposals) x
   where x ->> 'field' in ('backstory', 'desires', 'fears', 'beliefs', 'relationships', 'expertise', 'voice', 'knows', 'misbeliefs', 'conceals', 'pressure')
     and coalesce(btrim(x ->> 'text'), '') <> '';
  insert into public.character_profiles (entity_id, project_id, proposed) values (v_entity, r.project_id, '[]'::jsonb) on conflict (entity_id) do nothing;
  update public.character_profiles set proposed = (
           select coalesce(jsonb_agg(e), '[]'::jsonb) from (
             select e from jsonb_array_elements(proposed || v_add) e offset greatest(jsonb_array_length(proposed || v_add) - 20, 0)) z),
         updated_at = now()
   where entity_id = v_entity;
  perform public.studio_record_ai_charge(r, p_usage, p_cost_usd);
  update public.agent_runs set status = 'succeeded', completed_at = now(), model_name = left(p_model, 100), token_usage = coalesce(p_usage, '{}'::jsonb),
         output_payload = jsonb_build_object('reply', left(coalesce(p_reply, ''), 4000), 'proposals', v_add)
   where id = p_run;
end $$;

/** Connect a knowledge collection to a character, or change that connection. */
create or replace function public.character_knowledge_save(p_project uuid, p_link uuid, p_data jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_id uuid; v_char uuid; v_coll uuid; v_terms text[]; v_beat uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'connect research to a character');
  v_char := nullif(p_data ->> 'character_id', '')::uuid;
  v_coll := nullif(p_data ->> 'collection_id', '')::uuid;
  if p_data ->> 'purpose' not in ('profession', 'interests', 'story_info', 'belief', 'director_only') then raise exception 'Choose a purpose.' using errcode = '22023'; end if;
  if p_data ->> 'temporal' not in ('story_dated', 'background', 'inspiration') then raise exception 'Choose how time works for this connection.' using errcode = '22023'; end if;
  select coalesce(array_agg(distinct left(btrim(t), 60)) filter (where btrim(t) <> ''), '{}') into v_terms
    from jsonb_array_elements_text(coalesce(p_data -> 'scope_terms', '[]'::jsonb)) t;
  if cardinality(v_terms) > 12 then raise exception 'Use up to 12 scope words.' using errcode = '22023'; end if;
  v_beat := nullif(p_data ->> 'from_beat', '')::uuid;
  if v_beat is not null and not exists (select 1 from public.story_notebook where id = v_beat and project_id = p_project) then
    raise exception 'That outline beat isn''t in this film.' using errcode = '22023';
  end if;
  if p_link is null then
    perform public.character_check(p_project, v_char);
    if not exists (select 1 from public.knowledge_collections where id = v_coll and project_id = p_project and archived_at is null) then
      raise exception 'Collection not found.' using errcode = 'PT404';
    end if;
    if exists (select 1 from public.character_knowledge where character_id = v_char and collection_id = v_coll and archived_at is null) then
      raise exception 'That collection is already connected to this character.' using errcode = '23505';
    end if;
    insert into public.character_knowledge (project_id, character_id, collection_id, purpose, temporal, scope_terms, from_beat, note, created_by)
    values (p_project, v_char, v_coll, p_data ->> 'purpose', p_data ->> 'temporal', v_terms, v_beat, public.kb_txt(p_data, 'note', 1000), v_uid)
    returning id into v_id;
  else
    update public.character_knowledge set purpose = p_data ->> 'purpose', temporal = p_data ->> 'temporal', scope_terms = v_terms,
           from_beat = v_beat, note = public.kb_txt(p_data, 'note', 1000), updated_at = now()
     where id = p_link and project_id = p_project and archived_at is null returning id into v_id;
    if v_id is null then raise exception 'Connection not found.' using errcode = 'PT404'; end if;
  end if;
  perform public.studio_audit(p_project, v_uid, 'user', 'character.knowledge_connected', 'character_knowledge', v_id,
    jsonb_build_object('purpose', p_data ->> 'purpose', 'temporal', p_data ->> 'temporal'));
  return v_id;
end $$;

/** Disconnects. Neither the character nor the collection is touched. */
create or replace function public.character_knowledge_remove(p_project uuid, p_link uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'connect research to a character');
  update public.character_knowledge set archived_at = now() where id = p_link and project_id = p_project and archived_at is null;
  if not found then raise exception 'Connection not found.' using errcode = 'PT404'; end if;
  perform public.studio_audit(p_project, v_uid, 'user', 'character.knowledge_disconnected', 'character_knowledge', p_link, '{}'::jsonb);
end $$;

-- ---- Scenes -----------------------------------------------------------------------------
create or replace function public.scene_context_save(p_project uuid, p_scene_key text, p_data jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; r public.scene_contexts; v_beat uuid; v_obj jsonb;
begin
  v_uid := public.studio_require(p_project, 3, 'set up a scene');
  if p_scene_key !~ '^[bh]:[A-Za-z0-9_-]{1,120}:[0-9]{1,3}$' then raise exception 'Unknown scene.' using errcode = '22023'; end if;
  v_beat := nullif(p_data ->> 'beat_id', '')::uuid;
  if v_beat is not null and not exists (select 1 from public.story_notebook where id = v_beat and project_id = p_project) then
    raise exception 'That outline beat isn''t in this film.' using errcode = '22023';
  end if;
  v_obj := coalesce(p_data -> 'objectives', '{}'::jsonb);
  if jsonb_typeof(v_obj) <> 'object' or exists (select 1 from jsonb_each(v_obj) e where jsonb_typeof(e.value) <> 'string' or length(e.value #>> '{}') > 600
       or not exists (select 1 from public.entities x where x.id::text = e.key and x.project_id = p_project and x.kind = 'character')) then
    raise exception 'Objectives are one short line per character in this film.' using errcode = '22023';
  end if;
  select * into r from public.scene_contexts where project_id = p_project and scene_key = p_scene_key for update;
  if r.scene_key is null then
    insert into public.scene_contexts (project_id, scene_key, beat_id, story_date, story_date_note, objectives, runtime_seconds, tone, updated_by)
    values (p_project, p_scene_key, v_beat, nullif(p_data ->> 'story_date', '')::date, public.kb_txt(p_data, 'story_date_note', 300),
            v_obj, nullif(p_data ->> 'runtime_seconds', '')::integer, public.kb_txt(p_data, 'tone', 200), v_uid);
    return 1;
  end if;
  update public.scene_contexts set
    beat_id = coalesce(v_beat, beat_id),
    story_date = case when p_data ? 'story_date' then nullif(p_data ->> 'story_date', '')::date else story_date end,
    story_date_note = case when p_data ? 'story_date_note' then public.kb_txt(p_data, 'story_date_note', 300) else story_date_note end,
    objectives = case when p_data ? 'objectives' then v_obj else objectives end,
    runtime_seconds = case when p_data ? 'runtime_seconds' then nullif(p_data ->> 'runtime_seconds', '')::integer else runtime_seconds end,
    tone = case when p_data ? 'tone' then public.kb_txt(p_data, 'tone', 200) else tone end,
    version = version + 1, updated_by = v_uid, updated_at = now()
  where project_id = p_project and scene_key = p_scene_key;
  return r.version + 1;
end $$;

/** Pins (or unpins with null) the research snapshot a scene's drafts use. */
create or replace function public.scene_snapshot_pin(p_project uuid, p_scene_key text, p_snapshot uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'pin research for a scene');
  if p_snapshot is not null and not exists (select 1 from public.knowledge_snapshots where id = p_snapshot and project_id = p_project and scene_key = p_scene_key) then
    raise exception 'That snapshot isn''t from this scene.' using errcode = '22023';
  end if;
  insert into public.scene_contexts (project_id, scene_key, pinned_snapshot_id, updated_by) values (p_project, p_scene_key, p_snapshot, v_uid)
  on conflict (project_id, scene_key) do update set pinned_snapshot_id = p_snapshot, version = public.scene_contexts.version + 1,
     updated_by = v_uid, updated_at = now();
end $$;

-- ---- Dialogue proposals ----------------------------------------------------------------------
create or replace function public.dialogue_settings_save(p_project uuid, p_auto boolean, p_paused boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'change Auto-draft');
  insert into public.dialogue_settings (project_id, auto_draft, paused, updated_by) values (p_project, coalesce(p_auto, false), coalesce(p_paused, false), v_uid)
  on conflict (project_id) do update set auto_draft = coalesce(p_auto, public.dialogue_settings.auto_draft),
     paused = coalesce(p_paused, public.dialogue_settings.paused), updated_by = v_uid, updated_at = now();
  if p_auto is false or p_paused is true then
    -- Turning Auto-draft off or pausing it cancels its waiting jobs (nothing already drafted is touched).
    update public.dialogue_proposals set status = 'cancelled', finished_at = now()
     where project_id = p_project and trigger = 'auto' and status = 'queued';
  end if;
  perform public.studio_audit(p_project, v_uid, 'user', 'dialogue.settings', 'project', p_project, jsonb_build_object('auto', p_auto, 'paused', p_paused));
end $$;

/** Queues one dialogue proposal for a scene. Returns the id of the queued proposal, or of an
 *  identical one that is already queued, drafting, ready or accepted (never generated twice).
 *  Auto-draft requests are refused unless she turned Auto-draft on and it isn't paused. */
create or replace function public.dialogue_request(p_project uuid, p_scene_key text, p_data jsonb)
returns table (proposal_id uuid, existing boolean)
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_trigger text; v_hash text; v_id uuid; v_beat uuid; v_parent uuid; v_run uuid; v_live integer;
begin
  v_uid := public.studio_require(p_project, 3, 'develop dialogue');
  if p_scene_key !~ '^[bh]:[A-Za-z0-9_-]{1,120}:[0-9]{1,3}$' then raise exception 'Unknown scene.' using errcode = '22023'; end if;
  v_trigger := coalesce(p_data ->> 'trigger', 'on_demand');
  if v_trigger not in ('on_demand', 'auto', 'revision') then raise exception 'Unknown trigger.' using errcode = '22023'; end if;
  v_hash := p_data ->> 'request_hash';
  if v_hash is null or v_hash !~ '^[0-9a-f]{64}$' then raise exception 'Missing request fingerprint.' using errcode = '22023'; end if;
  if length(coalesce(p_data -> 'request', '{}'::jsonb)::text) > 200000 then raise exception 'That scene is too large for one draft.' using errcode = '22023'; end if;
  if v_trigger = 'auto' and not exists (select 1 from public.dialogue_settings where project_id = p_project and auto_draft and not paused) then
    raise exception 'Auto-draft is off.' using errcode = '22023';
  end if;
  v_beat := nullif(p_data ->> 'beat_id', '')::uuid;
  if v_beat is not null and not exists (select 1 from public.story_notebook where id = v_beat and project_id = p_project) then
    raise exception 'That outline beat isn''t in this film.' using errcode = '22023';
  end if;
  v_parent := nullif(p_data ->> 'parent_id', '')::uuid;
  if v_parent is not null and not exists (select 1 from public.dialogue_proposals where id = v_parent and project_id = p_project and scene_key = p_scene_key) then
    raise exception 'That draft isn''t from this scene.' using errcode = '22023';
  end if;

  select id into v_id from public.dialogue_proposals
   where project_id = p_project and request_hash = v_hash and status in ('queued', 'drafting', 'ready', 'accepted') limit 1;
  if v_id is not null then return query select v_id, true; return; end if;

  -- Bounded work: at most 3 waiting/drafting per film (Auto-draft: 3 in total, 1 per scene).
  select count(*) into v_live from public.dialogue_proposals where project_id = p_project and status in ('queued', 'drafting');
  if v_live >= 3 then raise exception 'Three drafts are already in progress. Wait for one to finish.' using errcode = 'PT409'; end if;
  if v_trigger = 'auto' then
    -- A newer Auto-draft for the same scene replaces a waiting one.
    update public.dialogue_proposals set status = 'cancelled', finished_at = now()
     where project_id = p_project and scene_key = p_scene_key and trigger = 'auto' and status = 'queued';
  end if;
  if public.studio_ai_budget_usd(p_project) - public.studio_ai_spent_month_usd(p_project) < 0.10 then
    raise exception 'The team has used this month''s AI budget. Ask your Executive Producer.' using errcode = 'PT402';
  end if;

  insert into public.agent_runs (project_id, domain, status, task_type, input_payload, model_provider, prompt_version, requested_by)
  values (p_project, 'writer', 'queued', 'dialogue', jsonb_build_object('scene_key', p_scene_key, 'trigger', v_trigger),
          'anthropic', coalesce(left(p_data ->> 'workflow_version', 60), 'scene-dialogue-v1'), v_uid)
  returning id into v_run;
  insert into public.dialogue_proposals (project_id, scene_key, beat_id, parent_id, trigger, request_hash, request, director_note, agent_run_id, created_by)
  values (p_project, p_scene_key, v_beat, v_parent, v_trigger, v_hash, coalesce(p_data -> 'request', '{}'::jsonb),
          public.kb_txt(p_data, 'director_note', 2000), v_run, v_uid)
  returning id into v_id;
  perform public.studio_audit(p_project, v_uid, 'user', 'dialogue.requested', 'dialogue_proposal', v_id, jsonb_build_object('trigger', v_trigger, 'scene', p_scene_key));
  return query select v_id, false;
end $$;

create or replace function public.dialogue_cancel(p_project uuid, p_proposal uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'develop dialogue');
  update public.dialogue_proposals set
    status = case when status = 'queued' then 'cancelled' else status end,
    cancel_requested_at = now(), finished_at = case when status = 'queued' then now() else finished_at end
  where id = p_proposal and project_id = p_project and status in ('queued', 'drafting');
  if not found then raise exception 'That draft isn''t waiting or drafting.' using errcode = 'PT409'; end if;
  update public.agent_runs set status = 'cancelled', completed_at = now()
   where id = (select agent_run_id from public.dialogue_proposals where id = p_proposal) and status = 'queued';
end $$;

/** She accepts (the screenplay revision she saved), rejects, or records adopted lines. */
create or replace function public.dialogue_decide(p_project uuid, p_proposal uuid, p_action text, p_version uuid, p_note text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; d public.dialogue_proposals;
begin
  v_uid := public.studio_require(p_project, 3, 'decide on dialogue');
  select * into d from public.dialogue_proposals where id = p_proposal and project_id = p_project for update;
  if d.id is null then raise exception 'Draft not found.' using errcode = 'PT404'; end if;
  if p_action not in ('accept', 'adopt', 'reject', 'restore') then raise exception 'Unknown decision.' using errcode = '22023'; end if;
  if p_action in ('accept', 'adopt') then
    if d.status not in ('ready', 'superseded', 'accepted') then raise exception 'That draft isn''t ready.' using errcode = 'PT409'; end if;
    if p_version is null or not exists (select 1 from public.versions v join public.entities e on e.id = v.entity_id
                                         where v.id = p_version and e.project_id = p_project and e.kind = 'screenplay') then
      raise exception 'Save the script revision first.' using errcode = '22023';
    end if;
    update public.dialogue_proposals set status = 'superseded'
     where project_id = p_project and scene_key = d.scene_key and status = 'accepted' and id <> d.id;
    update public.dialogue_proposals set status = 'accepted', accepted_version_id = p_version, decided_at = now(), decided_by = v_uid,
           flags = flags || jsonb_build_object('decision', p_action, 'note', left(coalesce(p_note, ''), 500))
     where id = d.id;
  elsif p_action = 'reject' then
    if d.status not in ('ready', 'failed', 'superseded') then raise exception 'That draft can''t be rejected now.' using errcode = 'PT409'; end if;
    update public.dialogue_proposals set status = 'rejected', decided_at = now(), decided_by = v_uid,
           flags = flags || jsonb_build_object('note', left(coalesce(p_note, ''), 500)) where id = d.id;
  else
    -- Bring back an earlier (rejected or superseded) draft for review.
    if d.status not in ('rejected', 'superseded') then raise exception 'Only an earlier draft can be restored.' using errcode = 'PT409'; end if;
    update public.dialogue_proposals set status = 'ready', decided_at = null, decided_by = null where id = d.id;
  end if;
  perform public.studio_audit(p_project, v_uid, 'user', 'dialogue.' || p_action, 'dialogue_proposal', d.id,
    jsonb_build_object('scene', d.scene_key, 'version', p_version));
end $$;

/** SERVICE ROLE ONLY. Claims the next queued draft for a film: one draft at a time per film. */
create or replace function public.dialogue_claim(p_proposal uuid)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare d public.dialogue_proposals;
begin
  select * into d from public.dialogue_proposals where id = p_proposal for update;
  if d.id is null or d.status <> 'queued' or d.cancel_requested_at is not null then return false; end if;
  if exists (select 1 from public.dialogue_proposals where project_id = d.project_id and status = 'drafting' and id <> d.id
             and started_at > now() - interval '5 minutes') then
    return false;
  end if;
  update public.dialogue_proposals set status = 'drafting', started_at = now() where id = d.id;
  update public.agent_runs set status = 'running', started_at = now() where id = d.agent_run_id and status = 'queued';
  return true;
end $$;

/** SERVICE ROLE ONLY. Stores a finished draft with its research snapshot and provenance. */
create or replace function public.dialogue_complete(p_proposal uuid, p_result jsonb, p_snapshot jsonb, p_provenance jsonb, p_usage jsonb, p_cost_usd numeric, p_model text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare d public.dialogue_proposals; r public.agent_runs; v_snap uuid;
begin
  select * into d from public.dialogue_proposals where id = p_proposal for update;
  if d.id is null or d.status <> 'drafting' then raise exception 'Draft isn''t drafting.' using errcode = 'PT409'; end if;
  if jsonb_typeof(p_result) <> 'object' or length(p_result::text) > 120000 then raise exception 'Unexpected draft.' using errcode = '22023'; end if;
  select * into r from public.agent_runs where id = d.agent_run_id for update;
  if r.id is not null then
    perform public.studio_record_ai_charge(r, p_usage, p_cost_usd);
    update public.agent_runs set status = 'succeeded', completed_at = now(), model_name = left(p_model, 100), token_usage = coalesce(p_usage, '{}'::jsonb),
           output_payload = jsonb_build_object('proposal_id', d.id) where id = r.id;
  end if;
  insert into public.knowledge_snapshots (project_id, scene_key, items, created_by)
  values (d.project_id, d.scene_key, coalesce(p_snapshot, '[]'::jsonb), d.created_by) returning id into v_snap;
  -- Cancelled while drafting: keep the record, don't offer it.
  update public.dialogue_proposals set status = case when cancel_requested_at is not null then 'cancelled' else 'ready' end,
         result = p_result, snapshot_id = v_snap, provenance = coalesce(p_provenance, '{}'::jsonb), finished_at = now()
   where id = d.id;
  return v_snap;
end $$;

/** SERVICE ROLE ONLY. A failed draft: earlier drafts and the script are untouched. */
create or replace function public.dialogue_fail(p_proposal uuid, p_error text, p_usage jsonb, p_cost_usd numeric)
returns void
language plpgsql security definer set search_path = '' as $$
declare d public.dialogue_proposals; r public.agent_runs;
begin
  select * into d from public.dialogue_proposals where id = p_proposal for update;
  if d.id is null then return; end if;
  select * into r from public.agent_runs where id = d.agent_run_id for update;
  if r.id is not null then
    if coalesce(p_cost_usd, 0) > 0 then perform public.studio_record_ai_charge(r, p_usage, p_cost_usd); end if;
    update public.agent_runs set status = 'failed', completed_at = now(), error_message = left(coalesce(p_error, ''), 1000) where id = r.id;
  end if;
  update public.dialogue_proposals set status = 'failed', error = left(coalesce(p_error, 'Drafting failed.'), 1000), finished_at = now()
   where id = d.id and status in ('queued', 'drafting');
end $$;

/** SERVICE ROLE ONLY. Appends a script-partner review or a research-check note to a draft. */
create or replace function public.dialogue_note(p_proposal uuid, p_kind text, p_note jsonb, p_usage jsonb, p_cost_usd numeric, p_model text, p_requested_by uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare d public.dialogue_proposals; v_run uuid; r public.agent_runs;
begin
  select * into d from public.dialogue_proposals where id = p_proposal for update;
  if d.id is null then raise exception 'Draft not found.' using errcode = 'PT404'; end if;
  if p_kind not in ('review', 'research_check') or jsonb_typeof(p_note) <> 'object' or length(p_note::text) > 20000 then
    raise exception 'Unexpected note.' using errcode = '22023';
  end if;
  insert into public.agent_runs (project_id, domain, status, task_type, input_payload, model_provider, model_name, prompt_version, requested_by,
                                 started_at, completed_at, token_usage)
  values (d.project_id, 'writer', 'succeeded', 'dialogue_' || p_kind, jsonb_build_object('proposal_id', d.id), 'anthropic', left(p_model, 100),
          'script-partner-v1', p_requested_by, now(), now(), coalesce(p_usage, '{}'::jsonb))
  returning * into r;
  perform public.studio_record_ai_charge(r, p_usage, p_cost_usd);
  if p_kind = 'review' then
    update public.dialogue_proposals set reviews = (reviews || jsonb_build_array(p_note || jsonb_build_object('at', now()))) where id = d.id;
  else
    update public.dialogue_proposals set flags = flags || jsonb_build_object('research_check', p_note || jsonb_build_object('at', now())) where id = d.id;
  end if;
end $$;

/** Budget check for a one-off script-partner call (review or research check). */
create or replace function public.dialogue_note_allowed(p_project uuid, p_proposal uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := public.studio_require(p_project, 3, 'review dialogue');
  if not exists (select 1 from public.dialogue_proposals where id = p_proposal and project_id = p_project and result is not null) then
    raise exception 'Draft not found.' using errcode = 'PT404';
  end if;
  if public.studio_ai_budget_usd(p_project) - public.studio_ai_spent_month_usd(p_project) < 0.05 then
    raise exception 'The team has used this month''s AI budget. Ask your Executive Producer.' using errcode = 'PT402';
  end if;
  return v_uid;
end $$;

-- ---- Grants ------------------------------------------------------------------------------
do $$ declare f text;
begin
  foreach f in array array[
    'kb_owner_entity(uuid)', 'kb_research_save(uuid, uuid, jsonb)', 'kb_item_annotate(uuid, uuid, jsonb)', 'kb_source_archive(uuid, uuid)',
    'kb_collection_save(uuid, uuid, text, text)', 'kb_collection_archive(uuid, uuid)', 'kb_collection_member(uuid, uuid, uuid, uuid, boolean)',
    'kb_collection_items(uuid, uuid[])', 'kb_search(uuid, uuid[], text[], integer)', 'kb_feed_add(uuid, jsonb)', 'kb_feed_update(uuid, uuid, jsonb)',
    'kb_feed_request_refresh(uuid, uuid)', 'character_profile_save(uuid, uuid, integer, jsonb)',
    'character_proposal_decide(uuid, uuid, text, boolean, text)', 'character_talk_request(uuid, uuid, text)',
    'character_knowledge_save(uuid, uuid, jsonb)', 'character_knowledge_remove(uuid, uuid)', 'scene_context_save(uuid, text, jsonb)',
    'scene_snapshot_pin(uuid, text, uuid)', 'dialogue_settings_save(uuid, boolean, boolean)', 'dialogue_request(uuid, text, jsonb)',
    'dialogue_cancel(uuid, uuid)', 'dialogue_decide(uuid, uuid, text, uuid, text)', 'dialogue_note_allowed(uuid, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  foreach f in array array[
    'kb_feed_claim(uuid, boolean)', 'kb_feed_ingest(uuid, jsonb, jsonb)', 'kb_feed_fail(uuid, text, text)', 'kb_feed_unchanged(uuid)',
    'character_talk_complete(uuid, text, jsonb, jsonb, numeric, text)', 'dialogue_claim(uuid)',
    'dialogue_complete(uuid, jsonb, jsonb, jsonb, jsonb, numeric, text)', 'dialogue_fail(uuid, text, jsonb, numeric)',
    'dialogue_note(uuid, text, jsonb, jsonb, numeric, text, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
revoke all on function public.kb_txt(jsonb, text, integer) from public, anon;
revoke all on function public.kb_check_url(text) from public, anon;
revoke all on function public.character_fields_ok(jsonb) from public, anon;

commit;
