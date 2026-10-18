import type { Metadata } from "next";
import Link from "next/link";
import { resendVerificationAction } from "@/app/actions";
import { VerificationEmailForm } from "@/components/system/auth-forms";
import { PublicHeader } from "@/components/system/shell";

export const metadata: Metadata = { title: "Verify your email | SupplyHub", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  return <div className="sys-auth-page">
    <PublicHeader/>
    <main className="sys-auth-card">
      <p className="sys-eyebrow">ACCOUNT VERIFICATION</p>
      <h1>Verify your email</h1>
      <p>Open the confirmation email sent to your address and follow its link before signing in. Check your spam folder too.</p>
      {query.notice === "auth_error" && <div className="sys-notice sys-notice-error" role="alert"><p>This verification link is invalid or has expired. Request a new email below, or sign in if you already verified your address.</p></div>}
      <VerificationEmailForm action={resendVerificationAction}/>
      <p><Link className="sys-link" href="/login">Back to sign in</Link></p>
    </main>
  </div>;
}
