import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserClient, createServerClient } from "@supabase/ssr";
import { verificationClient } from "../src/lib/email-verification";
import { completeAuthCallback, passwordRecoveryRedirect, recoveryErrorPath, sendPasswordRecovery } from "../src/lib/password-recovery";
import { authStorageKey, prepareAuthCookies } from "../src/lib/supabase/session-cookies";

const origin = "https://recovery-test.supabase.co";
const callback = "https://supply.example.com/auth/callback?next=%2Freset-password";
const user = { id: "10000000-0000-4000-8000-000000000001", email: "staff@example.com", email_confirmed_at: "2026-10-18T00:00:00Z", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-10-18T00:00:00Z" };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, aud: "authenticated" })}.c2lnbmF0dXJl`;
const session = { access_token: token, refresh_token: "recovery-refresh", token_type: "bearer", expires_in: 3600, user };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "x-supabase-api-version": "2024-01-01" } });

function browser() {
  const jar = new Map<string, string>();
  const cookies = {
    getAll: () => Array.from(jar, ([name, value]) => ({ name, value })),
    setAll: (values: Parameters<typeof prepareAuthCookies>[0]) => {
      for (const { name, value, options } of prepareAuthCookies(values, authStorageKey(origin), false)) {
        if (options.maxAge === 0) jar.delete(name);
        else jar.set(name, value);
      }
    },
  };
  const client = createBrowserClient(origin, "test-key", { isSingleton: false, auth: { detectSessionInUrl: false, autoRefreshToken: false }, cookies });
  return { client, jar, cookies };
}

test("reset emails do not require the requesting browser's verifier and report delivery failures", async t => {
  const client = verificationClient(origin, "test-key");
  let errorCode = "";
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/auth/v1/recover");
    assert.equal(url.searchParams.get("redirect_to"), callback);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.email, user.email);
    assert.ok(!body.code_challenge, "A new browser must not need a verifier cookie");
    return errorCode ? json({ code: errorCode, msg: "Provider details" }, 422) : json({});
  });
  const success = await sendPasswordRecovery(client, user.email, "https://supply.example.com/");
  assert.ok(success.success);
  errorCode = "user_not_found";
  assert.deepEqual(await sendPasswordRecovery(client, user.email, "https://supply.example.com"), success);
  errorCode = "over_email_send_rate_limit";
  assert.match((await sendPasswordRecovery(client, user.email, "https://supply.example.com")).error!, /could not be sent/);
  for (const value of [undefined, "not-a-url", "javascript:alert(1)", "https://user:secret@example.com"]) {
    assert.throws(() => passwordRecoveryRedirect(value));
  }
});

test("a recovery fragment opened in a fresh browser creates a server-readable session and permits password update", async t => {
  const { client, jar, cookies } = browser();
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(new URL(String(input)).pathname, "/auth/v1/user");
    if (init?.method === "PUT") assert.equal(JSON.parse(String(init.body)).password, "replacement-password-123");
    return json(user);
  });
  assert.equal(jar.size, 0);
  const url = new URL(`${callback}#${new URLSearchParams({ access_token: token, refresh_token: session.refresh_token, type: "recovery" })}`);
  assert.equal(await completeAuthCallback(url, client), "/reset-password");
  assert.ok(jar.has(authStorageKey(origin)));
  assert.equal(jar.get(`${authStorageKey(origin)}-remember`), "0");
  const server = createServerClient(origin, "test-key", { cookies });
  const verified = await server.auth.getUser();
  assert.equal(verified.error, null);
  assert.equal(verified.data.user?.id, user.id);
  assert.equal((await server.auth.updateUser({ password: "replacement-password-123" })).error, null);
});

test("recovery token hashes and legacy PKCE codes are verified with Auth and ignore external destinations", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    calls++;
    const url = new URL(String(input));
    const body = JSON.parse(String(init?.body));
    if (url.pathname.endsWith("/verify")) {
      assert.equal(body.token_hash, "recovery-hash");
      assert.equal(body.type, "recovery");
    }
    else {
      assert.equal(url.searchParams.get("grant_type"), "pkce");
      assert.equal(body.auth_code, "legacy-code");
      assert.equal(body.code_verifier, "saved-verifier");
    }
    return json(session);
  });
  const fresh = browser();
  assert.equal(await completeAuthCallback(new URL("https://supply.example.com/auth/callback?token_hash=recovery-hash&type=recovery&next=https://evil.example.com"), fresh.client), "/reset-password");
  const legacy = browser();
  legacy.jar.set(`${authStorageKey(origin)}-code-verifier`, JSON.stringify("saved-verifier/PASSWORD_RECOVERY"));
  assert.equal(await completeAuthCallback(new URL(`${callback}&code=legacy-code`), legacy.client), "/reset-password");
  const slotted = browser();
  slotted.jar.set(`${authStorageKey(origin)}-flow-recovery_flow-code-verifier`, JSON.stringify("saved-verifier/PASSWORD_RECOVERY"));
  slotted.jar.set(`${authStorageKey(origin)}-code-verifier`, JSON.stringify("different-verifier"));
  assert.equal(await completeAuthCallback(new URL(`${callback}&code=legacy-code&sb_flow_id=recovery_flow`), slotted.client), "/reset-password");
  assert.equal(calls, 3);
});

test("missing, malformed, expired and already used links cannot reach the password form", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return json({ code: "otp_expired", msg: "Expired" }, 403);
  });
  for (const suffix of ["", "&error=access_denied", "#error=access_denied", "#access_token=x&type=recovery", "#access_token=x&refresh_token=y&type=signup", "&token_hash=hash&type=invite"]) {
    const { client, jar } = browser();
    assert.equal(await completeAuthCallback(new URL(callback + suffix), client), recoveryErrorPath);
    assert.equal(jar.has(authStorageKey(origin)), false);
  }
  assert.equal(calls, 0, "Malformed links must not establish a session");
  for (const suffix of ["&token_hash=expired&type=recovery", `#access_token=${token}&refresh_token=rejected&type=recovery`, "&code=missing-verifier"]) {
    const { client, jar } = browser();
    assert.equal(await completeAuthCallback(new URL(callback + suffix), client), recoveryErrorPath);
    assert.equal(jar.has(authStorageKey(origin)), false);
  }
});
