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
      const { data: log, error: readError } = await supabase.from("student_stock_out_logs").select("id,student_name,receipt_date,receipt_number,item_id,item_name,quantity,unit,status").eq("id", checkout.student_log_id).maybeSingle<StudentCheckoutLog>();
      if (readError || !log) return { completed: [], error: "Unable to load the student submission. Retry this checkout.", canEdit: false };
      if (!matchesStudentCheckout(checkout, log)) return { completed: [], error: "Checkout must match the student's submitted details, item, and quantity. Reopen it from the student log.", canEdit: false };
      const { error } = await supabase.rpc("process_student_stock_out", {
        p_id: log.id, p_decision: "issued", p_note: checkout.note, p_scanned_barcode: checkout.scanned_barcode,
      });
      if (error) return { completed: [], error: error.code === "PGRST202" ? "Barcode verification needs database setup. Ask the administrator to apply migration 202610040006." : error.message, canEdit: false };
      for (const path of ["/student-logs", "/scan", "/dashboard", "/inventory", "/reports", "/", `/inventory/${log.item_id}`]) revalidatePath(path);
      return { completed: [log.item_id], canEdit: false };
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
      for (const path of ["/scan", "/dashboard", "/inventory", "/reports", "/"]) revalidatePath(path);
      for (const id of result.completed) revalidatePath(`/inventory/${id}`);
    }
    return result;
  } catch (error) {
    return { completed: [], error: error instanceof UserFacingError ? error.message : "Unable to confirm checkout. Retry to check its status safely.", canEdit: error instanceof UserFacingError };
  }
}
