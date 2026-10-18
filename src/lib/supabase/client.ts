"use client";
import { createBrowserClient, parseCookieHeader, serializeCookieHeader } from "@supabase/ssr";
import { getSupabaseConfig } from "./config";
import { authStorageKey, prepareAuthCookies, rememberCookieName } from "./session-cookies";

export function createSupabaseBrowser() {
  const config = getSupabaseConfig();
  if (!config) throw new Error("Supabase connection has not been configured.");
  const storageKey = authStorageKey(config.url);
  return createBrowserClient(config.url, config.key, {
    // The callback explicitly handles both legacy PKCE codes and recovery fragments.
    auth: { detectSessionInUrl: false, autoRefreshToken: false },
    cookies: {
      getAll: () => typeof document === "undefined" ? [] : parseCookieHeader(document.cookie).map(({ name, value }) => ({ name, value: value ?? "" })),
      setAll(cookiesToSet) {
        if (typeof document === "undefined") return;
        const remember = parseCookieHeader(document.cookie).some(cookie => cookie.name === rememberCookieName(storageKey) && cookie.value === "1");
        prepareAuthCookies(cookiesToSet, storageKey, remember).forEach(({ name, value, options }) => {
          document.cookie = serializeCookieHeader(name, value, options);
        });
      },
    },
  });
}
