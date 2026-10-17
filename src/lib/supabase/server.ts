import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseConfig } from "./config";
import { authStorageKey, prepareAuthCookies, rememberCookieName } from "./session-cookies";

export async function createSupabaseServer({ rememberMe }: { rememberMe?: boolean } = {}) {
  const config = getSupabaseConfig();
  if (!config) throw new Error("Supabase connection has not been configured.");
  const cookieStore = await cookies();
  const storageKey = authStorageKey(config.url);
  return createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          const remember = rememberMe ?? cookieStore.get(rememberCookieName(storageKey))?.value === "1";
          prepareAuthCookies(cookiesToSet, storageKey, remember).forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components are read-only; proxy refreshes the response cookies.
        }
      },
    },
  });
}
