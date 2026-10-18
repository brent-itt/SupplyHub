import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET } from "../src/app/auth/confirm/route";
import { accountSchema, emailAddressSchema } from "../src/lib/validation";
import { createAccountWithVerification, hasVerifiedEmail, verificationClient, verificationRedirect } from "../src/lib/email-verification";

const account = accountSchema.parse({ email: "  Person+Office@Example.com ", full_name: "Test Person", password: "a-secure-test-password", role: "staff" });
const user = { id: "10000000-0000-4000-8000-000000000001", email: account.email, aud: "authenticated", created_at: "2026-10-18T00:00:00Z", app_metadata: {}, user_metadata: {} };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("account emails reject malformed addresses and preserve valid aliases", () => {
  assert.equal(account.email, "person+office@example.com");
  for (const email of ["", "person", "person@localhost", "@example.com", "a b@example.com", "a..b@example.com", "person@@example.com", "person@example..com", "a@-example.com", "a@example.com\r\nBcc: other@example.com", `${"a".repeat(250)}@example.com`]) {
    assert.equal(emailAddressSchema.safeParse(email).success, false, email);
    assert.equal(accountSchema.safeParse({ ...account, email }).success, false, email);
  }
  assert.equal(hasVerifiedEmail(user), false);
  assert.equal(hasVerifiedEmail({ ...user, email_confirmed_at: "2026-10-18T00:00:00Z" }), true);
  assert.equal(hasVerifiedEmail({ email_confirmed_at: "2026-10-18T00:00:00Z" }), false);
  assert.equal(verificationRedirect("https://supply.example.com/path"), "https://supply.example.com/verify-email?notice=check_sign_in");
  for (const site of [undefined, "not-a-url", "javascript:alert(1)", "https://user:secret@example.com"]) assert.throws(() => verificationRedirect(site));
});

test("account creation requires email verification and handles partial failures without duplicates", async t => {
  const client = verificationClient("https://verification-test.supabase.co", "test-key");
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  let failure: "create" | "access" | "mail" | undefined;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const body = JSON.parse(String(init?.body || "{}"));
    calls.push({ path, body });
    if (path.endsWith("/admin/users")) return failure === "create" ? json({ msg: "Email already exists" }, 422) : json(user);
    if (path.endsWith("/rpc/set_user_access")) return failure === "access" ? json({ message: "Access denied" }, 403) : json(null);
    if (path.endsWith("/resend")) return failure === "mail" ? json({ msg: "Mail unavailable" }, 422) : json({});
    throw new Error(`Unexpected request: ${path}`);
  });
  const run = () => createAccountWithVerification(account, client, client, email => client.auth.resend({ type: "signup", email }));
  assert.match(await run(), /must confirm their email/);
  assert.deepEqual(calls.map(call => call.path), ["/auth/v1/admin/users", "/rest/v1/rpc/set_user_access", "/auth/v1/resend"]);
  assert.equal(calls[0].body.email_confirm, false);
  assert.equal(calls[0].body.email, account.email);
  assert.equal(calls[1].body.p_is_active, false, "New accounts must remain inactive until verification and approval");
  assert.equal(calls[2].body.type, "signup");
  assert.equal(calls[2].body.code_challenge, null, "Confirmation must work on the recipient's browser");
  for (const [stage, message, count] of [["create", /already exists/, 1], ["access", /access could not be assigned/, 2], ["mail", /account was created.*could not be sent/, 3]] as const) {
    calls.length = 0;
    failure = stage;
    await assert.rejects(run(), message);
    assert.equal(calls.length, count);
  }
  failure = undefined;
  await assert.rejects(createAccountWithVerification(account, client, client, async () => { throw new Error("Network down"); }), /account was created.*could not be sent/);
});

test("confirmation accepts only valid email tokens, handles expiry, and never sets a login cookie", async t => {
  const oldUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const oldKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://verification-test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-key";
  t.after(() => {
    if (oldUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = oldKey;
  });
  let calls = 0;
  let expired = false;
  let verified = true;
  t.mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
    calls++;
    assert.equal(JSON.parse(String(init?.body)).token_hash, "valid-hash");
    return expired ? json({ code: "otp_expired", msg: "Token expired" }, 403) : json({
      access_token: "test-access", refresh_token: "test-refresh", token_type: "bearer", expires_in: 3600,
      user: { ...user, email_confirmed_at: verified ? "2026-10-18T00:00:00Z" : null },
    });
  });
  const request = (query: string) => GET(new NextRequest(`https://supply.example.com/auth/confirm?${query}`, { headers: { cookie: "admin-session=keep" } }));
  for (const query of ["", "type=email", "token_hash=valid-hash&type=recovery", "token_hash=valid-hash&type=invite", "token_hash=valid-hash&type=evil"]) {
    const response = await request(query);
    assert.match(response.headers.get("location")!, /verify-email\?notice=auth_error$/);
  }
  assert.equal(calls, 0);
  for (const type of ["email", "signup"]) {
    const response = await request(`token_hash=valid-hash&type=${type}&next=https://evil.example.com`);
    assert.equal(response.headers.get("location"), "https://supply.example.com/login?notice=email_verified");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  }
  expired = true;
  assert.match((await request("token_hash=valid-hash&type=email")).headers.get("location")!, /notice=auth_error$/);
  expired = false;
  verified = false;
  assert.match((await request("token_hash=valid-hash&type=email")).headers.get("location")!, /notice=auth_error$/);
});
