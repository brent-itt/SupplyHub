import Link from "next/link";
import { formatDate, formatNumber, movementLabels } from "@/lib/format";
import { requireProfile } from "@/lib/auth";
import { isManager, type InventoryTransaction, type Item, type Profile, type Requisition } from "@/lib/types";
import { EmptyState, PageHeading, StatCard, StockBadge, StatusBadge } from "@/components/system/ui";

export default async function DashboardPage() {
  const { supabase, profile } = await requireProfile();
  const [itemResult, requestResult, transactionResult] = await Promise.all([
    supabase.from("items").select("*").order("name").limit(500),
    supabase.from("requisitions").select("*").order("created_at", { ascending: false }).limit(500),
    isManager(profile.role)
      ? supabase.from("transactions").select("*").order("created_at", { ascending: false }).limit(8)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (itemResult.error || requestResult.error) throw new Error("Unable to load the dashboard data.");
  const items = (itemResult.data ?? []) as Item[];
  const requisitions = (requestResult.data ?? []) as Requisition[];
  const activeItems = items.filter((item) => !item.is_archived);
  const lowStock = activeItems.filter((item) => item.quantity <= item.low_stock_threshold);
  const pending = requisitions.filter((request) => request.status === "pending");

  let recentTransactions: InventoryTransaction[] = [];
  let itemNames = new Map<string, string>();
  let actorNames = new Map<string, string>();
  if (isManager(profile.role)) {
    if (transactionResult.error) throw new Error("Unable to load recent stock activity.");
    recentTransactions = (transactionResult.data ?? []) as InventoryTransaction[];
    const itemIds = [...new Set(recentTransactions.map((row) => row.item_id))];
    const actorIds = [...new Set(recentTransactions.map((row) => row.actor_id))];
    const [names, actors] = await Promise.all([
      itemIds.length ? supabase.from("items").select("id,name").in("id", itemIds) : Promise.resolve({ data: [], error: null }),
      actorIds.length ? supabase.from("profiles").select("id,full_name,email").in("id", actorIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (names.error || actors.error) throw new Error("Unable to load activity details.");
    itemNames = new Map((names.data ?? []).map((row) => [row.id, row.name]));
    actorNames = new Map((actors.data ?? []).map((row) => [row.id, (row as Pick<Profile, "full_name" | "email"> & { id: string }).full_name || (row as Profile).email]));
  }

  return <>
    <PageHeading eyebrow="SUPPLIES OFFICE" title={`Good day, ${profile.full_name.split(/\s+/)[0] || "there"}`} description="A current view of university supplies and stock availability." actions={<Link className="sys-button sys-button-secondary" href="/inventory">Browse inventory</Link>}/>
    <section className="sys-stat-grid" aria-label="Inventory summary">
      <StatCard label="Active supplies" value={activeItems.length} detail="Unique items in inventory" icon="inventory"/>
      <StatCard label="Low or out of stock" value={lowStock.length} detail="At or below each alert level" icon="alert" tone={lowStock.length ? "amber" : "green"}/>
      <StatCard label={isManager(profile.role) ? "Pending requisitions" : "My pending requests"} value={pending.length} detail="Waiting for review" icon="requests" tone={pending.length ? "blue" : "green"}/>
      <StatCard label="Quantity on hand" value={formatNumber(activeItems.reduce((total, item) => total + item.quantity, 0))} detail="Combined units across supply types" icon="reports"/>
    </section>
    <section className="sys-grid-2">
      <div className="sys-card sys-card-flush">
        <div className="sys-card-header"><div><h2>Stock needing attention</h2><p>Supplies at or below their alert levels</p></div><Link className="sys-link" href="/inventory">View inventory</Link></div>
        {lowStock.length ? <div className="sys-table-wrap"><table className="sys-table"><thead><tr><th>Supply</th><th>Available</th><th>Status</th></tr></thead><tbody>{lowStock.slice(0, 8).map((item) => <tr key={item.id}><td><Link className="sys-link" href={`/inventory/${item.id}`}>{item.name}</Link><small>{item.sku}</small></td><td className="sys-numeric">{formatNumber(item.quantity)} {item.unit}</td><td><StockBadge item={item}/></td></tr>)}</tbody></table></div> : <EmptyState title="Stock levels look good" description="No active supplies are at or below their low-stock alert level."/>}
      </div>
      <div className="sys-card sys-card-flush">
        <div className="sys-card-header"><div><h2>{isManager(profile.role) ? "Recent stock activity" : "My requisitions"}</h2><p>{isManager(profile.role) ? "Latest changes recorded in the ledger" : "Your latest supply requests"}</p></div><Link className="sys-link" href={isManager(profile.role) ? "/reports" : "/requisitions"}>View all</Link></div>
        {isManager(profile.role) ? recentTransactions.length ? <div className="sys-table-wrap"><table className="sys-table"><thead><tr><th>Transaction</th><th>Change</th><th>Recorded</th></tr></thead><tbody>{recentTransactions.map((row) => <tr key={row.id}><td><Link className="sys-link" href={`/inventory/${row.item_id}`}>{itemNames.get(row.item_id) || "Supply item"}</Link><small>{actorNames.get(row.actor_id) || "Account"} · {movementLabels[row.kind]}</small></td><td className="sys-numeric">{row.quantity_delta > 0 ? "+" : ""}{formatNumber(row.quantity_delta)}</td><td>{formatDate(row.created_at)}</td></tr>)}</tbody></table></div> : <EmptyState title="No stock activity yet" description="Stock changes will appear after the first supply transaction."/> : requisitions.length ? <div className="sys-table-wrap"><table className="sys-table"><thead><tr><th>Request</th><th>Quantity</th><th>Status</th></tr></thead><tbody>{requisitions.slice(0, 8).map((row) => { const item = items.find((candidate) => candidate.id === row.item_id); return <tr key={row.id}><td><Link className="sys-link" href="/requisitions">{item?.name || "Supply item"}</Link><small>{formatDate(row.created_at)}</small></td><td>{formatNumber(row.quantity)} {item?.unit || "units"}</td><td><StatusBadge status={row.status}/></td></tr>; })}</tbody></table></div> : <EmptyState title="No requisitions yet" description="Staff can submit a supply request for the Supplies Office to review." action={<Link className="sys-button sys-button-secondary" href="/requisitions">View requisitions</Link>}/>}
      </div>
    </section>
  </>;
}
