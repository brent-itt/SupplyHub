"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/format";

export function DataRefresh({ updatedAt, subject = "dashboard", intervalMs = 30000 }: { updatedAt: string | null; subject?: string; intervalMs?: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const printing = useRef(false);
  const [offline, setOffline] = useState(false);
  const [stale, setStale] = useState(false);
  useEffect(() => { busy.current = pending; }, [pending]);

  useEffect(() => {
    function refresh() {
      setOffline(!navigator.onLine);
      setStale(!updatedAt || Date.now() - new Date(updatedAt).getTime() > intervalMs * 3);
      if (!navigator.onLine || document.visibilityState !== "visible" || busy.current || printing.current) return;
      busy.current = true;
      startTransition(() => router.refresh());
    }
    const timer = setInterval(refresh, intervalMs);
    const updateConnection = () => { setOffline(!navigator.onLine); if (navigator.onLine) refresh(); };
    const beforePrint = () => { printing.current = true; };
    const afterPrint = () => { printing.current = false; };
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", afterPrint);
    };
  }, [router, updatedAt, intervalMs]);

  return <div className="dashboard-refresh">
    <div><span className={`sys-badge ${offline || stale || !updatedAt ? "sys-badge-amber" : "sys-badge-green"}`}>{offline ? "Offline" : !updatedAt ? "Update unavailable" : stale ? "Updates delayed" : `Auto-refresh · ${intervalMs / 1000} sec`}</span><p role="status">{offline ? "Updates resume when you reconnect." : pending ? `Updating ${subject}…` : updatedAt ? <>Last updated <time dateTime={updatedAt}>{formatDate(updatedAt)}</time> · Philippine time</> : "Unable to check availability. Try refreshing."}</p></div>
    <button type="button" className="sys-button sys-button-secondary sys-button-small" disabled={pending || offline} onClick={() => { busy.current = true; startTransition(() => router.refresh()); }}>{pending ? "Refreshing…" : "Refresh now"}</button>
  </div>;
}
