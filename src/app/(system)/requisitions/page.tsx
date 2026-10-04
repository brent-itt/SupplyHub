import Link from "next/link";
import Form from "next/form";
import { cancelRequisitionAction, createRequisitionAction, reviewRequisitionAction, updateRequisitionAction } from "@/app/actions";
import { CancelRequestForm, RequestForm, ReviewForm } from "@/components/system/forms";
import { EmptyState, PageHeading, Pagination, StatusBadge } from "@/components/system/ui";
import { formatDate, formatNumber } from "@/lib/format";
import { formatRequestDate, universityDate } from "@/lib/requisitions";
import { requireProfile } from "@/lib/auth";
import { pageNumber, uuid } from "@/lib/validation";
import { RequisitionLogs } from "@/components/system/requisition-logs";
import { isManager, type Item, type Profile, type Requisition, type RequisitionLog, type RequisitionItem } from "@/lib/types";

type RequestRow = Requisition & { item: Pick<Item, "id" | "name" | "sku" | "unit"> | null; recorder: Pick<Profile, "full_name" | "email"> | null };

export default async function RequisitionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase, profile, user } = await requireProfile(["staff", "admin", "super_admin"], "/requisitions");
  const query = await searchParams;
  const statusFilter = typeof query.status === "string" && ["pending", "approved", "rejected", "cancelled"].includes(query.status) ? query.status : "";
  const manager = isManager(profile.role);
  const editId = uuid.safeParse(query.edit);
  const logId = uuid.safeParse(query.log_request);
  const logRequestId = logId.success ? logId.data : "";
  const logPage = pageNumber(query.log_page);
  const page = pageNumber(query.page);
  let logQuery = supabase.from("requisition_logs").select("*", { count: "exact" }).order("created_at", { ascending: false }).order("id", { ascending: false }).range((logPage - 1) * 25, logPage * 25 - 1);
  if (logRequestId) logQuery = logQuery.eq("request_id", logRequestId);
  let requestsQuery = supabase.from("requisitions").select("*,item:items!requisitions_item_id_fkey(id,name,sku,unit),recorder:profiles!requisitions_requester_id_fkey(full_name,email)", { count: "exact" }).order("created_at", { ascending: false }).order("id", { ascending: false }).range((page - 1) * 25, page * 25 - 1);
  if (statusFilter) requestsQuery = requestsQuery.eq("status", statusFilter);
  async function loadItems() {
    const items: RequisitionItem[] = [];
    if (manager && !editId.success) return items;
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("items").select("id,name,sku,unit,quantity,location,category,is_archived").eq("is_archived", false).order("name").order("id").range(from, from + 999);
      if (error) throw new Error("Unable to load supplies for requisitions.");
      items.push(...data);
      if (data.length < 1000) return items;
    }
  }
  const [requestsResult, items, editResult, logResult] = await Promise.all([
    requestsQuery.returns<RequestRow[]>(),
    loadItems(),
    editId.success ? supabase.from("requisitions").select("*").eq("id", editId.data).maybeSingle<Requisition>() : Promise.resolve({ data: null, error: null }),
    manager ? logQuery : Promise.resolve({ data: [], error: null, count: 0 }),
  ]);
  if (requestsResult.error) throw new Error("Unable to load requisitions.");
  if (editResult.error) throw new Error("Unable to load the requisition for editing.");
  if (logResult.error) throw new Error("Unable to load the requisition activity log. Confirm the latest database migration has been applied.");
  const editing = editResult.data?.status === "pending" && (manager || editResult.data.requester_id === user.id) ? editResult.data : null;
  const requests = requestsResult.data ?? [];
  const logs = (logResult.data ?? []) as RequisitionLog[];
  const logCount = logResult.count ?? 0;
  const totalPages = Math.max(1, Math.ceil((requestsResult.count ?? 0) / 25));

  return <>
    <PageHeading eyebrow="SCHOOL STAFF ONLY" title={manager ? "School staff requisitions" : "My requisitions"} description={manager ? "Review supply requests from school staff. Approval issues the requested stock." : "Request supplies for school staff. Enter the requestor, date, and item name; its code fills automatically."} actions={<>{manager && <a href="#activity-log" className="sys-button sys-button-secondary">Activity log</a>}<Link href="/scan" className="sys-button sys-button-secondary">Stock out supplies</Link></>}/>
    <div className="sys-stack">
      {query.notice === "updated" && <p className="sys-notice sys-notice-success" role="status">Requisition updated. The changes are recorded in the admin activity log.</p>}
      {query.edit && !editing && <p className="sys-notice" role="status">This requisition is unavailable or is no longer pending. Only pending requisitions can be edited.</p>}
      {(!manager || editing) && <section className="sys-card" id="request-form">
        <div className="sys-card-header"><div><h2>{editing ? "Edit requisition" : "School staff requisition"}</h2><p>{editing ? "Update the request details before approval. Saving does not change stock." : "For supplies that need review by the Supplies Office."}</p></div>{editing ? <Link href="/requisitions" className="sys-button sys-button-secondary">Cancel editing</Link> : <span className="sys-badge sys-badge-green">School staff</span>}</div>
        <RequestForm key={editing ? `${editing.id}:${editing.version}` : "new"} action={editing ? updateRequisitionAction : createRequisitionAction} items={items} requesterName={editing?.requester_name ?? profile.full_name} defaultDate={editing?.request_date ?? universityDate()} request={editing ?? undefined}/>
      </section>}
      <section className="sys-card">
        <div className="sys-card-header"><div><h2>{manager ? "Requests for review" : "Request history"}</h2><p>{manager ? "Check the requestor, item code, and quantity before approving." : "Your latest school staff requisitions. Direct stock outs are recorded separately."}</p></div></div>
        <Form className="sys-toolbar" action="/requisitions"><label className="sys-field"><span>Status</span><select className="sys-select" name="status" defaultValue={statusFilter}><option value="">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option></select></label><button type="submit" className="sys-button sys-button-secondary">Filter</button></Form>
        {requests.length ? <div className="sys-table-wrap"><table className="sys-table">
          <thead><tr><th>Item name / code</th><th>Name of requestor</th><th>Date</th><th>Quantity</th><th>Status</th><th>Review</th></tr></thead>
          <tbody>{requests.map(request => {
            const item = request.item;
            const recorderName = request.recorder?.full_name || request.recorder?.email;
            const isOwn = request.requester_id === user.id;
            return <tr key={request.id}>
              <td><strong>{request.item_name || item?.name || "Supply item"}</strong><small>{request.item_code || item?.sku}</small><small>{request.purpose}</small>{request.review_note && <small>Review note: {request.review_note}</small>}</td>
              <td>{request.requester_name || recorderName || "School staff"}{manager && <small>Recorded by: {recorderName || "Staff account"}</small>}</td>
              <td>{formatRequestDate(request.request_date || universityDate(new Date(request.created_at)))}<small>Submitted: {formatDate(request.created_at)}</small></td>
              <td>{formatNumber(request.quantity)} {item?.unit || "units"}</td>
              <td><StatusBadge status={request.status}/></td>
              <td><div className="sys-stack">{request.status === "pending" && (manager || isOwn) && <Link className="sys-button sys-button-secondary sys-button-small" href={`/requisitions?edit=${request.id}#request-form`}>Edit request</Link>}{request.status === "pending" && manager ? <ReviewForm key={`${request.id}:${request.version}`} action={reviewRequisitionAction} requestId={request.id} version={request.version}/> : request.status === "pending" && isOwn ? <CancelRequestForm action={cancelRequisitionAction} requestId={request.id}/> : <Link className="sys-link" href={item ? "/inventory/" + item.id : "/inventory"}>View supply</Link>}{manager && <Link className="sys-link" href={`/requisitions?log_request=${request.id}#activity-log`}>View log</Link>}</div></td>
            </tr>;
          })}</tbody>
        </table></div> : <EmptyState title="No requisitions found" description={statusFilter ? "There are no requests with this status." : manager ? "School staff requisitions will appear here when submitted." : "Submitted requisitions will appear here. You can stock out supplies directly without a requisition."} action={!manager ? <Link href="/scan" className="sys-button sys-button-secondary">Go to stock out</Link> : undefined}/>}
        <Pagination pathname="/requisitions" query={{ ...(statusFilter ? { status: statusFilter } : {}), ...(logRequestId ? { log_request: logRequestId } : {}), log_page: String(logPage) }} page={page} totalPages={totalPages} label="Requisition pages"/>
      </section>
      {manager && <RequisitionLogs logs={logs} count={logCount} page={logPage} requestId={logRequestId}/>}
    </div>
  </>;
}
