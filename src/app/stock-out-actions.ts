"use server";

import { revalidatePath } from "next/cache";
import { authorizeMutation, UserFacingError } from "@/lib/auth";
import { checkoutSchema, issueCheckout, stockOutNote, matchesStudentCheckout, type CheckoutResult } from "@/lib/stock-out";
import type { StudentCheckoutLog } from "@/lib/student-stock-out";

export async function checkoutStockAction(input: unknown): Promise<CheckoutResult> {
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) return { completed: [], error: parsed.error.issues[0].message, canEdit: true };
  try {
    const { supabase } = await authorizeMutation(["staff", "admin", "super_admin"]);
    const checkout = parsed.data;
    if (checkout.student_log_id) {
      const { data: log, error: readError } = await supabase.from("student_stock_out_logs").select("id,student_name,student_email,receipt_date,receipt_number,item_id,item_name,quantity,unit,status,fulfilled_quantity,vip_queued_at").eq("id", checkout.student_log_id).maybeSingle<StudentCheckoutLog>();
      if (readError || !log) return { completed: [], error: "Unable to load the student submission. Retry this checkout.", canEdit: false };
      if (!matchesStudentCheckout(checkout, log)) return { completed: [], error: "Checkout must match the student's submitted details, item, and quantity. Reopen it from the student log.", canEdit: false };
      const { error } = await supabase.rpc("process_student_stock_out", {
        p_id: log.id, p_decision: "issued", p_note: checkout.note, p_scanned_barcode: checkout.scanned_barcode,
        p_quantity: checkout.lines[0].quantity, p_idempotency_key: checkout.lines[0].idempotency_key,
      });
      if (error) return { completed: [], error: error.code === "PGRST202" ? "VIP collections need database setup. Ask the administrator to apply migration 202610150001_student_vip_queue.sql." : error.message, canEdit: error.code === "22023" };
      const { data: updated } = await supabase.from("student_stock_out_logs").select("quantity,fulfilled_quantity").eq("id", log.id).single();
      for (const path of ["/student-logs", "/vip-queue", "/scan", "/dashboard", "/inventory", "/reports", "/", `/inventory/${log.item_id}`]) revalidatePath(path);
      return { completed: [log.item_id], canEdit: false, ...(updated ? { studentRemaining: updated.quantity - updated.fulfilled_quantity } : {}) };
    }
    const result = await issueCheckout(checkout, async (line) => {
      const { error } = await supabase.rpc("stock_movement", {
        p_item_id: line.item_id, p_kind: "stock_out", p_quantity: line.quantity,
        p_note: stockOutNote(checkout), p_reference: `POS-${checkout.reference}`,
        p_idempotency_key: line.idempotency_key,
      });
      return { error };
    });
    if (result.completed.length) {
      for (const path of ["/scan", "/dashboard", "/inventory", "/reports", "/student-logs", "/vip-queue", "/"]) revalidatePath(path);
      for (const id of result.completed) revalidatePath(`/inventory/${id}`);
    }
    return result;
  } catch (error) {
    return { completed: [], error: error instanceof UserFacingError ? error.message : "Unable to confirm checkout. Retry to check its status safely.", canEdit: error instanceof UserFacingError };
  }
}
