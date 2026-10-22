import type { SupabaseClient } from "@supabase/supabase-js";

type VipBalance = { item_id: string; quantity: number; fulfilled_quantity: number };

export async function loadInventoryVipNeeds(supabase: SupabaseClient, itemIds: string[]): Promise<Map<string, number> | null> {
  const needs = new Map<string, number>();
  if (!itemIds.length) return needs;

  // Totals do not need the ranked queue view's joins and window functions.
  // Keep its pending/VIP filters and the same authenticated table RLS.
  // Read every page: truncating demand would overstate customer availability.
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabase.from("student_stock_out_logs")
      .select("item_id,quantity,fulfilled_quantity")
      .eq("status", "pending").not("vip_queued_at", "is", null).in("item_id", itemIds)
      .order("id").range(from, from + 499).returns<VipBalance[]>();
    if (error || !data) return null;
    for (const row of data) needs.set(row.item_id, (needs.get(row.item_id) ?? 0) + row.quantity - row.fulfilled_quantity);
    if (data.length < 500) return needs;
  }
}

export function newCustomerStock(currentStock: number, vipNeeded: number): number {
  return Math.max(0, currentStock - vipNeeded);
}
