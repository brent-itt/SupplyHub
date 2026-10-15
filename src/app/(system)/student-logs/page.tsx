import Form from "next/form";
import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { pageNumber, searchTerm } from "@/lib/validation";
import { formatDate } from "@/lib/format";
import { formatRequestDate } from "@/lib/requisitions";
import type { StudentStockOutLog } from "@/lib/student-stock-out";
import { EmptyState, PageHeading, ErrorNotice } from "@/components/system/ui";
import { StudentLogReview } from "@/components/student-log-review";
import { StudentLogRefresh } from "@/components/student-log-refresh";

export default async function StudentLogsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase } = await requireProfile(["staff", "admin", "super_admin"], "/student-logs");
  const params = await searchParams;
  const status = ["pending", "issued", "rejected", "all"].includes(String(params.status)) ? String(params.status) : "pending";
  const search = searchTerm(params.q);
  const page = pageNumber(params.page);
  let query = supabase.from("student_stock_out_logs").select("*,student_email,fulfilled_quantity,vip_queued_at", { count: "exact" }).order("created_at", { ascending: false }).order("id", { ascending: false });
  if (status !== "all") query = query.eq("status", status);
  if (search) query = query.or(`student_name.ilike.%${search}%,student_email.ilike.%${search}%,receipt_number.ilike.%${search}%,item_name.ilike.%${search}%`);
  const { data, error, count } = await query.range((page - 1) * 25, page * 25 - 1);
  const logs = (data ?? []) as StudentStockOutLog[];
  const pageLink = (next: number) => `/student-logs?${new URLSearchParams({ status, q: search, page: String(next) })}`;
  return <>
    <PageHeading eyebrow="SUPPLIES COUNTER" title="Student stock-out log" description="Review the receipt, then continue to Barcode stock out. Scan the requested item to complete issuance. This page refreshes every 30 seconds."
      actions={<><StudentLogRefresh/><Link className="sys-button" href="/student-logs/qr">Student form QR code</Link></>}/>
    <Form className="sys-filters sys-toolbar" action="/student-logs">
      <label className="sys-field"><span>Search submissions</span><input className="sys-input" name="q" placeholder="Name, email, receipt number, or item" defaultValue={search}/></label>
      <label className="sys-field"><span>Status</span><select className="sys-select" name="status" defaultValue={status}><option value="pending">Pending</option><option value="issued">Issued</option><option value="rejected">Rejected</option><option value="all">All submissions</option></select></label>
      <button className="sys-button" type="submit">Apply filters</button><Link className="sys-link" href="/form" target="_blank">Open student form</Link>
    </Form>
    {error ? <ErrorNotice message={["42P01", "PGRST205", "42703", "PGRST204"].includes(error.code) ? "Student logs need database setup. Apply the student-log migrations through 202610150001_student_vip_queue.sql in Supabase, then refresh this page." : "Unable to load student logs. Please refresh and try again."}/> : <section className="sys-card sys-card-flush">
      <div className="sys-card-header"><div><h2>{status === "pending" ? "Waiting for staff confirmation" : "Submission history"}</h2><p>{count ?? 0} matching submissions · newest first</p></div></div>
      {logs.length ? <div className="sys-table-wrap"><table className="sys-table"><thead><tr><th>Student / submitted</th><th>Receipt</th><th>Item</th><th>Status</th><th>Processing log</th></tr></thead><tbody>{logs.map(log => <tr key={log.id}>
        <td><strong>{log.student_name}</strong>{log.student_email && <small><a className="sys-link" href={`mailto:${log.student_email}`}>{log.student_email}</a></small>}<small>{formatDate(log.created_at)}</small><small className="student-log-reference">{log.id}</small></td>
        <td><strong>{log.receipt_number}</strong><small>{formatRequestDate(log.receipt_date)}</small></td>
        <td><strong>{log.item_name}</strong><small>{log.item_code}</small><span>{log.quantity} {log.unit} requested</span><small>{log.fulfilled_quantity} issued ? {log.quantity - log.fulfilled_quantity} unfilled</small></td>
        <td><span className={`sys-badge sys-badge-${log.status === "pending" ? "amber" : log.status === "issued" ? "green" : "red"}`}>{log.status === "pending" ? log.vip_queued_at ? "VIP Queue" : "Pending" : log.status === "issued" ? "Issued" : "Rejected"}</span></td>
        <td>{log.status === "pending" ? <StudentLogReview id={log.id} quantity={log.quantity - log.fulfilled_quantity} unit={log.unit}/> : <><strong>{log.processed_by_name || "Staff account"}</strong><small>{log.processed_at && formatDate(log.processed_at)}</small>{log.processing_note && <p>{log.processing_note}</p>}{log.transaction_id && <small className="student-log-reference">Transaction: {log.transaction_id}</small>}</>}</td>
      </tr>)}</tbody></table></div> : <EmptyState title="No matching submissions" description="Students can scan the QR code and fill out the form. Their submissions will appear here."/>}
    </section>}
    {!error && <div className="sys-pagination"><span>Page {page} of {Math.max(1, Math.ceil((count ?? 0) / 25))}</span><div>{page > 1 && <Link className="sys-button sys-button-secondary" href={pageLink(page - 1)}>Previous</Link>}{page * 25 < (count ?? 0) && <Link className="sys-button sys-button-secondary" href={pageLink(page + 1)}>Next</Link>}</div></div>}
  </>;
}
