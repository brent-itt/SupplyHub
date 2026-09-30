import type { ReactNode } from "react";

export type IconName = "dashboard" | "inventory" | "requests" | "scan" | "reports" | "users" | "signout" | "arrow" | "plus" | "search" | "alert" | "check" | "download" | "print" | "clock" | "lock";

const paths: Record<IconName, ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  inventory: <><path d="m12 3 9 5v8l-9 5-9-5V8Z"/><path d="m3 8 9 5 9-5M12 13v8M7.5 5.5l9 5"/></>,
  requests: <><rect x="5" y="4" width="14" height="17" rx="2"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="m8 11 1 1 2-2M13 11h3m-8 5 1 1 2-2m2 1h3"/></>,
  scan: <><path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5M3 12h18"/><path d="M7 7h3v3H7zm7 0h3v3h-3zM7 15h3v3H7zm7 0v3h3v-3"/></>,
  reports: <><path d="M4 3v18h17M8 16v-5m5 5V6m5 10V9"/></>,
  users: <><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v3"/></>,
  signout: <><path d="M10 4H4v16h6m5-12 4 4-4 4m-7-4h11"/></>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
  alert: <><path d="m12 3 10 18H2Z"/><path d="M12 9v5m0 3v.1"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></>,
  print: <><path d="M7 8V3h10v5M7 17H3V8h18v9h-4"/><path d="M7 13h10v8H7zm10-2h.01"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></>,
};

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>{paths[name]}</svg>;
}
