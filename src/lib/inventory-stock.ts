import type { SupabaseClient } from "@supabase/supabase-js";

type VipBalance = { item_id: string; remaining_quantity: number };

export async function loadInventoryVipNeeds(supabase: SupabaseClient, itemIds: string[]): Promise<Map<string, number> | null> {
  const needs = new Map<string, number>();
  if (!itemIds.length) return needs;

  // Read every queue page: truncating demand would overstate customer availability.
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabase.from("student_vip_queue")
      .select("item_id,remaining_quantity").in("item_id", itemIds)
      .order("id").range(from, from + 499).returns<VipBalance[]>();
    if (error || !data) return null;
    for (const row of data) needs.set(row.item_id, (needs.get(row.item_id) ?? 0) + row.remaining_quantity);
    if (data.length < 500) return needs;
  }
}

export function newCustomerStock(currentStock: number, vipNeeded: number): number {
  return Math.max(0, currentStock - vipNeeded);
}
