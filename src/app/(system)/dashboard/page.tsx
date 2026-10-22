import Link from "next/link";
import { formatDate, formatNumber, movementLabels } from "@/lib/format";
import { requireProfile } from "@/lib/auth";
import { isManager, type Item, type Requisition, type RequestStatus } from "@/lib/types";
import { EmptyState, PageHeading, StatCard, StockBadge, StatusBadge } from "@/components/system/ui";
import { DataRefresh } from "@/components/data-refresh";
import { PrintButton } from "@/components/system/print-button";
import { DashboardCharts } from "@/components/dashboard-charts";
import { analyticsWindow, movementTrend, stockHealth } from "@/lib/dashboard-analytics";
import { loadDashboardTransactions } from "@/lib/dashboard-transactions";

type DashboardItem = Pick<Item, "id" | "name" | "sku" | "unit" | "quantity" | "low_stock_threshold" | "is_archived">;
type RecentRequest = Pick<Requisition, "id" | "quantity" | "status" | "created_at"> & { item: Pick<Item, "name" | "unit"> | null };

export default async function DashboardPage() {
  const { supabase, profile } = await requireProfile();
  const now = new Date();
  const window = analyticsWindow(now);
  const manager = isManager(profile.role);
  const statuses: RequestStatus[] = ["pending", "approved", "rejected", "cancelled"];
  async function loadActiveItems() {
    const items: DashboardItem[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("items").select("id,name,sku,unit,quantity,low_stock_threshold,is_archived").eq("is_archived", false).order("name").order("id").range(from, from + 999);
      if (error) throw new Error("Unable to load the dashboard inventory.");
      items.push(...data);
      if (data.length < 1000) return items;
    }
  }
  const [activeItems, statusResults, requestResult, transactions] = await Promise.all([
    loadActiveItems(),
    Promise.all(statuses.map(status => {
      const query = supabase.from("requisitions").select("id", { count: "exact", head: true }).eq("status", status);
      return manager ? query : query.eq("requester_id", profile.id);
    })),
    (manager ? supabase.from("requisitions").select("id,quantity,status,created_at,item:items!requisitions_item_id_fkey(name,unit)") : supabase.from("requisitions").select("id,quantity,status,created_at,item:items!requisitions_item_id_fkey(name,unit)").eq("requester_id", profile.id)).order("created_at", { ascending: false }).order("id").limit(8).returns<RecentRequest[]>(),
    loadDashboardTransactions(window.start, window.end),
  ]);
  if (statusResults.some(result => result.error) || requestResult.error) throw new Error("Unable to load the dashboard data.");
  const requisitions = requestResult.data ?? [];
  const lowStock = activeItems.filter((item) => item.quantity <= item.low_stock_threshold);
  const requestCounts = Object.fromEntries(statuses.map((status, index) => [status, statusResults[index].count ?? 0])) as Record<RequestStatus, number>;
  const pendingCount = requestCounts.pending;
  const recentTransactions = (transactions ?? []).slice(0, 8);

  return <>
    <PageHeading eyebrow="SUPPLIES OFFICE" title={`Good day, ${profile.full_name.split(/\s+/)[0] || "there"}`} description="A current view of university supplies and stock availability." actions={<><Link className="sys-button sys-button-secondary" href="/inventory">Browse inventory</Link><PrintButton label="Print analytics"/></>}/>
    <div className="analytics-report-heading"><h2>SupplyHub analytics</h2><p>Stock movement: {window.days[0]} to {window.days[window.days.length - 1]} · Philippine time</p><p>Inventory and request status as of <time dateTime={now.toISOString()}>{formatDate(now.toISOString())}</time> · Prepared for {profile.full_name || profile.email}</p></div>
    <DataRefresh updatedAt={now.toISOString()}/>
    <p className="sys-muted">{manager ? "Showing activity across all accounts." : "Stock levels are shared. Request and transaction analytics show your own activity."}</p>
    <section className="sys-stat-grid" aria-label="Inventory summary">
      <StatCard label="Active supplies" value={activeItems.length} detail="Unique items in inventory" icon="inventory"/>
      <StatCard label="Low or out of stock" value={lowStock.length} detail="At or below each alert level" icon="alert" tone={lowStock.length ? "amber" : "green"}/>
      <StatCard label={isManager(profile.role) ? "Pending requisitions" : "My pending requests"} value={pendingCount} detail="Waiting for review" icon="requests" tone={pendingCount ? "blue" : "green"}/>
      <StatCard label="Quantity on hand" value={formatNumber(activeItems.reduce((total, item) => total + item.quantity, 0))} detail="Combined units across supply types" icon="reports"/>
    </section>
    <DashboardCharts health={stockHealth(activeItems)} requests={requestCounts} trend={movementTrend(window.days, transactions ?? [])} manager={manager} transactionsAvailable={transactions !== null}/>
    <section className="sys-grid-2">
      <div className="sys-card sys-card-flush">
        <div className="sys-card-header"><div><h2>Stock needing attention</h2><p>Supplies at or below their alert levels</p></div><Link className="sys-link" href="/inventory">View inventory</Link></div>
        {lowStock.length ? <div className="sys-table-wrap"><table className="sys-table"><thead><tr><th>Supply</th><th>Available</th><th>Status</th></tr></thead><tbody>{lowStock.slice(0, 8).map((item) => <tr key={item.id}><td><Link className="sys-link" href={`/inventory/${item.id}`}>{item.name}</Link><small>{item.sku}</small></td><td className="sys-numeric">{formatNumber(item.quantity)} {item.unit}</td><td><StockBadge item={item}/></td></tr>)}</tbody></table></div> : <EmptyState title="Stock levels look good" description="No active supplies are at or below their low-stock alert level."/>}
      </div>
      <div className="sys-card sys-card-flush">
        <div className="sys-card-header"><div><h2>{manager ? "Recent requisitions" : "My requisitions"}</h2><p>Latest supply requests</p></div><Link className="sys-link" href="/requisitions">View all</Link></div>
        {requisitions.length ? <div className="sys-table-wrap"><table className="sys-table"><thead><tr><th>Request</th><th>Quantity</th><th>Status</th></tr></thead><tbody>{requisitions.map(row => <tr key={row.id}><td><Link className="sys-link" href="/requisitions">{row.item?.name || "Supply item"}</Link><small>{formatDate(row.created_at)}</small></td><td>{formatNumber(row.quantity)} {row.item?.unit || "units"}</td><td><StatusBadge status={row.status}/></td></tr>)}</tbody></table></div> : <EmptyState title="No requisitions yet" description="Supply requests will appear here once submitted."/>}
      </div>
    </section>
    <section className="sys-card sys-card-flush analytics-movements">
      <div className="sys-card-header"><div><h2>{manager ? "Recent stock activity" : "My recent stock activity"}</h2><p>Latest 8 transactions in the last 7 days</p></div>{manager && <Link className="sys-link" href="/reports">View reports</Link>}</div>
      {transactions === null ? <p className="sys-notice">Transaction analytics are currently unavailable.</p> : recentTransactions.length ? <div className="sys-table-wrap"><table className="sys-table"><thead><tr><th>Supply</th><th>Type</th><th>Change</th><th>Recorded</th></tr></thead><tbody>{recentTransactions.map(row => <tr key={row.id}><td>{row.item?.name || "Supply item"}</td><td>{movementLabels[row.kind]}</td><td>{row.quantity_delta > 0 ? "+" : ""}{formatNumber(row.quantity_delta)}</td><td>{formatDate(row.created_at)}</td></tr>)}</tbody></table></div> : <EmptyState title="No stock activity in the last 7 days" description="New stock transactions will appear here automatically."/>}
    </section>
  </>;
}
