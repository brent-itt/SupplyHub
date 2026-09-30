import type { MovementKind } from "./types";

export const movementLabels: Record<MovementKind, string> = { stock_in: "Stock in", stock_out: "Stock out", adjustment: "Count adjustment" };
export function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(new Date(value));
}
export function formatNumber(value: number) { return value.toLocaleString("en-PH"); }
export function csvCell(value: unknown) {
  let text = String(value ?? "");
  // Prevent spreadsheet applications from treating a user-supplied cell as a formula.
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function toCsv(rows: unknown[][]) { return "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n"); }
