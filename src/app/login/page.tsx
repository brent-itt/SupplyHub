import Link from "next/link";
import { redirect } from "next/navigation";
import { signInAction } from "@/app/actions";
import { SignInForm } from "@/components/system/auth-forms";
import { PublicHeader } from "@/components/system/shell";
import { getAuthContext } from "@/lib/auth";
import { safeNext } from "@/lib/validation";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const next = safeNext(query.next);
  const context = await getAuthContext();
  if (context?.profile?.is_active) redirect(next);
  if (context) redirect("/access-pending");

  return <div className="sys-auth-page">
    <PublicHeader/>
    <main className="sys-auth-card">
      <p className="sys-eyebrow">PANPACIFIC UNIVERSITY</p>
      <h1>Welcome back</h1>
      <p>Sign in with an account authorized by the Panpacific University Supplies Office.</p>
      {query.notice === "auth_error" && <div className="sys-notice sys-notice-error" role="alert"><p>The sign-in link expired or could not be verified. Request a fresh link and try again.</p></div>}
      <SignInForm action={signInAction} next={next}/>
      <p><Link className="sys-link" href="/forgot-password">Forgot your password?</Link></p>
    </main>
  </div>;
}
