import Image from "next/image";
import Link from "next/link";
import QRCode from "qrcode";
import { notFound } from "next/navigation";
import { archiveItemAction, recordMovementAction, saveItemAction, setPublicVisibilityAction } from "@/app/actions";
import { ArchiveItemForm } from "@/components/system/archive-form";
import { ItemForm, MovementForm, PublicVisibilityForm } from "@/components/system/forms";
import { PrintButton } from "@/components/system/print-button";
import { PageHeading, StockBadge } from "@/components/system/ui";
import { formatDate, formatNumber, movementLabels } from "@/lib/format";
import { requireProfile } from "@/lib/auth";
import { buildItemCode } from "@/lib/qr";
import { isManager, type InventoryTransaction, type Item, type Profile } from "@/lib/types";

export default async function InventoryItemPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { supabase, profile } = await requireProfile(undefined, `/inventory/${id}`);
  const manager = isManager(profile.role);
  const canRecordStock = manager;
  const [itemResult, historyResult, qr] = await Promise.all([
    supabase.from("items").select("*").eq("id", id).maybeSingle(),
    manager
      ? supabase.from("transactions").select("*").eq("item_id", id).order("created_at", { ascending: false }).limit(100)
      : Promise.resolve({ data: [], error: null }),
    QRCode.toDataURL(buildItemCode(id), { width: 360, margin: 1, errorCorrectionLevel: "M" }),
  ]);
  if (itemResult.error) throw new Error("Unable to load the supply record.");
  if (!itemResult.data) notFound();
  const item = itemResult.data as Item;
  if (historyResult.error) throw new Error("Unable to load the stock history.");
  const history = (historyResult.data ?? []) as InventoryTransaction[];
  let actors = new Map<string, string>();
  if (manager) {
    const actorIds = [...new Set(history.map((row) => row.actor_id))];
    if (actorIds.length) {
      const actorResult = await supabase.from("profiles").select("id,full_name,email").in("id", actorIds);
      if (actorResult.error) throw new Error("Unable to load stock history details.");
      actors = new Map((actorResult.data ?? []).map((row) => [row.id, (row as Pick<Profile, "id" | "full_name" | "email">).full_name || (row as Profile).email]));
    }
  }

  const movementQuery = query.movement === "stock_out" || query.movement === "stock_in" || query.movement === "adjustment" ? query.movement : undefined;
  return <>
    <PageHeading eyebrow="INVENTORY" title={item.name} description={`${item.sku} · ${item.category}`} actions={<><Link className="sys-button sys-button-secondary" href="/inventory">Back to inventory</Link>{canRecordStock && !item.is_archived && <Link className="sys-button sys-button-secondary" href="/scan">Scan a QR label</Link>}</>}/>
    {item.is_archived && <div className="sys-notice"><p>This supply is archived. It remains available in historical records, but cannot receive new stock movements or requisitions.</p></div>}
    <div className="sys-grid-2">
      <section className="sys-card">
        <div className="sys-card-header"><div><h2>Supply information</h2><p>Current stock and item details</p></div><StockBadge item={item}/></div>
        <dl className="sys-detail-grid">
          <div><dt>Available quantity</dt><dd>{formatNumber(item.quantity)} {item.unit}</dd></div>
          <div><dt>Low-stock alert level</dt><dd>{formatNumber(item.low_stock_threshold)} {item.unit}</dd></div>
          <div><dt>Storage location</dt><dd>{item.location || "Not specified"}</dd></div>
          <div><dt>Last updated</dt><dd>{formatDate(item.updated_at)}</dd></div>
          {item.description && <div><dt>Description</dt><dd>{item.description}</dd></div>}
        </dl>
      </section>
      <section className="sys-qr-label">
        <div className="sys-card-header sys-no-print"><div><h2>Item QR label</h2><p>Scan to open this supply in the portal</p></div><PrintButton label="Print label"/></div>
        <Image src={qr} width={240} height={240} alt={`QR code for ${item.name}`} unoptimized/>
        <h2>{item.name}</h2><p>{item.sku}</p>
        <p className="sys-no-print">This code identifies the item only. Sign-in and role permissions still apply.</p>
      </section>
    </div>
    {manager ? <nav aria-label="Edit this supply" className="sys-form-actions" style={{ marginTop: 22 }}><a className="sys-button" href="#item-information">Edit item information</a>{!item.is_archived && <a className="sys-button sys-button-secondary" href="#stock-movement">Update stock quantity</a>}</nav> : <p className="sys-notice" style={{ marginTop: 22 }}>Only an Admin or Super Admin can edit stock quantities and item information.</p>}
    {canRecordStock && !item.is_archived && <section id="stock-movement" className="sys-card" style={{ marginTop: 22, scrollMarginTop: 24 }}><h2>Update stock quantity</h2><p className="sys-muted">To correct the stock count, choose Adjustment and enter the new total quantity with a reason.</p><MovementForm key={`${item.id}:${movementQuery || "stock_in"}`} action={recordMovementAction} item={item} initialKind={movementQuery}/>{manager && <p style={{ marginTop: 18 }}><a className="sys-link" href="#item-information">Edit item information: name, category, unit, location, and description</a></p>}</section>}
    {manager && <section className="sys-stack" style={{ marginTop: 22 }}>
      <div className="sys-stack">
        {item.is_archived && <div className="sys-card"><h2>Archived supply</h2><ArchiveItemForm action={archiveItemAction} itemId={item.id} archived={item.is_archived}/></div>}
        <div id="item-information" className="sys-card" style={{ scrollMarginTop: 24 }}><h2>Edit item information</h2><ItemForm action={saveItemAction} item={item}/></div>
      </div>
      <div className="sys-card"><h2>Public stock list</h2><p className="sys-muted">Choose whether this item appears in the stock list on the public home page.</p><div style={{ marginTop: 15 }}><PublicVisibilityForm action={setPublicVisibilityAction} item={item}/></div></div>
      {!item.is_archived && <div className="sys-card"><h2>Archive supply</h2><p className="sys-muted">Archiving keeps the transaction history. Stock must be zero and pending requisitions must be resolved.</p><div style={{ marginTop: 15 }}><ArchiveItemForm action={archiveItemAction} itemId={item.id} archived={false}/></div></div>}
    </section>}
    {manager && <section className="sys-card sys-card-flush" style={{ marginTop: 22 }}>
      <div className="sys-card-header"><div><h2>Transaction history</h2><p>Most recent 100 stock movements</p></div></div>
      {history.length ? <div className="sys-table-wrap"><table className="sys-table"><thead><tr><th>Date</th><th>Type</th><th>Change</th><th>Balance</th><th>Recorded by</th><th>Note</th></tr></thead><tbody>{history.map((row) => <tr key={row.id}><td>{formatDate(row.created_at)}</td><td>{movementLabels[row.kind]}</td><td className="sys-numeric">{row.quantity_delta > 0 ? "+" : ""}{formatNumber(row.quantity_delta)} {item.unit}</td><td className="sys-numeric">{formatNumber(row.balance_after)} {item.unit}</td><td>{actors.get(row.actor_id) || "Account"}</td><td>{row.note || row.reference || "—"}</td></tr>)}</tbody></table></div> : <p className="sys-muted" style={{ padding: "0 24px 24px" }}>No transactions have been recorded for this item.</p>}
    </section>}
  </>;
}
