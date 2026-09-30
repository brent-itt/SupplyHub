import Link from "next/link";
import { PublicHeader } from "@/components/system/shell";
import { getSupabaseConfig } from "@/lib/supabase/config";

export default function SetupPage() {
  const connected = Boolean(getSupabaseConfig());
  return <div className="sys-auth-page">
    <PublicHeader/>
    <main className="sys-auth-card">
      <p className="sys-eyebrow">SUPPLIES OFFICE</p>
      <h1>{connected ? "Database setup needed" : "Connect the supplies system"}</h1>
      <p>{connected ? "The application has Supabase credentials. Apply the database migration and create the first super admin to continue." : "Add the Supabase project URL and publishable key to the app environment, then restart the development server."}</p>
      <ol>
        <li>Create a Supabase project and run <code>supabase/migrations/202609250001_supplies_system.sql</code> in its SQL Editor.</li>
        <li>Configure <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> in <code>.env.local</code>.</li>
        <li>Use the documented first admin setup in <code>supabase/README.md</code>. Keep the service role key server only.</li>
      </ol>
      <p className="sys-form-hint">After setup, return to <Link className="sys-link" href="/login">sign in</Link>.</p>
    </main>
  </div>;
}
