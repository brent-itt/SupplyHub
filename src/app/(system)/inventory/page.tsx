import Link from "next/link";
import { formatNumber } from "@/lib/format";
import { requireProfile } from "@/lib/auth";
import { isManager, type Item } from "@/lib/types";
import { pageNumber, searchTerm } from "@/lib/validation";
import { EmptyState, PageHeading, StockBadge } from "@/components/system/ui";

const pageSize = 25;

function inventoryHref(query: Record<string, string>, page: number) {
  const params = new URLSearchParams(query);
  params.set("page", String(page));
  return `/inventory?${params.toString()}`;
}

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase, profile } = await requireProfile();
  const query = await searchParams;
  const term = searchTerm(query.q);
  const category = typeof query.category === "string" ? searchTerm(query.category) : "";
  const archived = isManager(profile.role) && query.archived === "true";
  const canEditQuantity = isManager(profile.role);
  const page = pageNumber(query.page);
  let request = supabase.from("items").select("*", { count: "exact" }).order("name").range((page - 1) * pageSize, page * pageSize - 1);
  request = request.eq("is_archived", archived);
  if (term) request = request.or(`name.ilike.%${term}%,sku.ilike.%${term}%,description.ilike.%${term}%`);
  if (category) request = request.eq("category", category);
  const { data, count, error } = await request;
  if (error) throw new Error("Unable to load the inventory.");
  const items = (data ?? []) as Item[];
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / pageSize));
  const queryForLinks: Record<string, string> = {};
  if (term) queryForLinks.q = term;
  if (category) queryForLinks.category = category;
  if (archived) queryForLinks.archived = "true";

  return <>
    <PageHeading eyebrow="SUPPLIES OFFICE" title={archived ? "Archived supplies" : "Inventory"} description="Search supplies, review stock levels, and open an item to view or manage its record." actions={<>{isManager(profile.role) && <Link className="sys-button" href="/inventory/new">Add supply item</Link>}{isManager(profile.role) && <Link className="sys-button sys-button-secondary" href={archived ? "/inventory" : "/inventory?archived=true"}>{archived ? "Active inventory" : "Archived supplies"}</Link>}</>}/>
    <section className="sys-card sys-card-flush" aria-label="Supply items">
      <div className="sys-card-header"><div><h2>{count ?? items.length} {archived ? "archived" : "available"} supply records</h2><p>Stock quantities update when a transaction is recorded.</p></div></div>
      <form className="sys-toolbar" method="get">
        <label className="sys-search"><span className="sys-sr-only">Search supplies</span><input className="sys-input" name="q" defaultValue={term} placeholder="Search name, code, or description"/></label>
        {archived && <input type="hidden" name="archived" value="true"/>}
        <label className="sys-field"><span>Category</span><input className="sys-input" name="category" defaultValue={category} placeholder="All categories" maxLength={80}/></label>
        <button className="sys-button sys-button-secondary" type="submit">Apply filters</button>
      </form>
      {items.length ? <div className="sys-table-wrap"><table className="sys-table"><thead><tr><th>Supply</th><th>Category</th><th>Available</th><th>Stock status</th><th>Location</th>{canEditQuantity && !archived && <th>Actions</th>}</tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><Link className="sys-link" href={`/inventory/${item.id}`}>{item.name}</Link><small>{item.sku}</small></td><td>{item.category}</td><td className="sys-numeric">{formatNumber(item.quantity)} {item.unit}</td><td><StockBadge item={item}/></td><td>{item.location || "—"}</td>{canEditQuantity && !archived && <td><Link className="sys-button sys-button-secondary sys-button-small" href={`/inventory/${item.id}?movement=adjustment#stock-movement`} aria-label={`Edit quantity for ${item.name}`}>Edit quantity</Link></td>}</tr>)}</tbody></table></div> : <EmptyState title="No supplies found" description={term || category ? "Try changing your search or category filter." : archived ? "Archived supplies will appear here." : "The inventory is empty. Supplies Office staff can add the first item."} action={isManager(profile.role) && !archived ? <Link className="sys-button" href="/inventory/new">Add supply item</Link> : undefined}/>}
      {totalPages > 1 && <nav className="sys-pagination" aria-label="Inventory pages"><span>Page {page} of {totalPages}</span><div>{page > 1 && <Link className="sys-button sys-button-secondary sys-button-small" href={inventoryHref(queryForLinks, page - 1)}>Previous</Link>}{page < totalPages && <Link className="sys-button sys-button-secondary sys-button-small" href={inventoryHref(queryForLinks, page + 1)}>Next</Link>}</div></nav>}
    </section>
  </>;
}
