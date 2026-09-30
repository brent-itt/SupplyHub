import Link from "next/link";
import { cancelRequisitionAction, createRequisitionAction, reviewRequisitionAction } from "@/app/actions";
import { CancelRequestForm, RequestForm, ReviewForm } from "@/components/system/forms";
import { EmptyState, PageHeading, StatusBadge } from "@/components/system/ui";
import { formatDate, formatNumber } from "@/lib/format";
import { requireProfile } from "@/lib/auth";
import { isManager, type Item, type Profile, type Requisition } from "@/lib/types";

export default async function RequisitionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase, profile, user } = await requireProfile(["staff", "admin", "super_admin"], "/requisitions");
  const query = await searchParams;
  const statusFilter = typeof query.status === "string" && ["pending", "approved", "rejected", "cancelled"].includes(query.status) ? query.status : "";
  const manager = isManager(profile.role);
  let requestsQuery = supabase.from("requisitions").select("*").order("created_at", { ascending: false }).limit(500);
  if (statusFilter) requestsQuery = requestsQuery.eq("status", statusFilter);
  const [requestsResult, itemsResult] = await Promise.all([
    requestsQuery,
    supabase.from("items").select("*").order("name").limit(500),
  ]);
  if (requestsResult.error || itemsResult.error) throw new Error("Unable to load requisitions.");
  const requests = (requestsResult.data ?? []) as Requisition[];
  const items = (itemsResult.data ?? []) as Item[];
  const itemMap = new Map(items.map((item) => [item.id, item]));
  let requesterNames = new Map<string, string>();
  if (manager && requests.length) {
    const ids = [...new Set(requests.map((row) => row.requester_id))];
    const profilesResult = await supabase.from("profiles").select("id,full_name,email").in("id", ids);
    if (profilesResult.error) throw new Error("Unable to load requester details.");
    requesterNames = new Map((profilesResult.data ?? []).map((row) => [row.id, (row as Pick<Profile, "id" | "full_name" | "email">).full_name || (row as Profile).email]));
  }

  return <>
    <PageHeading eyebrow="SUPPLIES OFFICE" title={manager ? "Requisitions" : "My requisitions"} description={manager ? "Review staff supply requests. Approval issues stock and records the transaction." : "Submit a supply request and follow it through review."}/>
    <div className="sys-grid-2">
      {!manager && <section className="sys-card"><h2>Submit a requisition</h2><p className="sys-muted">The requested quantity is reserved only after approval.</p><RequestForm action={createRequisitionAction} items={items}/></section>}
      <section className={`sys-card${!manager ? "" : " sys-card-flush"}`}>
        {manager && <div className="sys-card-header"><div><h2>Requests for review</h2><p>Approve to deduct stock and add the movement to history.</p></div></div>}
        {!manager && <div className="sys-card-header"><div><h2>Request history</h2><p>Your latest supply requests</p></div></div>}
        <form className="sys-toolbar" method="get"><label className="sys-field"><span>Status</span><select className="sys-select" name="status" defaultValue={statusFilter}><option value="">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option></select></label><button type="submit" className="sys-button sys-button-secondary">Filter</button></form>
        {requests.length ? <div className="sys-table-wrap"><table className="sys-table"><thead><tr><th>Supply request</th>{manager && <th>Requested by</th>}<th>Quantity</th><th>Status</th><th>Submitted</th><th>Review</th></tr></thead><tbody>{requests.map((request) => { const item = itemMap.get(request.item_id); const isOwn = request.requester_id === user.id; return <tr key={request.id}><td><strong>{item?.name || "Supply item"}</strong><small>{request.purpose}</small>{request.review_note && <small>Review note: {request.review_note}</small>}</td>{manager && <td>{requesterNames.get(request.requester_id) || "Account"}</td>}<td>{formatNumber(request.quantity)} {item?.unit || "units"}</td><td><StatusBadge status={request.status}/></td><td>{formatDate(request.created_at)}</td><td>{request.status === "pending" && manager ? <ReviewForm action={reviewRequisitionAction} requestId={request.id}/> : request.status === "pending" && isOwn ? <CancelRequestForm action={cancelRequisitionAction} requestId={request.id}/> : <Link className="sys-link" href={item ? `/inventory/${item.id}` : "/inventory"}>View supply</Link>}</td></tr>; })}</tbody></table></div> : <EmptyState title="No requisitions found" description={statusFilter ? "There are no requests with this status." : manager ? "Staff requests will appear here when submitted." : "Submit a requisition when your department needs university supplies."} action={!manager ? <Link href="/inventory" className="sys-button sys-button-secondary">Browse inventory</Link> : undefined}/>}
      </section>
    </div>
  </>;
}
