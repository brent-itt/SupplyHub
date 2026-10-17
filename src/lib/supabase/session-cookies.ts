import type { CookieOptions } from "@supabase/ssr";

export const REMEMBER_MAX_AGE = 30 * 24 * 60 * 60;
export type AuthCookie = { name: string; value: string; options: CookieOptions };

export function authStorageKey(url: string) {
  return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
}

export function rememberCookieName(storageKey: string) {
  return `${storageKey}-remember`;
}

export function isSessionCookie(name: string, storageKey: string) {
  return [storageKey, `${storageKey}-user`].some(base => name === base ||
    (name.startsWith(`${base}.`) && /^\d+$/.test(name.slice(base.length + 1))));
}

// Supabase supplies a persistent Max-Age for every token write, including
// refreshes. Apply the user's choice at the cookie adapter on every write.
export function prepareAuthCookies(cookies: AuthCookie[], storageKey: string, remember: boolean): AuthCookie[] {
  let hasSession = false;
  const result = cookies.map(cookie => {
    if (!isSessionCookie(cookie.name, storageKey) || cookie.options.maxAge === 0 || !cookie.value) return cookie;
    hasSession = true;
    const options = { ...cookie.options };
    delete options.maxAge;
    delete options.expires;
    if (remember) options.maxAge = REMEMBER_MAX_AGE;
    return { ...cookie, options };
  });
  if (hasSession) result.push({
    name: rememberCookieName(storageKey), value: remember ? "1" : "0",
    options: { path: "/", sameSite: "lax", ...(remember ? { maxAge: REMEMBER_MAX_AGE } : {}) },
  });
  return result;
}
