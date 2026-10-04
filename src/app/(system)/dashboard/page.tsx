import Link from "next/link";
import { formatDate, formatNumber, movementLabels } from "@/lib/format";
import { requireProfile } from "@/lib/auth";
import { isManager, type InventoryTransaction, type Item, type Profile, type Requisition } from "@/lib/types";
import { EmptyState, PageHeading, StatCard, StockBadge, StatusBadge } from "@/components/system/ui";

type DashboardItem = Pick<Item, "id" | "name" | "sku" | "unit" | "quantity" | "low_stock_threshold" | "is_archived">;
type RecentTransaction = Pick<InventoryTransaction, "id" | "item_id" | "kind" | "quantity_delta" | "created_at"> & {
  item: Pick<Item, "name"> | null;
  actor: Pick<Profile, "full_name" | "email"> | null;
};
type RecentRequest = Pick<Requisition, "id" | "quantity" | "status" | "created_at"> & { item: Pick<Item, "name" | "unit"> | null };

export default async function DashboardPage() {
  const { supabase, profile } = await requireProfile();
  async function loadActiveItems() {
    const items: DashboardItem[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("items").select("id,name,sku,unit,quantity,low_stock_threshold,is_archived").eq("is_archived", false).order("name").order("id").range(from, from + 999);
      if (error) throw new Error("Unable to load the dashboard inventory.");
      items.push(...data);
      if (data.length < 1000) return items;
    }
  }
  const [activeItems, pendingResult, requestResult, transactionResult] = await Promise.all([
    loadActiveItems(),
    supabase.from("requisitions").select("id", { count: "exact", head: true }).eq("status", "pending"),
    !isManager(profile.role)
      ? supabase.from("requisitions").select("id,quantity,status,created_at,item:items!requisitions_item_id_fkey(name,unit)").order("created_at", { ascending: false }).order("id").limit(8).returns<RecentRequest[]>()
      : Promise.resolve({ data: [], error: null }),
    isManager(profile.role)
      ? supabase.from("transactions").select("id,item_id,kind,quantity_delta,created_at,item:items!transactions_item_id_fkey(name),actor:profiles!transactions_actor_id_fkey(full_name,email)").order("created_at", { ascending: false }).order("id").limit(8).returns<RecentTransaction[]>()
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (pendingResult.error || requestResult.error || transactionResult.error) throw new Error("Unable to load the dashboard data.");
  const requisitions = requestResult.data ?? [];
  const lowStock = activeItems.filter((item) => item.quantity <= item.low_stock_threshold);
  const pendingCount = pendingResult.count ?? 0;
  const recentTransactions = transactionResult.data ?? [];

  return <>
    <PageHeading eyebrow="SUPPLIES OFFICE" title={`Good day, ${profile.full_name.split(/\s+/)[0] || "there"}`} description="A current view of university supplies and stock availability." actions={<Link className="sys-button sys-button-secondary" href="/inventory">Browse inventory</Link>}/>
    <section className="sys-stat-grid" aria-label="Inventory summary">
      <StatCard label="Active supplies" value={activeItems.length} detail="Unique items in inventory" icon="inventory"/>
      <StatCard label="Low or out of stock" value={lowStock.length} detail="At or below each alert level" icon="alert" tone={lowStock.length ? "amber" : "green"}/>
      <StatCard label={isManager(profile.role) ? "Pending requisitions" : "My pending requests"} value={pendingCount} detail="Waiting for review" icon="requests" tone={pendingCount ? "blue" : "green"}/>
      <StatCard label="Quantity on hand" value={formatNumber(activeItems.reduce((total, item) => total + item.quantity, 0))} detail="Combined units across supply types" icon="reports"/>
    </section>
    <section className="sys-grid-2">
      <div className="sys-card sys-card-flush">
        <div className="sys-card-header"><div><h2>Stock needing attention</h2><p>Supplies at or below their alert levels</p></div><Link className="sys-link" href="/inventory">View inventory</Link></div>
        {lowStock.length ? <div className="sys-table-wrap"><table className="sys-table"><thead><tr><th>Supply</th><th>Available</th><th>Status</th></tr></thead><tbody>{lowStock.slice(0, 8).map((item) => <tr key={item.id}><td><Link className="sys-link" href={`/inventory/${item.id}`}>{item.name}</Link><small>{item.sku}</small></td><td className="sys-numeric">{formatNumber(item.quantity)} {item.unit}</td><td><StockBadge item={item}/></td></tr>)}</tbody></table></div> : <EmptyState title="Stock levels look good" description="No active supplies are at or below their low-stock alert level."/>}
      </div>
      <div className="sys-card sys-card-flush">
        <div className="sys-card-header"><div><h2>{isManager(profile.role) ? "Recent stock activity" : "My requisitions"}</h2><p>{isManager(profile.role) ? "Latest changes recorded in the ledger" : "Your latest supply requests"}</p></div><Link className="sys-link" href={isManager(profile.role) ? "/reports" : "/requisitions"}>View all</Link></div>
        {isManager(profile.role) ? recentTransactions.length ? <div className="sys-table-wrap"><table className="sys-table"><thead><tr><th>Transaction</th><th>Change</th><th>Recorded</th></tr></thead><tbody>{recentTransactions.map((row) => <tr key={row.id}><td><Link className="sys-link" href={`/inventory/${row.item_id}`}>{row.item?.name || "Supply item"}</Link><small>{(row.actor?.full_name || row.actor?.email) || "Account"} · {movementLabels[row.kind]}</small></td><td className="sys-numeric">{row.quantity_delta > 0 ? "+" : ""}{formatNumber(row.quantity_delta)}</td><td>{formatDate(row.created_at)}</td></tr>)}</tbody></table></div> : <EmptyState title="No stock activity yet" description="Stock changes will appear after the first supply transaction."/> : requisitions.length ? <div className="sys-table-wrap"><table className="sys-table"><thead><tr><th>Request</th><th>Quantity</th><th>Status</th></tr></thead><tbody>{requisitions.slice(0, 8).map((row) => { const item = row.item; return <tr key={row.id}><td><Link className="sys-link" href="/requisitions">{item?.name || "Supply item"}</Link><small>{formatDate(row.created_at)}</small></td><td>{formatNumber(row.quantity)} {item?.unit || "units"}</td><td><StatusBadge status={row.status}/></td></tr>; })}</tbody></table></div> : <EmptyState title="No requisitions yet" description="Staff can submit a supply request for the Supplies Office to review." action={<Link className="sys-button sys-button-secondary" href="/requisitions">View requisitions</Link>}/>}
      </div>
    </section>
  </>;
}
