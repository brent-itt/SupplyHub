import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { csvCell, formatDate } from "@/lib/format";
import { reportDateRange } from "@/lib/report-dates";
import { isManager, type InventoryTransaction, type Item, type Profile } from "@/lib/types";

export async function GET(request: NextRequest) {
  const context = await getAuthContext();
  if (!context?.profile?.is_active) return NextResponse.json({ error: "Sign in with an active account." }, { status: 401 });
  if (!isManager(context.profile.role)) return NextResponse.json({ error: "Your account cannot download this report." }, { status: 403 });

  let dates;
  try { dates = reportDateRange(request.nextUrl.searchParams.get("from"), request.nextUrl.searchParams.get("to")); }
  catch { return NextResponse.json({ error: "Enter valid dates with From on or before To." }, { status: 400 }); }
  const query = context.supabase.from("transactions").select("*").order("created_at", { ascending: false }).limit(5000).gte("created_at", dates.start).lte("created_at", dates.end);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Unable to build the report." }, { status: 500 });
  const transactions = (data ?? []) as InventoryTransaction[];
  const itemIds = [...new Set(transactions.map((row) => row.item_id))];
  const actorIds = [...new Set(transactions.map((row) => row.actor_id))];
  const [itemsResult, profilesResult] = await Promise.all([
    itemIds.length ? context.supabase.from("items").select("id,name,sku,category,unit").in("id", itemIds) : Promise.resolve({ data: [], error: null }),
    actorIds.length ? context.supabase.from("profiles").select("id,full_name,email").in("id", actorIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (itemsResult.error || profilesResult.error) return NextResponse.json({ error: "Unable to build the report." }, { status: 500 });
  const items = new Map((itemsResult.data ?? []).map((row) => [row.id, row as Pick<Item, "id" | "name" | "sku" | "category" | "unit">]));
  const profiles = new Map((profilesResult.data ?? []).map((row) => [row.id, row as Pick<Profile, "id" | "full_name" | "email">]));
  const rows: unknown[][] = [["Date (Philippine time)", "Item", "SKU", "Category", "Type", "Quantity change", "Unit", "Balance after", "Recorded by", "Reference", "Note"]];
  for (const row of transactions) {
    const item = items.get(row.item_id);
    const actor = profiles.get(row.actor_id);
    rows.push([formatDate(row.created_at), item?.name ?? "Supply item", item?.sku ?? "", item?.category ?? "", row.kind, row.quantity_delta, item?.unit ?? "", row.balance_after, actor?.full_name || actor?.email || "Account", row.reference, row.note]);
  }
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="supplyhub-inventory-report.csv"',
      "Cache-Control": "private, no-store",
    },
  });
}
