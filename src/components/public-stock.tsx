import { createClient } from "@supabase/supabase-js";
import { connection } from "next/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { formatNumber } from "@/lib/format";

type Stock = { id: string; name: string; category: string; unit: string; quantity: number };

export async function PublicStock() {
  // Only this section waits for live stock. The hero and navigation stream first.
  await connection();
  const config = getSupabaseConfig();
  let stocks: Stock[] = [];
  if (config) {
    const supabase = createClient(config.url, config.key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await supabase.rpc("get_public_stock");
    if (error) return <p className="public-stock-empty" role="status">Stock availability could not be loaded. Please try again shortly.</p>;
    stocks = data ?? [];
  }
  if (!stocks.length) return <p className="public-stock-empty">No supplies are currently selected for public display.</p>;
  return <div className="public-stock-grid">{stocks.map(item => (
    <article className="public-stock-card" key={item.id}>
      <div><span className="public-stock-category">{item.category}</span><h3>{item.name}</h3></div>
      <div className="public-stock-quantity"><strong>{formatNumber(item.quantity)}</strong><span>{item.unit}{item.quantity === 1 ? "" : "s"} available</span></div>
      <span className={item.quantity > 0 ? "public-stock-status in-stock" : "public-stock-status out-of-stock"}>{item.quantity > 0 ? "In stock" : "Out of stock"}</span>
    </article>
  ))}</div>;
}
