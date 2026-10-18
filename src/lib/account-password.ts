import type { SupabaseClient, User } from "@supabase/supabase-js";
import { hasVerifiedEmail } from "./email-verification";
import { passwordSchema } from "./validation";
import type { ActionResult } from "./types";

export const PASSWORD_CODE_LIFETIME_MS = 10 * 60 * 1000;
const invalidCode = "The verification code is incorrect, expired, or already used. Request a new code and try again.";

export async function sendAccountPasswordCode(
  user: User,
  admin: SupabaseClient,
  send: (email: string, code: string) => Promise<void>,
  now = Date.now(),
): Promise<ActionResult> {
  if (!hasVerifiedEmail(user)) return { error: "Verify your email before changing your password." };
  const lastSent = Date.parse(user.recovery_sent_at || "");
  if (Number.isFinite(lastSent) && now - lastSent < 60_000) return { error: "Wait one minute before requesting another code. Check your inbox for the latest email." };
  try {
    // Supabase owns generation, expiry and single-use verification. Only the
    // code is delivered; never return the code or recovery link to the browser.
    const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email: user.email! });
    if (error || data.user?.id !== user.id || !data.properties?.email_otp) throw new Error("Code unavailable");
    await send(user.email!, data.properties.email_otp);
    return { success: "A verification code was sent to your account email. It is valid for 10 minutes. Check your inbox and spam folder." };
  } catch {
    return { error: "The verification email could not be sent. Wait one minute and try again, or contact the Supplies Office." };
  }
}

export async function changeAccountPassword(
  user: User,
  data: FormData,
  verifier: SupabaseClient,
  browserSession: SupabaseClient,
  now = Date.now(),
): Promise<ActionResult> {
  const password = passwordSchema.safeParse(data.get("password"));
  if (!password.success) return { error: password.error.issues[0].message };
  if (data.get("confirm_password") !== password.data) return { error: "The passwords do not match." };
  const code = String(data.get("code") || "").trim();
  if (!/^\d{6,10}$/.test(code)) return { error: "Enter the verification code from your email." };
  const sentAt = Date.parse(user.recovery_sent_at || "");
  if (!hasVerifiedEmail(user) || !Number.isFinite(sentAt) || now < sentAt || now - sentAt > PASSWORD_CODE_LIFETIME_MS) return { error: invalidCode };
  try {
    // Use an isolated client so a rejected/mismatched code never replaces the
    // existing browser session. The email always comes from the authenticated user.
    const { data: verified, error } = await verifier.auth.verifyOtp({ email: user.email!, token: code, type: "recovery" });
    if (error || !verified.session || verified.user?.id !== user.id || verified.user.email !== user.email || !hasVerifiedEmail(verified.user)) return { error: invalidCode };
    const updated = await verifier.auth.updateUser({ password: password.data });
    if (updated.error) return { error: `${updated.error.code === "same_password" ? "Choose a password different from your current password." : "The new password could not be saved."} Request a new code before trying again.` };
    // Password updates revoke other sessions; keep this browser on the freshly
    // verified session instead of leaving its previous session cookies in place.
    try {
      const saved = await browserSession.auth.setSession(verified.session);
      if (saved.error) return { success: "Password updated. Sign out and sign in with your new password." };
    } catch {
      return { success: "Password updated. Sign out and sign in with your new password." };
    }
    return { success: "Password updated successfully. Use your new password the next time you sign in." };
  } catch {
    return { error: "The password change could not be confirmed. Try signing in with your new password; if it did not change, request a new code." };
  }
}

// The forgot-password action must not become a code-free alternative for a
// normal password login. Claims must come from Supabase getClaims(), not form data.
export function hasRecentEmailProof(claims: { sub?: string; amr?: unknown } | null | undefined, userId: string, now = Date.now()) {
  return claims?.sub === userId && Array.isArray(claims.amr) && claims.amr.some(entry =>
    entry && typeof entry === "object" && ["otp", "recovery"].includes(entry.method) &&
    typeof entry.timestamp === "number" && entry.timestamp * 1000 <= now && now - entry.timestamp * 1000 <= PASSWORD_CODE_LIFETIME_MS
  );
}
