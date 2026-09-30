import Link from "next/link";
import { redirect } from "next/navigation";
import { PublicHeader } from "@/components/system/shell";
import { getAuthContext } from "@/lib/auth";
import { signOutAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function AccessPendingPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (context.profile?.is_active) redirect("/dashboard");
  return <div className="sys-auth-page">
    <PublicHeader profile={context.profile}/>
    <main className="sys-auth-card">
      <p className="sys-eyebrow">ACCOUNT ACCESS</p>
      <h1>Waiting for approval</h1>
      <p>Your account is registered as <strong>{context.user.email}</strong>. A Super Admin must activate it and assign your role before you can view supplies.</p>
      <p>Contact the Panpacific University Supplies Office if you need help.</p>
      <form action={signOutAction}><button className="sys-button" type="submit">Sign out</button></form>
      <p><Link className="sys-link" href="/">Return to home</Link></p>
    </main>
  </div>;
}
