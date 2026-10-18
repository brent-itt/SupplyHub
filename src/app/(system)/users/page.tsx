import { createAccountAction, updateUserAccessAction } from "@/app/actions";
import { CreateAccountForm, UserAccessForm } from "@/components/system/forms";
import { EmptyState, PageHeading } from "@/components/system/ui";
import { requireProfile } from "@/lib/auth";
import type { AccountProfile } from "@/lib/types";

export default async function UsersPage() {
  const { supabase, user } = await requireProfile(["super_admin"], "/users");
  const { data, error } = await supabase.rpc("get_account_profiles");
  if (error) throw new Error("Unable to load account verification status. Confirm that the pending account verification migration has been applied.");
  const profiles = (data ?? []) as AccountProfile[];

  return <>
    <PageHeading eyebrow="ACCESS CONTROL" title="User access" description="Create verified university accounts, activate pending users, and assign each person the access they need."/>
    <div className="sys-grid-2">
      <section className="sys-card"><h2>Create an account</h2><p className="sys-muted">New accounts stay inactive until the owner verifies their email. After verification, select Active and save access to approve the account.</p><CreateAccountForm action={createAccountAction}/></section>
      <section className="sys-card sys-card-flush">
        <div className="sys-card-header"><div><h2>University accounts</h2><p>{profiles.length} account profiles</p></div></div>
        {profiles.length ? <div className="sys-table-wrap"><table className="sys-table"><thead><tr><th>User</th><th>Current access</th><th>Change access</th></tr></thead><tbody>{profiles.map((profile) => <tr key={profile.id}><td><strong>{profile.full_name || "Name not set"}</strong><small>{profile.email}</small></td><td>{profile.role.replace("_", " ")}<small>{!profile.email_verified ? "Pending email verification" : profile.is_active ? "Active · Email verified" : "Inactive · Email verified"}</small></td><td><UserAccessForm action={updateUserAccessAction} user={profile} currentUserId={user.id}/></td></tr>)}</tbody></table></div> : <EmptyState title="No user profiles" description="Accounts created in Supabase Authentication appear here."/>}
      </section>
    </div>
  </>;
}
