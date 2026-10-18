"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";
import { authorizeMutation, getAuthContext, UserFacingError } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createAccountWithVerification, hasVerifiedEmail, verificationClient, verificationRedirect } from "@/lib/email-verification";
import { authStorageKey, isSessionCookie, rememberCookieName } from "@/lib/supabase/session-cookies";
import {
  accessSchema,
  accountSchema,
  editRequestSchema,
  emailAddressSchema,
  itemSchema,
  movementSchema,
  passwordSchema,
  publicVisibilitySchema,
  requestSchema,
  reviewSchema,
  safeNext,
  uuid,
} from "@/lib/validation";
import type { ActionResult, Role } from "@/lib/types";

const signInSchema = z.object({ email: emailAddressSchema, password: z.string().min(1).max(128) });
const emailSchema = z.object({ email: emailAddressSchema });

function formObject(data: FormData) {
  return Object.fromEntries(data.entries());
}

function validationMessage(error: z.ZodError) {
  return error.issues[0]?.message ?? "Check the information and try again.";
}

function errorMessage(error: unknown) {
  if (error instanceof UserFacingError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "The request could not be completed. Please try again.";
}

async function authorizedAction(
  roles: Role[],
  operation: (supabase: Awaited<ReturnType<typeof createSupabaseServer>>) => Promise<string>,
): Promise<ActionResult> {
  try {
    const { supabase } = await authorizeMutation(roles);
    return { success: await operation(supabase) };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export async function signInAction(_previous: ActionResult, data: FormData): Promise<ActionResult> {
  if (!getSupabaseConfig()) return { error: "The system is not connected yet. Ask the Supplies Office to complete setup." };
  const parsed = signInSchema.safeParse(formObject(data));
  if (!parsed.success) return { error: validationMessage(parsed.error) };

  const supabase = await createSupabaseServer({ rememberMe: data.get("remember_me") === "on" });
  const { data: signedIn, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error?.code === "email_not_confirmed") return { error: "Verify your email before signing in. Check your inbox or use Resend verification email below." };
  if (error) return { error: "Sign-in failed. Check your email and password." };
  if (!hasVerifiedEmail(signedIn.user)) {
    await supabase.auth.signOut({ scope: "local" });
    return { error: "Verify your email before signing in. Check your inbox or use Resend verification email below." };
  }

  const context = await getAuthContext();
  if (!context?.profile?.is_active) redirect("/access-pending");
  redirect(safeNext(data.get("next")));
}

export async function signOutAction() {
  const config = getSupabaseConfig();
  if (config) {
    try {
      const supabase = await createSupabaseServer();
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // Always clear this browser's session, even when Auth is unreachable.
    }
    const cookieStore = await cookies();
    const storageKey = authStorageKey(config.url);
    cookieStore.getAll().filter(({ name }) => isSessionCookie(name, storageKey) || name === rememberCookieName(storageKey))
      .forEach(({ name }) => cookieStore.set(name, "", { path: "/", maxAge: 0 }));
  }
  redirect("/login");
}

export async function requestPasswordResetAction(_previous: ActionResult, data: FormData): Promise<ActionResult> {
  if (!getSupabaseConfig()) return { error: "The system is not connected yet. Ask the Supplies Office to complete setup." };
  const parsed = emailSchema.safeParse(formObject(data));
  if (!parsed.success) return { error: validationMessage(parsed.error) };
  const supabase = await createSupabaseServer();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${siteUrl.replace(/\/$/, "")}/auth/callback?next=%2Freset-password`,
  });
  // Keep the response the same for unknown addresses to avoid account enumeration.
  return { success: "If an account uses that email, a password reset link is on its way." };
}

export async function resendVerificationAction(_previous: ActionResult, data: FormData): Promise<ActionResult> {
  const config = getSupabaseConfig();
  if (!config) return { error: "The system is not connected yet. Ask the Supplies Office to complete setup." };
  const parsed = emailSchema.safeParse(formObject(data));
  if (!parsed.success) return { error: validationMessage(parsed.error) };
  try {
    const { error } = await verificationClient(config.url, config.key).auth.resend({
      type: "signup", email: parsed.data.email,
      options: { emailRedirectTo: verificationRedirect(process.env.NEXT_PUBLIC_SITE_URL) },
    });
    if (error && error.code !== "user_not_found" && error.code !== "email_already_confirmed") {
      return { error: "The verification email could not be sent. Wait a minute and try again, or contact the Supplies Office." };
    }
    return { success: "If this email belongs to an account awaiting verification, a confirmation email has been requested. Check your inbox and spam folder." };
  } catch {
    return { error: "The verification email could not be sent. Contact the Supplies Office to check email delivery settings." };
  }
}

export async function updatePasswordAction(_previous: ActionResult, data: FormData): Promise<ActionResult> {
  const parsed = passwordSchema.safeParse(data.get("password"));
  if (!parsed.success) return { error: validationMessage(parsed.error) };
  const context = await getAuthContext();
  if (!context) return { error: "Your reset session has expired. Request a new password reset link." };
  const { error } = await context.supabase.auth.updateUser({ password: parsed.data });
  if (error) return { error: error.message };
  return { success: "Password updated. Use your new password the next time you sign in." };
}

export async function saveItemAction(_previous: ActionResult, data: FormData): Promise<ActionResult> {
  const parsed = itemSchema.safeParse(formObject(data));
  if (!parsed.success) return { error: validationMessage(parsed.error) };
  const result = await authorizedAction(["admin", "super_admin"], async (supabase) => {
    const { item_id, sku, name, description, category, unit, location, low_stock_threshold } = parsed.data;
    const { error } = await supabase.rpc("upsert_item", {
      p_id: item_id || null,
      p_sku: sku,
      p_name: name,
      p_description: description,
      p_category: category,
      p_unit: unit,
      p_location: location,
      p_low_stock_threshold: low_stock_threshold,
    });
    if (error) throw new Error(error.message);
    return item_id ? "Supply details saved." : "Supply item created. Record its opening stock when ready.";
  });
  if (result.success) {
    revalidatePath("/dashboard");
    revalidatePath("/inventory");
    if (parsed.data.item_id) revalidatePath(`/inventory/${parsed.data.item_id}`);
    revalidatePath("/reports");
    revalidatePath("/vip-queue");
    revalidatePath("/student-logs");
    revalidatePath("/scan");
  }
  return result;
}

export async function recordMovementAction(_previous: ActionResult, data: FormData): Promise<ActionResult> {
  const parsed = movementSchema.safeParse(formObject(data));
  if (!parsed.success) return { error: validationMessage(parsed.error) };
  const roles: Role[] = parsed.data.kind === "stock_out" ? ["staff", "admin", "super_admin"] : ["admin", "super_admin"];
  const result = await authorizedAction(roles, async (supabase) => {
    const { item_id, kind, quantity, note, reference, idempotency_key } = parsed.data;
    const { error } = await supabase.rpc("stock_movement", {
      p_item_id: item_id,
      p_kind: kind,
      p_quantity: quantity,
      p_note: note,
      p_reference: reference,
      p_idempotency_key: idempotency_key,
    });
    if (error) throw new Error(error.message);
    return "Stock transaction recorded.";
  });
  if (result.success) {
    revalidatePath("/dashboard");
    revalidatePath("/inventory");
    revalidatePath(`/inventory/${parsed.data.item_id}`);
    revalidatePath("/reports");
    revalidatePath("/vip-queue");
    revalidatePath("/student-logs");
    revalidatePath("/scan");
    revalidatePath("/");
  }
  return result;
}

export async function setPublicVisibilityAction(_previous: ActionResult, data: FormData): Promise<ActionResult> {
  const parsed = publicVisibilitySchema.safeParse(formObject(data));
  if (!parsed.success) return { error: validationMessage(parsed.error) };
  const result = await authorizedAction(["admin", "super_admin"], async (supabase) => {
    const { error } = await supabase.rpc("set_item_public_visibility", {
      p_item_id: parsed.data.item_id,
      p_show_on_landing: parsed.data.show_on_landing,
      p_public_quantity: parsed.data.public_quantity,
    });
    if (error) throw new Error(error.message);
    return parsed.data.show_on_landing ? "Public stock display saved." : "Supply hidden from the public stock list.";
  });
  if (result.success) {
    revalidatePath("/");
    revalidatePath("/inventory");
    revalidatePath(`/inventory/${parsed.data.item_id}`);
  }
  return result;
}

export async function archiveItemAction(_previous: ActionResult, data: FormData): Promise<ActionResult> {
  const parsed = z.object({ item_id: uuid, archived: z.enum(["true", "false"]).transform((value) => value === "true") }).safeParse(formObject(data));
  if (!parsed.success) return { error: validationMessage(parsed.error) };
  const result = await authorizedAction(["admin", "super_admin"], async (supabase) => {
    const { error } = await supabase.rpc("archive_item", { p_item_id: parsed.data.item_id, p_archived: parsed.data.archived });
    if (error) throw new Error(error.message);
    return parsed.data.archived ? "Supply archived." : "Supply restored.";
  });
  if (result.success) {
    revalidatePath("/dashboard");
    revalidatePath("/inventory");
    revalidatePath(`/inventory/${parsed.data.item_id}`);
    revalidatePath("/reports");
    revalidatePath("/vip-queue");
    revalidatePath("/student-logs");
    revalidatePath("/scan");
  }
  return result;
}

export async function createRequisitionAction(_previous: ActionResult, data: FormData): Promise<ActionResult> {
  const parsed = requestSchema.safeParse(formObject(data));
  if (!parsed.success) return { error: validationMessage(parsed.error) };
  const result = await authorizedAction(["staff"], async (supabase) => {
    const { error } = await supabase.rpc("create_requisition", {
      p_item_id: parsed.data.item_id,
      p_quantity: parsed.data.quantity,
      p_purpose: parsed.data.purpose,
      p_requester_name: parsed.data.requester_name,
      p_request_date: parsed.data.request_date,
    });
    if (error) throw new Error(error.message);
    return "Requisition submitted for review.";
  });
  if (result.success) {
    revalidatePath("/dashboard");
    revalidatePath("/requisitions");
  }
  return result;
}

export async function updateRequisitionAction(_previous: ActionResult, data: FormData): Promise<ActionResult> {
  const parsed = editRequestSchema.safeParse(formObject(data));
  if (!parsed.success) return { error: validationMessage(parsed.error) };
  const result = await authorizedAction(["staff", "admin", "super_admin"], async (supabase) => {
    const { request_id, item_id, quantity, purpose, requester_name, request_date, expected_version } = parsed.data;
    const { error } = await supabase.rpc("update_requisition", {
      p_request_id: request_id, p_item_id: item_id, p_quantity: quantity, p_purpose: purpose,
      p_requester_name: requester_name, p_request_date: request_date, p_expected_version: expected_version,
    });
    if (error) throw new Error(error.message);
    return "Requisition updated.";
  });
  if (result.success) {
    revalidatePath("/dashboard");
    revalidatePath("/requisitions");
    redirect("/requisitions?notice=updated");
  }
  return result;
}

export async function reviewRequisitionAction(_previous: ActionResult, data: FormData): Promise<ActionResult> {
  const parsed = reviewSchema.safeParse(formObject(data));
  if (!parsed.success) return { error: validationMessage(parsed.error) };
  const result = await authorizedAction(["admin", "super_admin"], async (supabase) => {
    const { error } = await supabase.rpc("review_requisition", {
      p_request_id: parsed.data.request_id,
      p_decision: parsed.data.decision,
      p_note: parsed.data.review_note,
      p_expected_version: parsed.data.expected_version,
    });
    if (error) throw new Error(error.message);
    return parsed.data.decision === "approved" ? "Requisition approved and stock issued." : "Requisition rejected.";
  });
  if (result.success) {
    revalidatePath("/dashboard");
    revalidatePath("/requisitions");
    revalidatePath("/inventory");
    revalidatePath("/reports");
    revalidatePath("/vip-queue");
    revalidatePath("/student-logs");
    revalidatePath("/scan");
  }
  return result;
}

export async function cancelRequisitionAction(_previous: ActionResult, data: FormData): Promise<ActionResult> {
  const parsed = z.object({ request_id: uuid }).safeParse(formObject(data));
  if (!parsed.success) return { error: validationMessage(parsed.error) };
  const result = await authorizedAction(["staff", "admin", "super_admin"], async (supabase) => {
    const { error } = await supabase.rpc("cancel_requisition", { p_request_id: parsed.data.request_id });
    if (error) throw new Error(error.message);
    return "Pending requisition cancelled.";
  });
  if (result.success) {
    revalidatePath("/dashboard");
    revalidatePath("/requisitions");
  }
  return result;
}

export async function updateUserAccessAction(_previous: ActionResult, data: FormData): Promise<ActionResult> {
  const parsed = accessSchema.safeParse(formObject(data));
  if (!parsed.success) return { error: validationMessage(parsed.error) };
  const result = await authorizedAction(["super_admin"], async (supabase) => {
    const { error } = await supabase.rpc("set_user_access", {
      p_user_id: parsed.data.user_id,
      p_role: parsed.data.role,
      p_is_active: parsed.data.is_active,
    });
    if (error) throw new Error(error.message);
    return "User access updated.";
  });
  if (result.success) revalidatePath("/users");
  return result;
}

export async function createAccountAction(_previous: ActionResult, data: FormData): Promise<ActionResult> {
  const parsed = accountSchema.safeParse(formObject(data));
  if (!parsed.success) return { error: validationMessage(parsed.error) };
  const result = await authorizedAction(["super_admin"], async (supabase) => {
    const admin = createSupabaseAdmin();
    if (!admin) throw new Error("Account creation needs SUPABASE_SECRET_KEY. Add it to the server environment, then restart the app.");
    const config = getSupabaseConfig()!;
    const emailRedirectTo = verificationRedirect(process.env.NEXT_PUBLIC_SITE_URL);
    const mailer = verificationClient(config.url, config.key);
    try {
      return await createAccountWithVerification(parsed.data, admin, supabase,
        email => mailer.auth.resend({ type: "signup", email, options: { emailRedirectTo } }));
    } finally {
      // Partial creation also needs to appear in the user list for recovery.
      revalidatePath("/users");
    }
  });
  return result;
}
