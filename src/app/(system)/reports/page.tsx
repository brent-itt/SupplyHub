import Form from "next/form";
import Link from "next/link";
import { PrintButton } from "@/components/system/print-button";
import { EmptyState, PageHeading, Pagination, StatCard } from "@/components/system/ui";
import { formatDate, formatNumber, movementLabels } from "@/lib/format";
import { requireProfile } from "@/lib/auth";
import type { InventoryTransaction, Item } from "@/lib/types";
import { pageNumber } from "@/lib/validation";

type ReportItem = Pick<Item, "id" | "name" | "sku" | "category" | "unit" | "quantity" | "low_stock_threshold" | "is_archived">;
type ReportTransaction = Pick<InventoryTransaction, "id" | "item_id" | "kind" | "quantity_delta" | "balance_after" | "note" | "reference" | "created_at"> & { item: Pick<Item, "name" | "sku" | "unit"> | null };

function validDate(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) ? value : "";
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase } = await requireProfile(["admin", "super_admin"], "/reports");
  const query = await searchParams;
  const referenceDate = new Date();
  const today = referenceDate.toISOString().slice(0, 10);
  const firstDay = new Date(referenceDate);
  firstDay.setDate(firstDay.getDate() - 29);
  const defaultFrom = firstDay.toISOString().slice(0, 10);
  const from = validDate(query.from) || defaultFrom;
  const to = validDate(query.to) || today;
  const page = pageNumber(query.page);
  const stockPage = pageNumber(query.stock_page);
  const start = `${from}T00:00:00.000Z`;
  const end = `${to}T23:59:59.999Z`;
  async function loadItems() {
    const items: ReportItem[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.from("items").select("id,name,sku,category,unit,quantity,low_stock_threshold,is_archived").order("name").order("id").range(offset, offset + 999);
      if (error) throw new Error("Unable to load the stock report.");
      items.push(...data);
      if (data.length < 1000) return items;
    }
  }
  const [transactionResult, items, stockInResult, stockOutResult] = await Promise.all([
    supabase.from("transactions").select("id,item_id,kind,quantity_delta,balance_after,note,reference,created_at,item:items!transactions_item_id_fkey(name,sku,unit)", { count: "exact" }).gte("created_at", start).lte("created_at", end).order("created_at", { ascending: false }).order("id", { ascending: false }).range((page - 1) * 50, page * 50 - 1).returns<ReportTransaction[]>(),
    loadItems(),
    supabase.from("transactions").select("id", { count: "exact", head: true }).gte("created_at", start).lte("created_at", end).eq("kind", "stock_in"),
    supabase.from("transactions").select("id", { count: "exact", head: true }).gte("created_at", start).lte("created_at", end).eq("kind", "stock_out"),
  ]);
  if (transactionResult.error || stockInResult.error || stockOutResult.error) throw new Error("Unable to load the inventory report.");
  const transactions = transactionResult.data ?? [];
  const activeItems = items.filter((item) => !item.is_archived);
  const lowStock = activeItems.filter((item) => item.quantity <= item.low_stock_threshold);
  const stockIn = stockInResult.count ?? 0;
  const stockOut = stockOutResult.count ?? 0;
  const transactionCount = transactionResult.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(transactionCount / 50));
  const stockPages = Math.max(1, Math.ceil(items.length / 50));
  const visibleItems = items.slice((stockPage - 1) * 50, stockPage * 50);
  const reportQuery = new URLSearchParams({ from, to }).toString();

  return <>
    <PageHeading eyebrow="SUPPLIES OFFICE" title="Inventory reports" description="Review current stock and the transaction ledger for a selected date range." actions={<><Link className="sys-button sys-button-secondary sys-no-print" href={`/api/reports?${reportQuery}`}>Download CSV</Link><PrintButton label="Print current page"/></>}/>
    <Form key={`${from}:${to}`} className="sys-toolbar sys-filters sys-no-print" action="/reports" aria-label="Report date range">
      <label className="sys-field"><span>From</span><input className="sys-input" type="date" name="from" defaultValue={from}/></label>
      <label className="sys-field"><span>To</span><input className="sys-input" type="date" name="to" defaultValue={to}/></label>
      <button className="sys-button" type="submit">Update report</button>
    </Form>
    <section className="sys-stat-grid" aria-label="Report summary">
      <StatCard label="Active supply types" value={activeItems.length} detail="Current inventory records" icon="inventory"/>
      <StatCard label="Units on hand" value={formatNumber(activeItems.reduce((sum, item) => sum + item.quantity, 0))} detail="Combined units across supply types" icon="reports"/>
      <StatCard label="Low or out of stock" value={lowStock.length} detail="At or below alert level" icon="alert" tone={lowStock.length ? "amber" : "green"}/>
      <StatCard label="Transactions in range" value={transactionCount} detail={`${stockIn} stock-in · ${stockOut} stock-out`} icon="clock" tone="blue"/>
    </section>
    <section className="sys-card sys-card-flush">
      <div className="sys-card-header"><div><h2>Current stock levels</h2><p>Archived supplies are retained here for reporting.</p></div></div>
      {visibleItems.length ? <div className="sys-table-wrap"><table className="sys-table"><thead><tr><th>Supply</th><th>Category</th><th>Available</th><th>Alert level</th><th>Status</th></tr></thead><tbody>{visibleItems.map((item) => <tr key={item.id}><td><Link className="sys-link" href={`/inventory/${item.id}`}>{item.name}</Link><small>{item.sku}</small></td><td>{item.category}</td><td>{formatNumber(item.quantity)} {item.unit}</td><td>{formatNumber(item.low_stock_threshold)} {item.unit}</td><td>{item.is_archived ? "Archived" : item.quantity === 0 ? "Out of stock" : item.quantity <= item.low_stock_threshold ? "Low stock" : "In stock"}</td></tr>)}</tbody></table></div> : <EmptyState title="No supply records" description="Add supplies to build an inventory report."/>}
      <Pagination pathname="/reports" query={{ from, to, page: String(page) }} page={stockPage} totalPages={stockPages} pageKey="stock_page" label="Stock report pages"/>
    </section>
    <section className="sys-card sys-card-flush" style={{ marginTop: 22 }}>
      <div className="sys-card-header"><div><h2>Transaction ledger</h2><p>{from} to {to} · {transactionCount} transactions · 50 per page</p></div></div>
      {transactions.length ? <div className="sys-table-wrap"><table className="sys-table"><thead><tr><th>Date</th><th>Supply</th><th>Type</th><th>Change</th><th>Balance after</th><th>Note</th></tr></thead><tbody>{transactions.map((row) => { const item = row.item; return <tr key={row.id}><td>{formatDate(row.created_at)}</td><td><Link className="sys-link" href={`/inventory/${row.item_id}`}>{item?.name || "Supply item"}</Link><small>{item?.sku || ""}</small></td><td>{movementLabels[row.kind]}</td><td>{row.quantity_delta > 0 ? "+" : ""}{formatNumber(row.quantity_delta)} {item?.unit || "units"}</td><td>{formatNumber(row.balance_after)} {item?.unit || "units"}</td><td>{row.note || row.reference || "—"}</td></tr>; })}</tbody></table></div> : <EmptyState title="No transactions in this range" description="Stock movements will appear here after they are recorded."/>}
      <Pagination pathname="/reports" query={{ from, to, stock_page: String(stockPage) }} page={page} totalPages={totalPages} label="Transaction pages"/>
    </section>
  </>;
}
