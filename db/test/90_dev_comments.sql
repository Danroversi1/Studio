-- STUDIO — developer comments. Runs after 10_–80_.
\set ON_ERROR_STOP 1
\pset footer off
set client_min_messages = warning;

\set as_dir   'reset role; select tests.claims(''dir'');   set role authenticated;'
\set as_ep    'reset role; select tests.claims(''ep'');    set role authenticated;'
\set as_anon  'reset role; select set_config(''request.jwt.claims'', '''', false); set role anon;'
\set as_owner 'reset role;'

:as_owner
delete from tests.results;
insert into public.studio_developers (user_id) values (tests.v('ep')) on conflict do nothing;

:as_dir
select tests.ok(public.is_studio_developer() = false, 'the director is not a developer');
select tests.throws($$select public.add_dev_comment('/projects', '{}', 'hi')$$, '42501', 'non-developers cannot comment');
:as_anon
select tests.throws($$select public.add_dev_comment('/projects', '{}', 'hi')$$, '42501', 'anon cannot comment');
:as_ep
select tests.ok(public.is_studio_developer(), 'listed developer is recognized');
select tests.put('c1', public.add_dev_comment('/projects/x/add', '{"x_pct":40,"y_px":300,"selector":"#story"}', 'Make the buttons bigger'));
select tests.throws($$select public.add_dev_comment('no-slash', '{}', 'x')$$, '23514', 'path must be a site path');
select tests.throws($$insert into public.studio_developers (user_id) values (tests.v('dir'))$$, '42501', 'nobody can make themselves a developer');
select public.set_dev_comment_status(tests.v('c1'), 'resolved', 'Done in the next deploy');
select tests.ok((select status = 'resolved' and resolution_note like 'Done%' from public.dev_comments where id = tests.v('c1')), 'resolved with a note');
:as_dir
select tests.ok(tests.n($$select 1 from public.dev_comments$$) = 0, 'the director cannot see developer comments');
select tests.throws(format($q$select public.delete_dev_comment(%L)$q$, tests.v('c1')), '42501', 'non-developers cannot delete');
:as_ep
select public.delete_dev_comment(tests.v('c1'));
select tests.ok(tests.n($$select 1 from public.dev_comments where id = tests.v('c1')$$) = 0, 'developer deleted the comment');
:as_owner
delete from public.studio_developers where user_id = tests.v('ep');

select n, case when passed then 'PASS' else 'FAIL' end as result, label, detail from tests.results order by n;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from tests.results;
do $$ begin
  if exists (select 1 from tests.results where not passed) then
    raise exception 'Dev comments test suite FAILED';
  end if;
end $$;
