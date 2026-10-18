"use client";

import { useEffect, useRef } from "react";
import { completeAuthCallback, recoveryErrorPath } from "@/lib/password-recovery";
import { createSupabaseBrowser } from "@/lib/supabase/client";

export function AuthCallback() {
  const started = useRef(false);
  useEffect(() => {
    // A one-time code must not be exchanged twice by Strict Mode's effect replay.
    if (started.current) return;
    started.current = true;
    const url = new URL(window.location.href);
    window.history.replaceState(null, "", url.pathname);
    async function finish() {
      try {
        const destination = await completeAuthCallback(url, createSupabaseBrowser());
        // A full navigation ensures Server Components read the newly written cookies.
        window.location.replace(destination);
      } catch {
        window.location.replace(recoveryErrorPath);
      }
    }
    void finish();
  }, []);
  return <p role="status">Verifying your email link…</p>;
}
