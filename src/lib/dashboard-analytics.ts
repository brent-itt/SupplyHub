import type { Item, MovementKind } from "./types";
import type { SupabaseClient } from "@supabase/supabase-js";

export type DashboardTransaction = { id: string; item_id: string; kind: MovementKind; quantity_delta: number; created_at: string; item: { name: string } | null };

export async function readDashboardTransactions(client: SupabaseClient, scope: { actorId: string } | { all: true }, start: string, end: string) {
  const rows: DashboardTransaction[] = [];
  for (let offset = 0; ; offset += 1000) {
    let query = client.from("transactions")
      .select("id,item_id,kind,quantity_delta,created_at,item:items!transactions_item_id_fkey(name)")
      .gte("created_at", start).lte("created_at", end)
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(offset, offset + 999);
    if ("actorId" in scope) query = query.eq("actor_id", scope.actorId);
    const { data, error } = await query.returns<DashboardTransaction[]>();
    if (error) throw new Error("Unable to load transaction analytics.");
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" });
export function analyticsDate(date: Date) {
  const parts = dayFormatter.formatToParts(date);
  const part = (type: string) => parts.find(value => value.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function analyticsWindow(now: Date) {
  const today = analyticsDate(now);
  const midnight = new Date(`${today}T00:00:00+08:00`);
  const days = Array.from({ length: 7 }, (_, index) => analyticsDate(new Date(midnight.getTime() - (6 - index) * 86400000)));
  return { days, start: new Date(`${days[0]}T00:00:00+08:00`).toISOString(), end: now.toISOString() };
}

export function stockHealth(items: Pick<Item, "quantity" | "low_stock_threshold" | "is_archived">[]) {
  const result = { healthy: 0, low: 0, out: 0 };
  for (const item of items) {
    if (item.is_archived) continue;
    if (item.quantity === 0) result.out++;
    else if (item.quantity <= item.low_stock_threshold) result.low++;
    else result.healthy++;
  }
  return result;
}

export function movementTrend(days: string[], rows: { created_at: string; kind: MovementKind; quantity_delta: number }[]) {
  const result = days.map(date => ({ date, stockIn: 0, stockOut: 0, adjustments: 0, transactions: 0 }));
  for (const row of rows) {
    const day = result.find(value => value.date === analyticsDate(new Date(row.created_at)));
    if (!day) continue;
    day.transactions++;
    if (row.kind === "stock_in") day.stockIn += row.quantity_delta;
    else if (row.kind === "stock_out") day.stockOut += Math.abs(row.quantity_delta);
    else day.adjustments++;
  }
  return result;
}
