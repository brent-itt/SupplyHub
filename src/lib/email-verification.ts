import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { z } from "zod";
import type { accountSchema } from "./validation";

export function hasVerifiedEmail(user: Pick<User, "email" | "email_confirmed_at"> | null | undefined) {
  return Boolean(user?.email && user.email_confirmed_at);
}

// No browser storage or cookies: the administrator and recipient may use
// different browsers, and verification must never replace the admin's session.
export function verificationClient(url: string, key: string) {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: "implicit" },
  });
}

export function verificationRedirect(siteUrl: string | undefined) {
  if (!siteUrl) throw new Error("Set NEXT_PUBLIC_SITE_URL before sending verification emails.");
  const url = new URL(siteUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error("NEXT_PUBLIC_SITE_URL must be an HTTP or HTTPS website address.");
  }
  return new URL("/verify-email?notice=check_sign_in", url.origin).href;
}

export async function createAccountWithVerification(
  account: z.infer<typeof accountSchema>,
  admin: SupabaseClient,
  actor: Pick<SupabaseClient, "rpc">,
  send: (email: string) => Promise<{ error: { message: string } | null }>,
) {
  const { data, error } = await admin.auth.admin.createUser({
    email: account.email, password: account.password, email_confirm: false,
    user_metadata: { full_name: account.full_name },
  });
  if (error || !data.user) throw new Error(error?.message || "The account could not be created.");
  const { error: accessError } = await actor.rpc("set_user_access", {
    p_user_id: data.user.id, p_role: account.role, p_is_active: true,
  });
  if (accessError) throw new Error("The account was created, but access could not be assigned. Update it in User access, then resend verification from the sign-in page.");
  try {
    const { error: sendError } = await send(account.email);
    if (sendError) throw sendError;
  } catch {
    throw new Error("The account was created, but the verification email could not be sent. Use Resend verification email on the sign-in page. If it keeps failing, check Supabase Auth email delivery settings.");
  }
  return `Account created for ${account.full_name}. A verification email has been requested for ${account.email}. They must confirm their email before signing in. Share the temporary password securely.`;
}
