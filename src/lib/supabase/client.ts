"use client";
import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseConfig } from "./config";

export function createSupabaseBrowser() {
  const config = getSupabaseConfig();
  if (!config) throw new Error("Supabase connection has not been configured.");
  return createBrowserClient(config.url, config.key);
}
