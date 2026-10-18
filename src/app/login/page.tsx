import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signInAction } from "@/app/actions";
import { SignInForm } from "@/components/system/auth-forms";
import { PublicHeader } from "@/components/system/shell";
import { getAuthContext } from "@/lib/auth";
import { safeNext } from "@/lib/validation";

export const metadata: Metadata = {
  title: "Sign in | SupplyHub",
  robots: { index: false, follow: false },
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const next = safeNext(query.next);
  const context = await getAuthContext();
  if (context?.profile?.is_active) redirect(next);
  if (context) redirect("/access-pending");

  return <div className="sys-auth-page">
    <PublicHeader/>
    <main className="sys-auth-card">
      <p className="sys-eyebrow">SUPPLIES OFFICE · PORTAL</p>
      <h1>Sign in</h1>
      <p>Sign in with an account authorized by the Panpacific University Supplies Office.</p>
      {query.notice === "auth_error" && <div className="sys-notice sys-notice-error" role="alert"><p>The sign-in link expired or could not be verified. Request a fresh link and try again.</p></div>}
      {query.notice === "session_expired" && <div className="sys-notice" role="status"><p>Your session has expired. Please sign in again.</p></div>}
      {query.notice === "email_verified" && <div className="sys-notice sys-notice-success" role="status"><p>Email verified. Sign in with your email and password. New accounts also need activation by the Supplies Office before accessing the system.</p></div>}
      <SignInForm action={signInAction} next={next}/>
      <p><Link className="sys-link" href="/forgot-password">Forgot your password?</Link></p>
      <p><Link className="sys-link" href="/verify-email">Resend verification email</Link></p>
    </main>
  </div>;
}
