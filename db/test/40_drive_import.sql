-- STUDIO — Google Drive / treatment image import tests. Runs after 10_–30_ (reuses harness, users, film A).
\set ON_ERROR_STOP 1
\pset footer off
set client_min_messages = warning;

\set as_dir      'reset role; select tests.claims(''dir'');      set role authenticated;'
\set as_reviewer 'reset role; select tests.claims(''reviewer''); set role authenticated;'
\set as_outsider 'reset role; select tests.claims(''outsider''); set role authenticated;'
\set as_anon     'reset role; select set_config(''request.jwt.claims'', '''', false); set role anon;'
\set as_service  'reset role; select set_config(''request.jwt.claims'', '''', false); set role service_role;'
\set as_owner    'reset role;'

:as_owner
delete from tests.results;

:as_anon
select tests.throws($$select * from public.begin_asset_import(tests.v('mira'), 'a.png', 'image/png', 10,
  'https://drive.google.com/file/d/abc/view', 'Director (own work)')$$, '42501', 'anon cannot import');
:as_outsider
select tests.throws($$select * from public.begin_asset_import(tests.v('mira'), 'a.png', 'image/png', 10,
  'https://drive.google.com/file/d/abc/view', 'Director (own work)')$$, 'PT404', 'outsider cannot import (not found)');
:as_reviewer
select tests.throws($$select * from public.begin_asset_import(tests.v('mira'), 'a.png', 'image/png', 10,
  'https://drive.google.com/file/d/abc/view', 'Director (own work)')$$, '42501', 'review access cannot import');

:as_dir
select tests.throws($$select * from public.begin_asset_import(tests.v('mira'), 'a.gif', 'image/gif', 10,
  'https://drive.google.com/file/d/abc/view', 'Director (own work)')$$, '22023', 'only PNG/JPEG');
select tests.throws($$select * from public.begin_asset_import(tests.v('mira'), 'a.png', 'image/png', 10,
  'https://evil.example.com/x.png', 'Director (own work)')$$, '22023', 'source must be a Google Drive/Docs link');
select tests.throws($$select * from public.begin_asset_import(tests.v('mira'), 'a.png', 'image/png', 10,
  'https://drive.google.com.evil.com/x', 'Director (own work)')$$, '22023', 'look-alike Google host refused');
select tests.throws($$select * from public.begin_asset_import(tests.v('mira'), 'a.png', 'image/png', 10,
  'https://drive.google.com/file/d/abc/view', '   ')$$, '22023', 'attribution required');
select tests.throws($$select * from public.begin_asset_import(tests.v('mira'), 'a.png', 'image/png', 10,
  'https://drive.google.com/file/d/abc/view', 'Director (own work)', 'bad id/../x')$$, '22023', 'file id is validated');
select tests.throws($$select * from public.begin_asset_import(tests.v('mira'), 'a.png', 'image/png', 60*1024*1024,
  'https://drive.google.com/file/d/abc/view', 'Director (own work)')$$, '22023', 'size limit enforced');

select tests.put('imp1', (select asset_id from public.begin_asset_import(tests.v('mira'), 'Mira sketch.png', 'image/png', 4096,
  'https://docs.google.com/document/d/DOC123/edit', 'Director (own work)', 'DOC123', true)));
select tests.ok(tests.n($$select 1 from public.assets where id = tests.v('imp1')$$) = 0, 'pending import is not visible');
select tests.throws($$select public.complete_asset_upload(tests.v('imp1'), 4096, repeat('b', 64), 'image/png')$$,
  '42501', 'clients cannot complete an import');

:as_service
select public.complete_asset_upload(tests.v('imp1'), 4096, repeat('b', 64), 'image/png');

:as_dir
select tests.ok((select origin::text from public.assets where id = tests.v('imp1')) = 'import', 'asset is marked as an import');
select tests.ok((select provenance ->> 'file_id' from public.assets where id = tests.v('imp1')) = 'DOC123', 'provenance kept');
select tests.ok(tests.n($$select 1 from public.research_references where preview_asset_id = tests.v('imp1')
  and attribution = 'Director (own work)' and source_domain = 'docs.google.com'
  and observations like '%treatment%'$$) = 1, 'completed import became a credited reference with preview');
select tests.ok((select rights_status from public.research_references where preview_asset_id = tests.v('imp1'))
  = 'permission_granted', 'director''s own work is marked as permitted');

select tests.put('imp2', (select asset_id from public.begin_asset_import(tests.v('mira'), 'found.jpg', 'image/jpeg', 100,
  'https://drive.google.com/file/d/F1/view', 'Studio Ghibli (study)', 'F1')));
:as_service
select public.complete_asset_upload(tests.v('imp2'), 100, repeat('c', 64), 'image/jpeg');
:as_dir
select tests.ok((select rights_status from public.research_references where preview_asset_id = tests.v('imp2'))
  = 'unknown', 'other people''s work keeps rights unknown');

-- A normal artwork upload still does NOT create a reference.
select tests.put('art9', (select asset_id from public.begin_asset_upload(tests.v('mira'), 'm.png', 'image/png', 50)));
:as_service
select public.complete_asset_upload(tests.v('art9'), 50, repeat('d', 64), 'image/png');
:as_dir
select tests.ok(tests.n($$select 1 from public.research_references where preview_asset_id = tests.v('art9')$$) = 0,
  'plain artwork upload creates no reference');
:as_owner
select tests.ok(exists (select 1 from public.audit_events where target_id = tests.v('imp1') and event_type = 'asset.import_started'
  and actor_user_id = tests.v('dir')), 'import audited with the person who did it');

select n, case when passed then 'PASS' else 'FAIL' end as result, label, detail from tests.results order by n;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from tests.results;
do $$ begin
  if exists (select 1 from tests.results where not passed) then
    raise exception 'Drive import test suite FAILED';
  end if;
end $$;
