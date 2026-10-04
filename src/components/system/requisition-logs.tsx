import Link from "next/link";
import { formatDate } from "@/lib/format";
import { requisitionChanges, requisitionEventLabels } from "@/lib/requisition-logs";
import type { RequisitionLog } from "@/lib/types";

export function RequisitionLogs({ logs, count, page, requestId }: { logs: RequisitionLog[]; count: number; page: number; requestId: string }) {
  const pages = Math.max(1, Math.ceil(count / 25));
  const href = (next: number) => `/requisitions?${new URLSearchParams({ log_page: String(next), ...(requestId ? { log_request: requestId } : {}) })}#activity-log`;
  return <section className="sys-card" id="activity-log" aria-labelledby="activity-log-title">
    <div className="sys-card-header"><div><h2 id="activity-log-title">Requisition activity log</h2><p>Submissions, edits, and decisions recorded from the time logging was enabled.</p></div>{requestId && <Link href="/requisitions#activity-log" className="sys-button sys-button-secondary">Show all logs</Link>}</div>
    {requestId && <p className="sys-form-hint" style={{ marginBottom: 16, overflowWrap: "anywhere" }}>Requisition: {requestId}</p>}
    {logs.length ? <div className="sys-table-wrap"><table className="sys-table">
      <thead><tr><th>Date & time</th><th>Changed by</th><th>Activity</th><th>Requisition</th><th>Details</th></tr></thead>
      <tbody>{logs.map(log => <tr key={log.id}>
        <td>{formatDate(log.created_at)}</td><td>{log.actor_name}</td><td>{requisitionEventLabels[log.event]}</td>
        <td><strong>{log.after_data.item_name || "Supply request"}</strong><small>{log.after_data.item_code} · {log.after_data.requester_name}</small><Link className="sys-link" href={`/requisitions?log_request=${log.request_id}#activity-log`}>View request log</Link></td>
        <td><details className="sys-audit-details"><summary>{log.event === "submitted" ? "View submitted details" : "View changes"}</summary><dl>{requisitionChanges(log).map(change => <div key={change.label}><dt>{change.label}</dt><dd>{log.before_data && <><span className="sys-muted">Before: </span>{change.before}<br/></>}<span className="sys-muted">{log.before_data ? "After: " : "Value: "}</span>{change.after}</dd></div>)}</dl></details></td>
      </tr>)}</tbody>
    </table></div> : <p className="sys-muted">No activity recorded{requestId ? " for this requisition" : ""} yet. Earlier changes are not available.</p>}
    {pages > 1 && <nav className="sys-pagination" aria-label="Activity log pages"><span>{count} entries · Page {page} of {pages}</span><div>{page > 1 && <Link href={href(page - 1)} className="sys-button sys-button-secondary sys-button-small">Previous</Link>}{page < pages && <Link href={href(page + 1)} className="sys-button sys-button-secondary sys-button-small">Next</Link>}</div></nav>}
  </section>;
}
