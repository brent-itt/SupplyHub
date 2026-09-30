import Link from "next/link";
import { redirect } from "next/navigation";
import { updatePasswordAction } from "@/app/actions";
import { PasswordUpdateForm } from "@/components/system/auth-forms";
import { PublicHeader } from "@/components/system/shell";
import { getAuthContext } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  return <div className="sys-auth-page">
    <PublicHeader profile={context.profile}/>
    <main className="sys-auth-card">
      <p className="sys-eyebrow">ACCOUNT RECOVERY</p>
      <h1>Choose a new password</h1>
      <p>Set a new password for {context.user.email}. Use at least 12 characters.</p>
      <PasswordUpdateForm action={updatePasswordAction}/>
      <p><Link className="sys-link" href="/login">Back to sign in</Link></p>
    </main>
  </div>;
}
