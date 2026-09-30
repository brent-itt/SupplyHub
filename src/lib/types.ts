export type Role = "super_admin" | "admin" | "staff";
export type MovementKind = "stock_in" | "stock_out" | "adjustment";
export type RequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  created_at: string;
}

export interface Item {
  id: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  unit: string;
  location: string;
  quantity: number;
  low_stock_threshold: number;
  is_archived: boolean;
  show_on_landing: boolean;
  created_at: string;
  updated_at: string;
}

export interface InventoryTransaction {
  id: string;
  item_id: string;
  actor_id: string;
  kind: MovementKind;
  quantity_delta: number;
  balance_after: number;
  note: string;
  reference: string;
  request_id: string | null;
  idempotency_key: string;
  created_at: string;
}

export interface Requisition {
  id: string;
  item_id: string;
  requester_id: string;
  quantity: number;
  purpose: string;
  status: RequestStatus;
  reviewer_id: string | null;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export type ActionResult = { error?: string; success?: string };
export type FormAction = (state: ActionResult, data: FormData) => Promise<ActionResult>;

export function isManager(role: Role) {
  return role === "super_admin" || role === "admin";
}

export const roleLabels: Record<Role, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  staff: "Staff",
};
