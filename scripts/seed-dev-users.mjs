// LOCAL DEVELOPMENT ONLY. Creates test accounts in a local Supabase (`supabase start`)
// and, given a project id, adds them as collaborators at each permission level so the
// boundaries can be tried in the browser. Refuses to run against a non-local URL.
//
//   node --env-file=.env.local scripts/seed-dev-users.mjs            # create accounts
//   node --env-file=.env.local scripts/seed-dev-users.mjs <projectId> # also add to project
//
// UNVERIFIED in this repository: requires @supabase/supabase-js to be installed.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
  console.error(`Refusing to seed ${url || "(unset)"} — local Supabase only.`);
  process.exit(1);
}
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const PASSWORD = "studio-dev-password";

const people = [
  { email: "director@studio.test" },
  { email: "viewer@studio.test", role: "collaborator", level: "view" },
  { email: "reviewer@studio.test", role: "collaborator", level: "review" },
  { email: "editor@studio.test", role: "collaborator", level: "edit" },
  { email: "committer@studio.test", role: "collaborator", level: "commit" },
  { email: "admin@studio.test", role: "collaborator", level: "view", admin: true },
  { email: "ep@studio.test", role: "executive_producer", level: "edit", spend: true },
  { email: "outsider@studio.test" },
];

const ids = {};
for (const p of people) {
  const { data, error } = await admin.auth.admin.createUser({ email: p.email, password: PASSWORD, email_confirm: true });
  if (error && !/already/i.test(error.message)) throw error;
  if (data?.user) ids[p.email] = data.user.id;
  else {
    const { data: list } = await admin.auth.admin.listUsers();
    ids[p.email] = list.users.find((u) => u.email === p.email)?.id;
  }
  console.log(`${p.email}  password: ${PASSWORD}`);
}

const projectId = process.argv[2];
if (projectId) {
  const rows = people
    .filter((p) => p.level)
    .map((p) => ({
      project_id: projectId,
      user_id: ids[p.email],
      project_role: p.role,
      access_level: p.level,
      can_admin: !!p.admin,
      can_authorize_spend: !!p.spend,
      accepted_at: new Date().toISOString(),
    }));
  const { error } = await admin.from("project_members").upsert(rows, { onConflict: "project_id,user_id" });
  if (error) throw error;
  console.log(`Added ${rows.length} collaborators to project ${projectId}.`);
}
