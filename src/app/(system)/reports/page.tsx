import Link from "next/link";
import { PrintButton } from "@/components/system/print-button";
import { EmptyState, PageHeading, StatCard } from "@/components/system/ui";
import { formatDate, formatNumber, movementLabels } from "@/lib/format";
import { requireProfile } from "@/lib/auth";
import type { InventoryTransaction, Item } from "@/lib/types";

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
  let transactionQuery = supabase.from("transactions").select("*").order("created_at", { ascending: false }).limit(5000);
  if (from) transactionQuery = transactionQuery.gte("created_at", `${from}T00:00:00.000Z`);
  if (to) transactionQuery = transactionQuery.lte("created_at", `${to}T23:59:59.999Z`);
  const [transactionResult, itemResult] = await Promise.all([
    transactionQuery,
    supabase.from("items").select("*").order("name").limit(5000),
  ]);
  if (transactionResult.error || itemResult.error) throw new Error("Unable to load the inventory report.");
  const transactions = (transactionResult.data ?? []) as InventoryTransaction[];
  const items = (itemResult.data ?? []) as Item[];
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const activeItems = items.filter((item) => !item.is_archived);
  const lowStock = activeItems.filter((item) => item.quantity <= item.low_stock_threshold);
  const stockIn = transactions.filter((row) => row.kind === "stock_in").length;
  const stockOut = transactions.filter((row) => row.kind === "stock_out").length;
  const reportQuery = new URLSearchParams({ from, to }).toString();

  return <>
    <PageHeading eyebrow="SUPPLIES OFFICE" title="Inventory reports" description="Review current stock and the transaction ledger for a selected date range." actions={<><Link className="sys-button sys-button-secondary sys-no-print" href={`/api/reports?${reportQuery}`}>Download CSV</Link><PrintButton/></>}/>
    <form key={`${from}:${to}`} className="sys-toolbar sys-filters sys-no-print" method="get" aria-label="Report date range">
      <label className="sys-field"><span>From</span><input className="sys-input" type="date" name="from" defaultValue={from}/></label>
      <label className="sys-field"><span>To</span><input className="sys-input" type="date" name="to" defaultValue={to}/></label>
      <button className="sys-button" type="submit">Update report</button>
    </form>
    <section className="sys-stat-grid" aria-label="Report summary">
      <StatCard label="Active supply types" value={activeItems.length} detail="Current inventory records" icon="inventory"/>
      <StatCard label="Units on hand" value={formatNumber(activeItems.reduce((sum, item) => sum + item.quantity, 0))} detail="Combined units across supply types" icon="reports"/>
      <StatCard label="Low or out of stock" value={lowStock.length} detail="At or below alert level" icon="alert" tone={lowStock.length ? "amber" : "green"}/>
      <StatCard label="Transactions in range" value={transactions.length} detail={`${stockIn} stock-in · ${stockOut} stock-out`} icon="clock" tone="blue"/>
    </section>
    <section className="sys-card sys-card-flush">
      <div className="sys-card-header"><div><h2>Current stock levels</h2><p>Archived supplies are retained here for reporting.</p></div></div>
      {items.length ? <div className="sys-table-wrap"><table className="sys-table"><thead><tr><th>Supply</th><th>Category</th><th>Available</th><th>Alert level</th><th>Status</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><Link className="sys-link" href={`/inventory/${item.id}`}>{item.name}</Link><small>{item.sku}</small></td><td>{item.category}</td><td>{formatNumber(item.quantity)} {item.unit}</td><td>{formatNumber(item.low_stock_threshold)} {item.unit}</td><td>{item.is_archived ? "Archived" : item.quantity === 0 ? "Out of stock" : item.quantity <= item.low_stock_threshold ? "Low stock" : "In stock"}</td></tr>)}</tbody></table></div> : <EmptyState title="No supply records" description="Add supplies to build an inventory report."/>}
    </section>
    <section className="sys-card sys-card-flush" style={{ marginTop: 22 }}>
      <div className="sys-card-header"><div><h2>Transaction ledger</h2><p>{from} to {to} · latest 5,000 transactions</p></div></div>
      {transactions.length ? <div className="sys-table-wrap"><table className="sys-table"><thead><tr><th>Date</th><th>Supply</th><th>Type</th><th>Change</th><th>Balance after</th><th>Note</th></tr></thead><tbody>{transactions.map((row) => { const item = itemMap.get(row.item_id); return <tr key={row.id}><td>{formatDate(row.created_at)}</td><td><Link className="sys-link" href={`/inventory/${row.item_id}`}>{item?.name || "Supply item"}</Link><small>{item?.sku || ""}</small></td><td>{movementLabels[row.kind]}</td><td>{row.quantity_delta > 0 ? "+" : ""}{formatNumber(row.quantity_delta)} {item?.unit || "units"}</td><td>{formatNumber(row.balance_after)} {item?.unit || "units"}</td><td>{row.note || row.reference || "—"}</td></tr>; })}</tbody></table></div> : <EmptyState title="No transactions in this range" description="Stock movements will appear here after they are recorded."/>}
    </section>
  </>;
}
