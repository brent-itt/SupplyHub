"use server";

import { authorizeMutation } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { verificationClient } from "@/lib/email-verification";
import { sendAccountPasswordCode, changeAccountPassword } from "@/lib/account-password";
import { passwordCodeSender } from "@/lib/password-code-mail";
import type { ActionResult } from "@/lib/types";

export async function requestAccountPasswordCodeAction(): Promise<ActionResult> {
  try {
    const { user } = await authorizeMutation();
    const admin = createSupabaseAdmin();
    if (!admin) return { error: "Password verification is unavailable. Contact the Supplies Office." };
    return await sendAccountPasswordCode(user, admin, passwordCodeSender());
  } catch {
    return { error: "Unable to send a verification code. Sign in with an active account and try again, or contact the Supplies Office." };
  }
}

export async function changeAccountPasswordAction(_previous: ActionResult, data: FormData): Promise<ActionResult> {
  try {
    const { user, supabase } = await authorizeMutation();
    const config = getSupabaseConfig();
    if (!config) return { error: "Password verification is unavailable. Contact the Supplies Office." };
    return await changeAccountPassword(user, data, verificationClient(config.url, config.key), supabase);
  } catch {
    return { error: "Sign in with an active account before changing your password." };
  }
}
