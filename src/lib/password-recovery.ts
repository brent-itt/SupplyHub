import type { SupabaseClient } from "@supabase/supabase-js";
import { hasVerifiedEmail } from "./email-verification";
import { safeNext } from "./validation";

export const recoveryErrorPath = "/forgot-password?notice=auth_error";

export function passwordRecoveryRedirect(siteUrl: string | undefined) {
  if (!siteUrl) throw new Error("Set NEXT_PUBLIC_SITE_URL before sending reset emails.");
  const url = new URL(siteUrl);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("NEXT_PUBLIC_SITE_URL must be an HTTP or HTTPS website address.");
  }
  return new URL("/auth/callback?next=%2Freset-password", url.origin).href;
}

export async function sendPasswordRecovery(client: SupabaseClient, email: string, siteUrl: string | undefined) {
  try {
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: passwordRecoveryRedirect(siteUrl) });
    if (error && error.code !== "user_not_found") throw error;
    return { success: "If an account uses that email, a password reset link is on its way. Use the newest email and check your spam folder." };
  } catch {
    return { error: "The reset email could not be sent. Wait a minute and try again, or ask the Supplies Office to check email delivery settings." };
  }
}

// URL fragments are available only in the browser. Verify them with Auth and
// persist the resulting session cookies before loading the protected form.
export async function completeAuthCallback(url: URL, client: SupabaseClient): Promise<string> {
  const query = url.searchParams;
  const hash = new URLSearchParams(url.hash.slice(1));
  const recovery = query.get("next") === "/reset-password" || query.get("type") === "recovery" || hash.get("type") === "recovery";
  const failure = recovery ? recoveryErrorPath : "/login?notice=auth_error";
  if (query.has("error") || query.has("error_code") || hash.has("error") || hash.has("error_code")) return failure;
  try {
    let result;
    const tokenHash = query.get("token_hash");
    const code = query.get("code");
    if (tokenHash) {
      if (query.get("type") !== "recovery" || tokenHash.length > 512) return failure;
      result = await client.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
    } else if (code) {
      // Keep links issued by the previous PKCE flow working in the requesting browser.
      const flowId = query.get("sb_flow_id");
      result = await client.auth.exchangeCodeForSession(code, flowId === null ? undefined : { flowId });
    } else {
      const access_token = hash.get("access_token");
      const refresh_token = hash.get("refresh_token");
      if (hash.get("type") !== "recovery" || !access_token || !refresh_token) return failure;
      result = await client.auth.setSession({ access_token, refresh_token });
    }
    if (result.error || !result.data.session || !hasVerifiedEmail(result.data.user)) return failure;
    return recovery ? "/reset-password" : safeNext(query.get("next"));
  } catch {
    return failure;
  }
}
