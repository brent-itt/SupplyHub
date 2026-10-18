import type { Metadata } from "next";
import { AuthCallback } from "@/components/system/auth-callback";

export const metadata: Metadata = {
  title: "Verify email link | SupplyHub",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function AuthCallbackPage() {
  return <div className="sys-auth-page"><main className="sys-auth-card">
    <h1>Verifying your link</h1>
    <AuthCallback/>
    <noscript>Enable JavaScript to complete verification, then reopen your email link.</noscript>
  </main></div>;
}
