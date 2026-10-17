import { formatNumber } from "@/lib/format";
import type { movementTrend, stockHealth } from "@/lib/dashboard-analytics";
import type { RequestStatus } from "@/lib/types";

export function DashboardCharts({ health, requests, trend, manager, transactionsAvailable }: {
  health: ReturnType<typeof stockHealth>;
  requests: Record<RequestStatus, number>;
  trend: ReturnType<typeof movementTrend>;
  manager: boolean;
  transactionsAvailable: boolean;
}) {
  const maximum = Math.max(1, ...trend.flatMap(day => [day.stockIn, day.stockOut]));
  const totalStock = health.healthy + health.low + health.out;
  const totalRequests = Object.values(requests).reduce((sum, count) => sum + count, 0);
  return <section className="dashboard-analytics" aria-label="Live analytics">
    <div className="sys-grid-2">
      <div className="sys-card"><h2>Stock health</h2><p className="sys-muted">All active supply types</p><div className="analytics-breakdown">{([["In stock", health.healthy, "green"], ["Low stock", health.low, "amber"], ["Out of stock", health.out, "red"]] as const).map(([label, count, tone]) => <div key={label}><div><span>{label}</span><strong>{formatNumber(count)}</strong></div><progress className={`analytics-progress analytics-${tone}`} value={count} max={Math.max(1, totalStock)} aria-label={`${label}: ${count} of ${totalStock} supplies`}/></div>)}</div></div>
      <div className="sys-card"><h2>{manager ? "Requisition status" : "My request status"}</h2><p className="sys-muted">{formatNumber(totalRequests)} total requests · all time</p><div className="analytics-breakdown">{Object.entries(requests).map(([status, count]) => <div key={status}><div><span className="analytics-label">{status}</span><strong>{formatNumber(count)}</strong></div><progress className="analytics-progress" value={count} max={Math.max(1, totalRequests)} aria-label={`${status}: ${count} of ${totalRequests} requests`}/></div>)}</div></div>
    </div>
    <div className="sys-card analytics-movements"><div className="sys-card-header"><div><h2>{manager ? "Stock movement" : "My stock movement"}</h2><p>Last 7 calendar days · Philippine time · combined units across supply types</p></div></div>
      {!transactionsAvailable ? <p className="sys-notice">Your transaction analytics are unavailable. Ask the Supplies Office to configure staff analytics access.</p> : <>
        <div className="analytics-legend"><span><i className="analytics-in"/>Stock in</span><span><i className="analytics-out"/>Stock out</span></div>
        <div className="analytics-chart" role="img" aria-label="Daily stock-in and stock-out units. Exact values are in the table below.">{trend.map(day => <div className="analytics-day" key={day.date}><div className="analytics-bars"><span className="analytics-in" style={{ height: `${day.stockIn / maximum * 100}%` }}/><span className="analytics-out" style={{ height: `${day.stockOut / maximum * 100}%` }}/></div><span>{day.date.slice(5).replace("-", "/")}</span></div>)}</div>
        <div className="sys-table-wrap"><table className="sys-table"><caption className="sys-muted">Daily activity totals</caption><thead><tr><th>Date</th><th>Units in</th><th>Units out</th><th>Adjustments</th><th>Transactions</th></tr></thead><tbody>{trend.map(day => <tr key={day.date}><td>{day.date}</td><td>{formatNumber(day.stockIn)}</td><td>{formatNumber(day.stockOut)}</td><td>{day.adjustments}</td><td>{day.transactions}</td></tr>)}</tbody></table></div>
      </>}
    </div>
  </section>;
}
