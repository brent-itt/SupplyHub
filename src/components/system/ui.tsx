import type { ReactNode } from "react";
import type { Item, RequestStatus } from "@/lib/types";
import { Icon, type IconName } from "./icons";

export { Icon } from "./icons";

export function PageHeading({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return <div className="sys-page-heading"><div>{eyebrow && <p className="sys-eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p className="sys-page-description">{description}</p>}</div>{actions && <div className="sys-page-actions">{actions}</div>}</div>;
}

export function StatCard({ label, value, detail, icon = "inventory", tone = "green" }: { label: string; value: string | number; detail?: string; icon?: IconName; tone?: "green" | "blue" | "amber" | "red" }) {
  return <div className={`sys-stat-card sys-tone-${tone}`}><div className="sys-stat-top"><span>{label}</span><span className="sys-stat-icon"><Icon name={icon}/></span></div><strong className="sys-stat-value">{typeof value === "number" ? value.toLocaleString("en-PH") : value}</strong>{detail && <p>{detail}</p>}</div>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="sys-empty-state"><span className="sys-empty-icon"><Icon name="inventory" size={30}/></span><h2>{title}</h2><p>{description}</p>{action && <div className="sys-empty-action">{action}</div>}</div>;
}

export function ErrorNotice({ message }: { message: string }) {
  return <div className="sys-notice sys-notice-error" role="alert"><Icon name="alert"/><p>{message}</p></div>;
}

export function StockBadge({ item }: { item: Pick<Item, "quantity" | "low_stock_threshold" | "is_archived"> }) {
  if (item.is_archived) return <span className="sys-badge sys-badge-neutral">Archived</span>;
  if (item.quantity === 0) return <span className="sys-badge sys-badge-red"><span/>Out of stock</span>;
  if (item.quantity <= item.low_stock_threshold) return <span className="sys-badge sys-badge-amber"><span/>Low stock</span>;
  return <span className="sys-badge sys-badge-green"><span/>In stock</span>;
}

export function StatusBadge({ status }: { status: RequestStatus }) {
  const tones = { pending: "amber", approved: "green", rejected: "red", cancelled: "neutral" };
  return <span className={`sys-badge sys-badge-${tones[status]}`}>{status.charAt(0).toUpperCase() + status.slice(1)}</span>;
}
