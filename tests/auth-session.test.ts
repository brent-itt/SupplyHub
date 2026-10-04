import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "../src/proxy";

const cookieName = "sb-session-test-auth-token";
const user = { id: "10000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "staff@example.test", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
function sessionCookie(expiresAt: number) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, exp: expiresAt, iat: expiresAt - 3600, aud: "authenticated" })}.c2lnbmF0dXJl`;
  return { access_token: token, refresh_token: "test-refresh-token", expires_at: expiresAt, expires_in: 3600, token_type: "bearer", user };
}
function request(path = "/inventory?category=Paper", method = "GET") {
  const value = "base64-" + Buffer.from(JSON.stringify(sessionCookie(1))).toString("base64url");
  const middle = Math.floor(value.length / 2);
  return new NextRequest(`http://localhost:3000${path}`, { method, headers: {
    cookie: `${cookieName}.0=${value.slice(0, middle)}; ${cookieName}.1=${value.slice(middle)}; ${cookieName}-code-verifier=keep-verifier; theme=dark; sb-other-auth-token=keep-other`,
  } });
}

test("invalid sessions clear cookies, redirect once, and preserve fresh auth flows", async t => {
  // The SDK logs expected rejected-session warnings from its auth listeners.
  t.mock.method(console, "warn", () => {});
  const oldUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const oldKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://session-test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-key";
  t.after(() => {
    if (oldUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = oldKey;
  });
  let errorCode = "refresh_token_not_found";
  let refreshCalls = 0;
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    refreshCalls++;
    return new Response(JSON.stringify({ code: errorCode, message: "Invalid Refresh Token" }), { status: 400, headers: { "Content-Type": "application/json", "x-supabase-api-version": "2024-01-01" } });
  });
  for (const code of ["refresh_token_not_found", "refresh_token_already_used", "session_not_found", "session_expired"]) {
    errorCode = code;
    const req = request();
    const response = await proxy(req);
    assert.equal(response.status, 307);
    const location = new URL(response.headers.get("location")!);
    assert.equal(location.pathname, "/login");
    assert.equal(location.searchParams.get("notice"), "session_expired");
    assert.equal(location.searchParams.get("next"), "/inventory?category=Paper");
    for (const suffix of [".0", ".1"]) {
      assert.equal(response.cookies.get(cookieName + suffix)?.maxAge, 0);
      assert.equal(req.cookies.has(cookieName + suffix), false);
    }
    for (const name of ["theme", "sb-other-auth-token"]) {
      assert.equal(req.cookies.has(name), true);
      assert.equal(response.cookies.has(name), false);
    }
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    const callsBefore = refreshCalls;
    const nextResponse = await proxy(new NextRequest(location, { headers: { cookie: req.cookies.toString() } }));
    assert.equal(nextResponse.status, 200, "The cleaned login request must not redirect again");
    assert.equal(refreshCalls, callsBefore, "The discarded refresh token must not be retried");
  }
  const callback = request("/auth/callback?code=fresh");
  const callsBeforeCallback = refreshCalls;
  const callbackResponse = await proxy(callback);
  assert.equal(callbackResponse.status, 200);
  assert.equal(refreshCalls, callsBeforeCallback, "The callback must exchange its new code without refreshing stale credentials");
  assert.equal(callback.cookies.get(cookieName + "-code-verifier")?.value, "keep-verifier");
  assert.equal(callbackResponse.cookies.getAll().length, 0);
  for (const [path, method] of [["/api/barcode", "GET"], ["/login", "POST"]]) {
    const req = request(path, method);
    const response = await proxy(req);
    assert.equal(response.status, 200, "Route handlers and actions must continue after cleanup");
    assert.equal(req.cookies.has(cookieName + ".0"), false);
    assert.equal(response.cookies.get(cookieName + ".0")?.maxAge, 0);
    assert.ok(response.headers.get("x-middleware-request-cookie")?.includes("theme=dark"));
    assert.ok(!response.headers.get("x-middleware-request-cookie")?.includes(cookieName + ".0="));
  }

  fetchMock.mock.mockImplementation(async (input: string | URL | Request) => {
    const url = String(input);
    return new Response(JSON.stringify(url.includes("/token") ? sessionCookie(Math.floor(Date.now() / 1000) + 3600) : user), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  const refreshed = await proxy(request());
  assert.equal(refreshed.status, 200, "Successful refresh must continue to the requested page");
  assert.ok(refreshed.cookies.getAll().some(cookie => cookie.name.startsWith(cookieName) && cookie.value && cookie.maxAge !== 0));

  fetchMock.mock.mockImplementation(async () => new Response(JSON.stringify({ message: "Temporarily unavailable" }), { status: 503, headers: { "Content-Type": "application/json" } }));
  const unavailableRequest = request();
  const unavailableResponse = await proxy(unavailableRequest);
  assert.equal(unavailableResponse.status, 200, "Temporary Auth failures must not redirect as an expired session");
  assert.equal(unavailableResponse.cookies.getAll().length, 0, "Temporary failures must not expire browser credentials");
  assert.equal(unavailableRequest.cookies.has(cookieName + ".0"), true);
});
