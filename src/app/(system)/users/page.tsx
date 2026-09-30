import { createAccountAction, updateUserAccessAction } from "@/app/actions";
import { CreateAccountForm, UserAccessForm } from "@/components/system/forms";
import { EmptyState, PageHeading } from "@/components/system/ui";
import { requireProfile } from "@/lib/auth";
import type { Profile } from "@/lib/types";

export default async function UsersPage() {
  const { supabase, user } = await requireProfile(["super_admin"], "/users");
  const { data, error } = await supabase.from("profiles").select("*").order("created_at", { ascending: false }).limit(500);
  if (error) throw new Error("Unable to load user accounts.");
  const profiles = (data ?? []) as Profile[];

  return <>
    <PageHeading eyebrow="ACCESS CONTROL" title="User access" description="Create verified university accounts, activate pending users, and assign each person the access they need."/>
    <div className="sys-grid-2">
      <section className="sys-card"><h2>Create an account</h2><p className="sys-muted">Only create accounts for verified university users. The account owner can change their password after signing in.</p><CreateAccountForm action={createAccountAction}/></section>
      <section className="sys-card sys-card-flush">
        <div className="sys-card-header"><div><h2>University accounts</h2><p>{profiles.length} account profiles</p></div></div>
        {profiles.length ? <div className="sys-table-wrap"><table className="sys-table"><thead><tr><th>User</th><th>Current access</th><th>Change access</th></tr></thead><tbody>{profiles.map((profile) => <tr key={profile.id}><td><strong>{profile.full_name || "Name not set"}</strong><small>{profile.email}</small></td><td>{profile.role.replace("_", " ")}<small>{profile.is_active ? "Active" : "Waiting for approval"}</small></td><td><UserAccessForm action={updateUserAccessAction} user={profile} currentUserId={user.id}/></td></tr>)}</tbody></table></div> : <EmptyState title="No user profiles" description="Accounts created in Supabase Authentication appear here."/>}
      </section>
    </div>
  </>;
}
