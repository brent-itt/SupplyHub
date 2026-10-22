import { createAccountAction, removeAccountAction, updateUserAccessAction } from "@/app/actions";
import { CreateAccountForm, RemoveAccountForm, UserAccessForm } from "@/components/system/forms";
import { EmptyState, ErrorNotice, PageHeading } from "@/components/system/ui";
import { requireProfile } from "@/lib/auth";
import type { AccountProfile } from "@/lib/types";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { loadAccountProfiles } from "@/lib/account-removal";

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase, user } = await requireProfile(["super_admin"], "/users");
  const { notice } = await searchParams;
  const admin = createSupabaseAdmin();
  let profiles: AccountProfile[];
  if (admin) profiles = await loadAccountProfiles(supabase, admin);
  else {
    const { data, error } = await supabase.rpc("get_account_profiles");
    if (error) throw new Error("Unable to load account verification status. Confirm that the pending account verification migration has been applied.");
    profiles = (data ?? []) as AccountProfile[];
  }

  return <>
    <PageHeading eyebrow="ACCESS CONTROL" title="User access" description="Create verified university accounts, activate pending users, and assign each person the access they need."/>
    {notice === "removed" && <div className="sys-notice sys-notice-success" role="status"><p>Account removed. Sign-in access was revoked and existing activity records were preserved.</p></div>}
    {!admin && <ErrorNotice message="Account creation and removal need the server's Supabase secret key. Existing access settings are still available."/>}
    <div className="sys-grid-2">
      <section className="sys-card"><h2>Create an account</h2><p className="sys-muted">New accounts stay inactive until the owner verifies their email. After verification, select Active and save access to approve the account.</p><CreateAccountForm action={createAccountAction}/></section>
      <section className="sys-card sys-card-flush">
        <div className="sys-card-header"><div><h2>University accounts</h2><p>{profiles.length} account profiles. Removing an account revokes sign-in and preserves its activity history.</p></div></div>
        {profiles.length ? <div className="sys-table-wrap"><table className="sys-table"><thead><tr><th>User</th><th>Current access</th><th>Manage account</th></tr></thead><tbody>{profiles.map((profile) => <tr key={profile.id}><td><strong>{profile.full_name || "Name not set"}</strong><small>{profile.email}</small></td><td>{profile.role.replace("_", " ")}<small>{!profile.email_verified ? "Pending email verification" : profile.is_active ? "Active · Email verified" : "Inactive · Email verified"}</small></td><td><UserAccessForm action={updateUserAccessAction} user={profile} currentUserId={user.id}/>{admin && <RemoveAccountForm action={removeAccountAction} user={profile} currentUserId={user.id}/>}</td></tr>)}</tbody></table></div> : <EmptyState title="No user profiles" description="Accounts created in Supabase Authentication appear here."/>}
      </section>
    </div>
  </>;
}
