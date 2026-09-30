import { updatePasswordAction } from "@/app/actions";
import { PasswordUpdateForm } from "@/components/system/auth-forms";
import { PageHeading } from "@/components/system/ui";
import { requireProfile } from "@/lib/auth";
import { roleLabels } from "@/lib/types";

export default async function AccountPage() {
  const { profile, user } = await requireProfile(undefined, "/account");
  return <>
    <PageHeading eyebrow="ACCOUNT SETTINGS" title="My account" description="Review your account details and change your sign-in password."/>
    <div className="sys-grid-2">
      <section className="sys-card"><h2>Account details</h2><dl className="sys-detail-grid"><div><dt>Name</dt><dd>{profile.full_name || "Not set"}</dd></div><div><dt>Email</dt><dd>{user.email}</dd></div><div><dt>Role</dt><dd>{roleLabels[profile.role]}</dd></div><div><dt>Access</dt><dd>{profile.is_active ? "Active" : "Pending approval"}</dd></div></dl></section>
      <section className="sys-card"><h2>Change password</h2><p className="sys-muted">Choose a new password with at least 12 characters.</p><PasswordUpdateForm action={updatePasswordAction}/></section>
    </div>
  </>;
}
