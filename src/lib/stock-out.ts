import { z } from "zod";
import type { StudentCheckoutLog } from "./student-stock-out";

export const checkoutSchema = z.object({
  reference: z.string().uuid(),
  student_log_id: z.string().uuid().optional(),
  scanned_barcode: z.string().trim().regex(/^[a-zA-Z0-9._-]{1,80}$/, "Scan a valid item barcode.").optional(),
  recipient_name: z.string().trim().min(2, "Enter the recipient's name.").max(160).regex(/^[^\r\n]+$/, "Enter the name on one line."),
  receipt_number: z.string().trim().min(1, "Enter the receipt number.").max(160).regex(/^[^\r\n]+$/, "Enter the receipt number on one line."),
  receipt_date: z.iso.date("Enter a valid receipt date.").refine(date => !date.startsWith("0000-"), "Enter a valid receipt date."),
  note: z.string().trim().min(3, "Enter the purpose of this stock out.").max(1500),
  lines: z.array(z.object({
    item_id: z.string().uuid(),
    quantity: z.number().int().min(1).max(2147483647),
    idempotency_key: z.string().uuid(),
  })).min(1).max(100),
}).superRefine(({ lines, student_log_id, scanned_barcode, note }, context) => {
  if (student_log_id && (!scanned_barcode || lines.length !== 1 || note.length > 500)) {
    context.addIssue({ code: "custom", message: "Scan the student's requested item and keep the staff note within 500 characters." });
  }
  if (new Set(lines.map(line => line.item_id)).size !== lines.length ||
      new Set(lines.map(line => line.idempotency_key)).size !== lines.length) {
    context.addIssue({ code: "custom", message: "Each item must appear only once in the cart." });
  }
});

export type Checkout = z.infer<typeof checkoutSchema>;
export type CheckoutResult = { completed: string[]; error?: string; canEdit: boolean; studentRemaining?: number };

export function matchesStudentCheckout(checkout: Checkout, log: StudentCheckoutLog): boolean {
  // Compare against the original request so a lost response can still be retried
  // after fulfillment changes. The RPC checks the live balance after retry lookup.
  return checkout.student_log_id === log.id && checkout.lines.length === 1 &&
    checkout.lines[0].item_id === log.item_id && checkout.lines[0].quantity > 0 && checkout.lines[0].quantity <= log.quantity &&
    checkout.recipient_name === log.student_name && checkout.receipt_number === log.receipt_number && checkout.receipt_date === log.receipt_date;
}

/** Retain receipt details in the existing immutable transaction ledger. */
export function stockOutNote(checkout: Checkout): string {
  return `Name: ${checkout.recipient_name}\nReceipt number: ${checkout.receipt_number}\nDate: ${checkout.receipt_date}\nPurpose: ${checkout.note}`;
}

/** Each item uses the existing atomic, idempotent stock movement. Report partial
 * completion explicitly; retries retain the original payload and keys. */
export async function issueCheckout(
  checkout: Checkout,
  issue: (line: Checkout["lines"][number]) => Promise<{ error: { message: string; code?: string } | null }>,
): Promise<CheckoutResult> {
  const completed: string[] = [];
  for (const line of checkout.lines) {
    try {
      const { error } = await issue(line);
      if (error) return {
        completed, error: error.message,
        canEdit: ["22023", "P0002", "42501"].includes(error.code ?? ""),
      };
      completed.push(line.item_id);
    } catch {
      return { completed, error: "The connection was interrupted. Retry this checkout to confirm the result safely.", canEdit: false };
    }
  }
  return { completed, canEdit: false };
}
