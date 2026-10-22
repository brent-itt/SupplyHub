import "server-only";
import { createClient } from "@supabase/supabase-js";
import { connection } from "next/server";
import { getSupabaseConfig } from "./supabase/config";
import type { PublicStockItem } from "./stock-category";

async function loadPublicStockRows<T>(columns: string, category?: string): Promise<{ stocks: T[]; error: boolean }> {
  await connection();
  const config = getSupabaseConfig();
  if (!config) return { stocks: [], error: false };
  // Always use the public RPC, including when a signed-in admin opens this page.
  const supabase = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const stocks: T[] = [];
  for (let from = 0; ; from += 500) {
    let query = supabase.rpc("get_public_stock").select(columns).order("name").order("id").range(from, from + 499);
    if (category !== undefined) query = query.eq("category", category);
    const { data, error } = await query.returns<T[]>();
    if (error) return { stocks: [], error: true };
    stocks.push(...(data ?? []));
    if (!data || data.length < 500) return { stocks, error: false };
  }
}

export function loadPublicStock(category?: string) {
  return loadPublicStockRows<PublicStockItem>("id,name,category,unit,quantity", category);
}

export function loadPublicStockCategories() {
  // PostgREST requires the RPC's ordering fields in the selected record.
  // Keep pagination stable without fetching stock quantities for category cards.
  return loadPublicStockRows<Pick<PublicStockItem, "id" | "name" | "category">>("id,name,category");
}
