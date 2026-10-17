"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function DashboardRefresh({ updatedAt }: { updatedAt: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const [offline, setOffline] = useState(false);
  const [stale, setStale] = useState(false);
  useEffect(() => { busy.current = pending; }, [pending]);

  useEffect(() => {
    function refresh() {
      setOffline(!navigator.onLine);
      setStale(Date.now() - new Date(updatedAt).getTime() > 45000);
      if (!navigator.onLine || document.visibilityState !== "visible" || busy.current) return;
      busy.current = true;
      startTransition(() => router.refresh());
    }
    const timer = setInterval(refresh, 15000);
    const updateConnection = () => { setOffline(!navigator.onLine); if (navigator.onLine) refresh(); };
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router, updatedAt]);

  return <div className="dashboard-refresh">
    <div><span className={`sys-badge ${offline || stale ? "sys-badge-amber" : "sys-badge-green"}`}>{offline ? "Offline" : stale ? "Updates delayed" : "Auto-refresh · 15 sec"}</span><p role="status">{offline ? "Showing the last available data. Updates resume when you reconnect." : pending ? "Updating dashboard…" : <>Last updated <time dateTime={updatedAt}>{new Date(updatedAt).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></>}</p></div>
    <button type="button" className="sys-button sys-button-secondary sys-button-small" disabled={pending || offline} onClick={() => { busy.current = true; startTransition(() => router.refresh()); }}>{pending ? "Refreshing…" : "Refresh now"}</button>
  </div>;
}
