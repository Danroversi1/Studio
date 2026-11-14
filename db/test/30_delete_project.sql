-- STUDIO — film deletion tests. Runs after 10_ and 20_ (reuses tests.* harness and users).
\set ON_ERROR_STOP 1
\pset footer off
set client_min_messages = warning;

\set as_dir       'reset role; select tests.claims(''dir'');        set role authenticated;'
\set as_editor    'reset role; select tests.claims(''editor'');     set role authenticated;'
\set as_committer 'reset role; select tests.claims(''committer'');  set role authenticated;'
\set as_admin     'reset role; select tests.claims(''admin_only''); set role authenticated;'
\set as_outsider  'reset role; select tests.claims(''outsider'');   set role authenticated;'
\set as_anon      'reset role; select set_config(''request.jwt.claims'', '''', false); set role anon;'
\set as_service   'reset role; select set_config(''request.jwt.claims'', '''', false); set role service_role;'
\set as_owner     'reset role;'

:as_owner
delete from tests.results;

:as_dir
select tests.put('D', public.create_project('Doomed Film'));
select tests.put('d_story', (select id from public.entities where project_id = tests.v('D') and kind = 'story'));
:as_owner
insert into public.project_members (project_id, user_id, project_role, access_level, can_admin, accepted_at)
select tests.v('D'), tests.v(k), 'collaborator', l::public.access_level, a, now()
from (values ('editor','edit',false), ('committer','commit',false), ('admin_only','view',true)) t(k,l,a);

:as_anon
select tests.throws($$select public.delete_project(tests.v('D'), 'Doomed Film')$$, '42501', 'anon cannot delete films');
:as_outsider
select tests.throws($$select public.delete_project(tests.v('D'), 'Doomed Film')$$, 'PT404', 'outsider cannot delete (not found)');
:as_editor
select tests.throws($$select public.delete_project(tests.v('D'), 'Doomed Film')$$, '42501', 'editor cannot delete');
:as_committer
select tests.throws($$select public.delete_project(tests.v('D'), 'Doomed Film')$$, '42501', 'commit without director authority cannot delete');
:as_admin
select tests.throws($$select public.delete_project(tests.v('D'), 'Doomed Film')$$, '42501', 'admin alone cannot delete the director''s film');
select tests.throws($$update public.projects set status = 'deleted' where id = tests.v('D')$$, '42501', 'nobody can delete by direct update');
:as_dir
select tests.throws($$select public.delete_project(tests.v('D'), 'Wrong title')$$, '22023', 'wrong confirmation title is refused');
select tests.ok((select status::text from public.projects where id = tests.v('D')) = 'active', 'refused delete changed nothing');
select tests.lives($$select public.delete_project(tests.v('D'), '  doomed film ')$$, 'director-admin deletes with the title (case and spaces ignored)');
select tests.ok(tests.n($$select 1 from public.projects where id = tests.v('D')$$) = 0, 'deleted film disappears for its director');
select tests.ok(tests.n($$select 1 from public.entities where project_id = tests.v('D')$$) = 0, 'its items disappear too');
select tests.throws($$select public.create_revision(tests.v('d_story'), '{"body":"after delete"}')$$, 'PT404', 'deleted film cannot be edited');
select tests.ok(tests.n($$select 1 from public.projects where id = tests.v('A')$$) = 1, 'other films are unaffected');
:as_editor
select tests.ok(tests.n($$select 1 from public.projects where id = tests.v('D')$$) = 0, 'deleted film disappears for collaborators');
:as_owner
select tests.ok(exists (select 1 from public.entities where project_id = tests.v('D')), 'nothing was destroyed (soft delete)');
select tests.ok(exists (select 1 from public.audit_events where target_id = tests.v('D') and event_type = 'project.deleted'
                        and actor_user_id = tests.v('dir')), 'deletion audited with the person who did it');
:as_dir
select tests.throws($$select public.restore_project(tests.v('D'))$$, '42501', 'clients cannot restore films');
:as_service
select public.restore_project(tests.v('D'));
:as_dir
select tests.ok(tests.n($$select 1 from public.projects where id = tests.v('D')$$) = 1, 'trusted restore brings the film back');

:as_owner
select n, case when passed then 'PASS' else 'FAIL' end as result, label, detail from tests.results order by n;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from tests.results;
do $$ begin
  if exists (select 1 from tests.results where not passed) then
    raise exception 'Film deletion test suite FAILED';
  end if;
end $$;
