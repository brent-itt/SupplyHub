import assert from "node:assert/strict";
import test from "node:test";
import { verificationClient } from "../src/lib/email-verification";
import { changeAccountPassword, hasRecentEmailProof, PASSWORD_CODE_LIFETIME_MS, sendAccountPasswordCode } from "../src/lib/account-password";

const now = Date.now();
const user = { id: "10000000-0000-4000-8000-000000000001", email: "owner@example.com", email_confirmed_at: new Date(now - 86400000).toISOString(), recovery_sent_at: new Date(now - 2000).toISOString(), aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-10-18T00:00:00Z" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "x-supabase-api-version": "2024-01-01" } });
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const accessToken = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, exp: Math.floor(now / 1000) + 3600, aud: "authenticated", amr: [{ method: "otp", timestamp: Math.floor(now / 1000) }] })}.c2lnbmF0dXJl`;
const session = { access_token: accessToken, refresh_token: "fresh-recovery-refresh", token_type: "bearer", expires_in: 3600, user };
const client = () => verificationClient("https://account-password-test.supabase.co", "test-key");
function form(code = "123456", password = "replacement-password-123", confirmation = password) {
  const data = new FormData();
  data.set("code", code); data.set("password", password); data.set("confirm_password", confirmation);
  data.set("email", "attacker@example.com"); data.set("user_id", "attacker");
  return data;
}

test("code generation uses the signed-in email, never exposes credentials, and throttles resends", async t => {
  let generated = 0;
  const deliveries: { email: string; code: string }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    generated++;
    assert.equal(new URL(String(input)).pathname, "/auth/v1/admin/generate_link");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.email, user.email); assert.equal(body.type, "recovery");
    return json({ ...user, email_otp: "123456", hashed_token: "secret-hash", action_link: "https://secret-link", verification_type: "recovery", redirect_to: "https://supply.example.com" });
  });
  const send = async (email: string, code: string) => { deliveries.push({ email, code }); };
  assert.match((await sendAccountPasswordCode(user, client(), send, now)).error!, /Wait one minute/);
  assert.equal(generated, 0);
  const older = { ...user, recovery_sent_at: new Date(now - 61000).toISOString() };
  const result = await sendAccountPasswordCode(older, client(), send, now);
  assert.match(result.success!, /10 minutes/);
  assert.deepEqual(deliveries, [{ email: user.email, code: "123456" }]);
  assert.doesNotMatch(JSON.stringify(result), /123456|secret-hash|secret-link/);
  const failed = await sendAccountPasswordCode(older, client(), async () => { throw new Error("SMTP details"); }, now);
  assert.match(failed.error!, /could not be sent/);
  assert.doesNotMatch(failed.error!, /SMTP details/);
  assert.ok((await sendAccountPasswordCode({ ...older, email_confirmed_at: undefined }, client(), send, now)).error);
  assert.equal(generated, 2);
});

test("password changes verify a one-time code first and transfer only the verified account session", async t => {
  const calls: string[] = [];
  let consumed = false;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const body = JSON.parse(String(init?.body || "{}"));
    calls.push(`${init?.method || "GET"} ${path}`);
    if (path.endsWith("/verify")) {
      assert.equal(body.email, user.email, "Form-supplied email must be ignored");
      assert.equal(body.token, "123456"); assert.equal(body.type, "recovery");
      if (consumed) return json({ code: "otp_expired", msg: "Already used" }, 403);
      consumed = true;
      return json(session);
    }
    assert.equal(path, "/auth/v1/user");
    if (init?.method === "PUT") assert.equal(body.password, "replacement-password-123");
    return json(user);
  });
  const browser = client();
  assert.ok((await changeAccountPassword(user, form(), client(), browser, now)).success);
  assert.deepEqual(calls.slice(0, 2), ["POST /auth/v1/verify", "PUT /auth/v1/user"]);
  assert.equal((await browser.auth.getSession()).data.session?.user.id, user.id);
  assert.ok((await changeAccountPassword(user, form(), client(), browser, now)).error);
  assert.equal(calls.filter(call => call.startsWith("PUT")).length, 1, "Reused codes must not update the password");
});

test("invalid input and expired or absent challenges fail before contacting Auth", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("Should not call Auth"); });
  for (const data of [form(""), form("invalid"), form("12345"), form("123456", "short"), form("123456", "a-valid-new-password", "different-password")]) {
    assert.ok((await changeAccountPassword(user, data, client(), client(), now)).error);
  }
  for (const recovery_sent_at of [undefined, "invalid", new Date(now - PASSWORD_CODE_LIFETIME_MS - 1).toISOString(), new Date(now + 10000).toISOString()]) {
    assert.ok((await changeAccountPassword({ ...user, recovery_sent_at }, form(), client(), client(), now)).error);
  }
  assert.equal(calls, 0);
});

test("incorrect codes and another account's verification result never update passwords or browser sessions", async t => {
  let mode = "incorrect";
  let updates = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/verify")) return mode === "incorrect" ? json({ code: "otp_expired", msg: "Invalid" }, 403) : json({ ...session, user: { ...user, id: "different-user" } });
    if (init?.method === "PUT") updates++;
    throw new Error("Unexpected request");
  });
  for (mode of ["incorrect", "other-account"]) {
    const browser = client();
    assert.ok((await changeAccountPassword(user, form(), client(), browser, now)).error);
    assert.equal((await browser.auth.getSession()).data.session, null);
  }
  assert.equal(updates, 0);
});

test("password-save failure cannot be reported as success or transfer a session", async t => {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    return new URL(String(input)).pathname.endsWith("/verify") ? json(session) : json({ code: "same_password", msg: "Same password" }, 422);
  });
  const browser = client();
  assert.match((await changeAccountPassword(user, form(), client(), browser, now)).error!, /different from your current password/);
  assert.equal((await browser.auth.getSession()).data.session, null);
});

test("the reset-link path rejects normal login sessions and stale or mismatched email proof", () => {
  const proof = { sub: user.id, amr: [{ method: "otp", timestamp: Math.floor(now / 1000) }] };
  assert.equal(hasRecentEmailProof(proof, user.id, now), true);
  for (const claims of [undefined, { sub: user.id }, { ...proof, sub: "different-user" }, { ...proof, amr: ["otp"] }, { ...proof, amr: [{ method: "password", timestamp: Math.floor(now / 1000) }] }, { ...proof, amr: [{ method: "otp", timestamp: Math.floor((now - PASSWORD_CODE_LIFETIME_MS - 1000) / 1000) }] }, { ...proof, amr: [{ method: "otp", timestamp: Math.floor(now / 1000) + 60 }] }]) {
    assert.equal(Boolean(hasRecentEmailProof(claims, user.id, now)), false);
  }
});
