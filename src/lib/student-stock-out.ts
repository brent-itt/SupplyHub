import { z } from "zod";

export const studentStockOutSchema = z.object({
  submission_id: z.string().uuid(),
  student_name: z.string().trim().min(2, "Enter your full name.").max(160).regex(/^[^\r\n]+$/, "Enter your name on one line."),
  student_email: z.string().trim().email("Enter a valid email address.").max(254).toLowerCase(),
  receipt_date: z.iso.date("Enter a valid date.").refine(date => !date.startsWith("0000-"), "Enter a valid date."),
  receipt_number: z.string().trim().min(1, "Enter your receipt number.").max(160).regex(/^[^\r\n]+$/, "Enter your receipt number on one line."),
  item_id: z.string().uuid("Choose an item."),
  quantity: z.coerce.number().int().min(1, "Enter a quantity of at least 1.").max(2147483647),
});

export type StudentFormItem = { id: string; name: string; sku: string; unit: string };
export type StudentStockOutLog = {
  id: string; student_name: string; student_email: string | null; receipt_date: string; receipt_number: string;
  item_id: string; item_name: string; item_code: string; unit: string; quantity: number;
  status: "pending" | "issued" | "rejected"; created_at: string;
  processed_at: string | null; processed_by: string | null; processed_by_name: string | null;
  processing_note: string; transaction_id: string | null;
  scanned_barcode?: string | null;
  fulfilled_quantity: number; vip_queued_at: string | null;
};
export type StudentCheckoutLog = Pick<StudentStockOutLog, "id" | "student_name" | "student_email" | "receipt_date" | "receipt_number" | "item_id" | "item_name" | "quantity" | "unit" | "status" | "fulfilled_quantity" | "vip_queued_at">;
export type StudentSubmissionResult = { error?: string; submission?: Pick<StudentStockOutLog, "id" | "student_name" | "student_email" | "receipt_date" | "receipt_number" | "item_name" | "item_code" | "unit" | "quantity" | "status" | "vip_queued_at" | "fulfilled_quantity"> };
export type VipQueueEntry = StudentStockOutLog & { stock_quantity: number; is_archived: boolean; remaining_quantity: number; available_quantity: number; item_position: number; queue_position: number; reminder_position: number | null };

export function studentFormURL(site: string): string {
  const url = new URL(site);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Enter an HTTP or HTTPS website address.");
  return new URL("/form", url.origin).href;
}
