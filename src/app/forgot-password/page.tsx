import Link from "next/link";
import { requestPasswordResetAction } from "@/app/actions";
import { PasswordResetRequestForm } from "@/components/system/auth-forms";
import { PublicHeader } from "@/components/system/shell";

export default function ForgotPasswordPage() {
  return <div className="sys-auth-page">
    <PublicHeader/>
    <main className="sys-auth-card">
      <p className="sys-eyebrow">ACCOUNT RECOVERY</p>
      <h1>Reset your password</h1>
      <p>Enter the email address used for your supplies account. If it is registered, we’ll send a reset link.</p>
      <PasswordResetRequestForm action={requestPasswordResetAction}/>
      <p><Link className="sys-link" href="/login">Back to sign in</Link></p>
    </main>
  </div>;
}
