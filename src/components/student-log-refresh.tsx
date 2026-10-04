"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

export function StudentLogRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 30000);
    return () => clearInterval(timer);
  }, [router]);
  return <button className="sys-button sys-button-secondary sys-no-print" disabled={pending} onClick={() => startTransition(() => router.refresh())}>{pending ? "Refreshing…" : "Refresh logs"}</button>;
}
