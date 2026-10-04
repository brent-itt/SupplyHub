import type { Requisition, RequisitionLog } from "./types";
import { formatRequestDate } from "./requisitions";

export const requisitionEventLabels: Record<RequisitionLog["event"], string> = {
  submitted: "Submitted", edited: "Edited", approved: "Approved", rejected: "Rejected", cancelled: "Cancelled",
};

const fields: [keyof Requisition, string][] = [
  ["requester_name", "Requestor"], ["request_date", "Request date"], ["item_name", "Item name"],
  ["item_code", "Item code"], ["quantity", "Quantity"], ["purpose", "Purpose"],
  ["status", "Status"], ["review_note", "Review note"],
];

export function requisitionChanges(log: RequisitionLog) {
  const display = (field: keyof Requisition, value: unknown) => {
    if (value == null || value === "") return "—";
    if (field === "request_date") return formatRequestDate(String(value));
    return String(value);
  };
  return fields.filter(([field]) => (log.before_data?.[field] ?? "") !== (log.after_data[field] ?? ""))
    .map(([field, label]) => ({ label, before: display(field, log.before_data?.[field]), after: display(field, log.after_data[field]) }));
}
