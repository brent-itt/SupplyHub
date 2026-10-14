import Form from "next/form";
import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { pageNumber, searchTerm } from "@/lib/validation";
import type { VipQueueEntry } from "@/lib/student-stock-out";
import { EmptyState, ErrorNotice, PageHeading, Pagination } from "@/components/system/ui";
import { StudentLogRefresh } from "@/components/student-log-refresh";
import { StudentLogReview } from "@/components/student-log-review";
import { VipReminder } from "@/components/vip-reminder";

export default async function VipQueuePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase } = await requireProfile(["admin", "super_admin"], "/vip-queue");
  const params = await searchParams;
  const search = searchTerm(params.q);
  const page = pageNumber(params.page);
  let query = supabase.from("student_vip_queue").select("*,queue_position,reminder_position", { count: "exact" }).order("created_at").order("id");
  if (search) query = query.or(`student_name.ilike.%${search}%,student_email.ilike.%${search}%,receipt_number.ilike.%${search}%,item_name.ilike.%${search}%`);
  const { data, error, count } = await query.range((page - 1) * 25, page * 25 - 1);
  const entries = (data ?? []) as VipQueueEntry[];

  return <>
    <PageHeading eyebrow="PRIORITY COLLECTIONS" title="VIP Queue" description="Students waiting for unfilled supplies. Stock is reserved for earlier submissions of the same item. Scan to issue what is available; the balance stays here until collected." actions={<StudentLogRefresh/>}/>
    <Form className="sys-filters sys-toolbar" action="/vip-queue">
      <label className="sys-field"><span>Search queue</span><input className="sys-input" name="q" placeholder="Student, email, receipt, or item" defaultValue={search}/></label>
      <button className="sys-button" type="submit">Search</button>
      <Link className="sys-link" href="/student-logs">All student submissions</Link>
    </Form>
    {error ? <ErrorNotice message={["42P01", "PGRST205", "42703", "PGRST204"].includes(error.code) ? "VIP Queue needs database setup. Apply the migrations through 202610150004_vip_queue_positions.sql in Supabase, then refresh this page." : "Unable to load VIP Queue. Please refresh and try again."}/> : <section className="sys-card sys-card-flush">
      <div className="sys-card-header"><div><h2>Waiting students</h2><p>{count ?? 0} matching requests · oldest submission first · refreshes every 30 seconds</p></div></div>
      <p className="vip-queue-hint">Queue numbers follow submission order across all items. Reminder numbers show the oldest requests with stock ready to collect. Stock priority remains per item. Sending a reminder does not change these numbers.</p>
      {entries.length ? <div className="sys-table-wrap"><table className="sys-table"><thead><tr><th>Queue #</th><th>Student / email</th><th>Item / receipt</th><th>Collection progress</th><th>Priority / availability</th><th>Remind order</th><th>Action</th></tr></thead><tbody>{entries.map(entry => <tr key={entry.id}>
        <td><strong className="vip-queue-number">#{entry.queue_position}</strong>{entry.queue_position === 1 && <span className="sys-badge sys-badge-green">First in line</span>}</td>
        <td><strong>{entry.student_name}</strong>{entry.student_email ? <small><a className="sys-link" href={`mailto:${entry.student_email}`}>{entry.student_email}</a></small> : <small>Email not provided on original form</small>}<small>Submitted {formatDate(entry.created_at)}</small></td>
        <td><strong>{entry.item_name}</strong><small>{entry.item_code}</small><small>Receipt: {entry.receipt_number}</small></td>
        <td><span>{entry.quantity} {entry.unit} requested</span><small>{entry.fulfilled_quantity} issued</small><strong>{entry.remaining_quantity} remaining</strong></td>
        <td><span className={`sys-badge sys-badge-${entry.available_quantity > 0 ? "green" : "amber"}`}>{entry.is_archived ? "Item archived" : entry.available_quantity > 0 ? `${entry.available_quantity} ready to issue` : "Waiting for stock"}</span><small>#{entry.item_position} for this item</small><small>{entry.stock_quantity} {entry.unit} in stock</small></td>
        <td>{entry.reminder_position !== null ? <><strong className="vip-queue-number">#{entry.reminder_position}</strong>{entry.reminder_position === 1 && <span className="sys-badge sys-badge-green">Remind first</span>}<small>Ready for collection</small></> : <span className="sys-muted">{entry.is_archived ? "Item archived" : "Awaiting stock"}</span>}</td>
        <td>{entry.available_quantity > 0 && <Link className="sys-button sys-button-small" href={`/scan?student_log=${entry.id}`}>Scan & issue {entry.available_quantity}</Link>}<div className="vip-row-actions"><StudentLogReview id={entry.id} quantity={entry.remaining_quantity} unit={entry.unit}/><VipReminder entry={entry}/></div></td>
      </tr>)}</tbody></table></div> : <EmptyState title="No students waiting" description="Requests that exceed available stock appear here automatically. Fully collected or rejected requests leave the queue."/>}
    </section>}
    {!error && <Pagination pathname="/vip-queue" query={{ q: search }} page={page} totalPages={Math.max(1, Math.ceil((count ?? 0) / 25))}/>}
  </>;
}
