import { changeAccountPasswordAction, requestAccountPasswordCodeAction } from "@/app/account-password-actions";
import { AccountPasswordForm } from "@/components/system/account-password-form";
import { PageHeading } from "@/components/system/ui";
import { requireProfile } from "@/lib/auth";
import { roleLabels } from "@/lib/types";

export default async function AccountPage() {
  const { profile, user } = await requireProfile(undefined, "/account");
  return <>
    <PageHeading eyebrow="ACCOUNT SETTINGS" title="My account" description="Review your account details and change your sign-in password."/>
    <div className="sys-grid-2">
      <section className="sys-card"><h2>Account details</h2><dl className="sys-detail-grid"><div><dt>Name</dt><dd>{profile.full_name || "Not set"}</dd></div><div><dt>Email</dt><dd>{user.email}</dd></div><div><dt>Role</dt><dd>{roleLabels[profile.role]}</dd></div><div><dt>Access</dt><dd>{profile.is_active ? "Active" : "Pending approval"}</dd></div></dl></section>
      <section className="sys-card"><h2>Change password</h2><p className="sys-muted">Confirm the change with a code sent to {user.email}.</p><AccountPasswordForm requestCode={requestAccountPasswordCodeAction} updatePassword={changeAccountPasswordAction}/></section>
    </div>
  </>;
}
