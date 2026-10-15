import { createServerClient } from "@supabase/ssr";
import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "@/lib/supabase/config";

function isInvalidSession(error: unknown) {
  if (isAuthSessionMissingError(error)) return true;
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return error.code === "refresh_token_not_found" || error.code === "refresh_token_already_used" || error.code === "session_not_found" || error.code === "session_expired";
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  response.headers.set("Cache-Control", "private, no-store");
  const config = getSupabaseConfig();
  if (!config) return response;
  // The callback exchanges a fresh code itself. Refreshing an old session here
  // can delete the PKCE verifier needed by that exchange.
  if (request.nextUrl.pathname === "/auth/callback") return response;
  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        const previousCookies = response.cookies.getAll();
        cookiesToSet.forEach(({ name, value, options }) => {
          if (options.maxAge === 0) request.cookies.delete(name);
          else request.cookies.set(name, value);
        });
        response = NextResponse.next({ request });
        previousCookies.forEach(cookie => response.cookies.set(cookie));
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        response.headers.set("Cache-Control", "private, no-store");
      },
    },
  });
  // Verification also refreshes expiring tokens before Server Components read them.
  let authError: unknown;
  try {
    const { error } = await supabase.auth.getClaims();
    authError = error;
  } catch (error) {
    if (!isInvalidSession(error)) throw error;
    authError = error;
  }
  if (isInvalidSession(authError)) {
    // Clear only this project's session and its chunks, keeping unrelated cookies.
    const storageKey = `sb-${new URL(config.url).hostname.split(".")[0]}-auth-token`;
    const staleCookies = request.cookies.getAll().filter(({ name }) =>
      name === storageKey || name === `${storageKey}-user` ||
      (name.startsWith(`${storageKey}.`) && /^\d+$/.test(name.slice(storageKey.length + 1))) ||
      (name.startsWith(`${storageKey}-user.`) && /^\d+$/.test(name.slice(storageKey.length + 6)))
    );
    staleCookies.forEach(({ name }) => request.cookies.delete(name));
    const previousCookies = response.cookies.getAll();
    const isPageRequest = request.method === "GET" &&
      !request.nextUrl.pathname.startsWith("/auth/") &&
      !request.nextUrl.pathname.startsWith("/api/");
    if (isPageRequest) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("notice", "session_expired");
      if (request.nextUrl.pathname !== "/login") {
        loginUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
      } else if (request.nextUrl.searchParams.has("next")) {
        loginUrl.searchParams.set("next", request.nextUrl.searchParams.get("next")!);
      }
      response = NextResponse.redirect(loginUrl);
    } else {
      response = NextResponse.next({ request });
    }
    previousCookies.forEach(cookie => response.cookies.set(cookie));
    staleCookies.forEach(({ name }) => response.cookies.set(name, "", { path: "/", maxAge: 0 }));
    response.headers.set("Cache-Control", "private, no-store");
  }
  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/inventory/:path*", "/requisitions/:path*", "/vip-queue/:path*", "/student-logs/:path*", "/reports/:path*", "/scan/:path*", "/users/:path*", "/account/:path*", "/login", "/forgot-password", "/reset-password", "/access-pending", "/auth/:path*", "/api/:path*"],
};
