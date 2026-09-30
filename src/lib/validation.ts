import { z } from "zod";

export const uuid = z.string().uuid("Choose a valid record.");
export const roleSchema = z.enum(["super_admin", "admin", "staff"]);
export const nonnegativeInteger = z.preprocess(value => typeof value === "string" && value.trim() !== "" ? Number(value) : value, z.number().int().min(0).max(2147483647));
export const positiveInteger = nonnegativeInteger.refine(value => value > 0, "Enter a quantity greater than zero.");
const text = (max: number) => z.string().trim().max(max);

export const itemSchema = z.object({
  item_id: z.union([uuid, z.literal("")]).default(""),
  sku: text(80).min(1, "A stock code is required.").regex(/^[a-zA-Z0-9._-]+$/, "Use letters, numbers, dots, hyphens, or underscores for the stock code."),
  name: text(160).min(1, "An item name is required."),
  description: text(2000),
  category: text(80).min(1, "Choose a category."),
  unit: text(40).min(1, "Enter a unit."),
  location: text(160),
  low_stock_threshold: nonnegativeInteger,
});

export const movementSchema = z.object({
  item_id: uuid,
  kind: z.enum(["stock_in", "stock_out", "adjustment"]),
  quantity: nonnegativeInteger,
  note: text(2000),
  reference: text(160),
  idempotency_key: uuid,
}).superRefine((value, context) => {
  if (value.kind !== "adjustment" && value.quantity === 0) context.addIssue({ code: "custom", path: ["quantity"], message: "Enter a quantity greater than zero." });
  if (value.kind === "adjustment" && !value.note) context.addIssue({ code: "custom", path: ["note"], message: "Explain why the stock count is being corrected." });
});

export const requestSchema = z.object({ item_id: uuid, quantity: positiveInteger, purpose: text(2000).min(3, "Describe what the supplies are needed for.") });
export const reviewSchema = z.object({ request_id: uuid, decision: z.enum(["approved", "rejected"]), review_note: text(2000) });
export const accessSchema = z.object({ user_id: uuid, role: roleSchema, is_active: z.enum(["true", "false"]).transform(value => value === "true") });
export const passwordSchema = z.string().min(12, "Use at least 12 characters.").max(128);
export const accountSchema = z.object({ email: z.string().trim().email().max(254), full_name: text(160).min(2), password: passwordSchema, role: roleSchema });

export function safeNext(value: unknown, fallback = "/dashboard") {
  if (typeof value !== "string" || !/^\/(?:dashboard|inventory|requisitions|reports|scan|users|account)(?:[/?]|$)/.test(value) || /[\\\r\n]/.test(value)) return fallback;
  return value;
}

export function pageNumber(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1 && number <= 100000 ? number : 1;
}

export function searchTerm(value: unknown) {
  return typeof value === "string" ? value.replace(/[^\p{L}\p{N} ._-]/gu, "").trim().slice(0, 100) : "";
}
