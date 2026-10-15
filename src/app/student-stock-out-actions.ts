"use server";

import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authorizeMutation, UserFacingError } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { studentStockOutSchema, type StudentSubmissionResult } from "@/lib/student-stock-out";
import { studentFormQR } from "@/lib/student-form-qr";
import type { ActionResult } from "@/lib/types";

export async function submitStudentStockOut(_previous: StudentSubmissionResult, data: FormData): Promise<StudentSubmissionResult> {
  if (data.get("website")) return { error: "Unable to submit this form. Please try again." };
  const parsed = studentStockOutSchema.safeParse(Object.fromEntries(data));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const admin = createSupabaseAdmin();
  if (!admin) return { error: "Student submissions are not available yet. Please contact the Supplies Office." };
  try {
    const requestHeaders = await headers();
    // Vercel overwrites this header. Self-hosted/local instances share one bucket
    // instead of trusting a caller-supplied X-Forwarded-For value.
    const address = process.env.VERCEL === "1" ? requestHeaders.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() || "unknown" : "local-network";
    const rateKey = createHmac("sha256", process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!).update(`student-form:${address}`).digest("hex");
    const input = parsed.data;
    const { error } = await admin.rpc("submit_student_stock_out", {
      p_id: input.submission_id, p_student_name: input.student_name, p_student_email: input.student_email, p_receipt_date: input.receipt_date,
      p_receipt_number: input.receipt_number, p_item_id: input.item_id, p_quantity: input.quantity, p_rate_key: rateKey,
    });
    if (error) return { error: ["22023", "P0001"].includes(error.code) ? error.message : "Student submissions are temporarily unavailable. Please contact the Supplies Office." };
    const { data: saved, error: readError } = await admin.from("student_stock_out_logs")
      .select("id,student_name,student_email,receipt_date,receipt_number,item_name,item_code,unit,quantity,status,vip_queued_at,fulfilled_quantity").eq("id", input.submission_id).single();
    if (readError) return { error: "Your submission may have been saved. Retry this form to confirm it without creating a duplicate." };
    revalidatePath("/student-logs");
    revalidatePath("/vip-queue");
    revalidatePath("/scan");
    return { submission: saved };
  } catch {
    return { error: "Connection interrupted. Retry this form to confirm it without creating a duplicate." };
  }
}

export async function processStudentStockOut(_previous: ActionResult, data: FormData): Promise<ActionResult> {
  const parsed = z.object({ id: z.string().uuid(), decision: z.enum(["issued", "rejected"]), note: z.string().trim().max(500) }).safeParse(Object.fromEntries(data));
  if (!parsed.success) return { error: "Choose a valid submission and decision." };
  let checkoutURL: string | undefined;
  try {
    const { supabase } = await authorizeMutation(["staff", "admin", "super_admin"]);
    if (parsed.data.decision === "issued") {
      const { data: log, error } = await supabase.from("student_stock_out_logs").select("id,status").eq("id", parsed.data.id).maybeSingle();
      if (error || !log) return { error: "Unable to find this student submission. Refresh the log and try again." };
      if (log.status !== "pending") return { error: "This submission has already been processed. Refresh the student log." };
      checkoutURL = `/scan?student_log=${log.id}`;
    } else {
      const { error } = await supabase.rpc("process_student_stock_out", { p_id: parsed.data.id, p_decision: parsed.data.decision, p_note: parsed.data.note });
      if (error) return { error: ["22023", "42501", "P0002"].includes(error.code) ? error.message : "Unable to process this submission. Please try again." };
      revalidatePath("/student-logs");
      revalidatePath("/vip-queue");
      revalidatePath("/scan");
      return { success: "Remaining request rejected. Previously issued stock stays recorded." };
    }
  } catch (error) {
    return { error: error instanceof UserFacingError ? error.message : "Unable to confirm the result. Retry to check its status safely." };
  }
  // Next.js redirects must be outside the error handler.
  redirect(checkoutURL!);
}

export async function generateStudentFormQR(site: string): Promise<{ url?: string; image?: string; error?: string }> {
  try {
    await authorizeMutation(["staff", "admin", "super_admin"]);
    if (typeof site !== "string" || site.length > 2048) return { error: "Enter a valid website address." };
    return studentFormQR(site);
  } catch (error) {
    return { error: error instanceof UserFacingError ? error.message : "Enter a valid HTTP or HTTPS website address." };
  }
}
