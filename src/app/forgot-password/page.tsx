import Link from "next/link";
import { requestPasswordResetAction } from "@/app/actions";
import { PasswordResetRequestForm } from "@/components/system/auth-forms";
import { PublicHeader } from "@/components/system/shell";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  return <div className="sys-auth-page">
    <PublicHeader/>
    <main className="sys-auth-card">
      <p className="sys-eyebrow">ACCOUNT RECOVERY</p>
      <h1>Reset your password</h1>
      {query.notice === "auth_error" && <div className="sys-notice sys-notice-error" role="alert"><p>This password reset link could not be verified. It may have expired or already been used. Request a new link below and open the newest email. Older links must be opened in the same browser that requested them.</p></div>}
      <p>Enter the email address used for your supplies account. If it is registered, we’ll send a reset link.</p>
      <PasswordResetRequestForm action={requestPasswordResetAction}/>
      <p><Link className="sys-link" href="/login">Back to sign in</Link></p>
    </main>
  </div>;
}
