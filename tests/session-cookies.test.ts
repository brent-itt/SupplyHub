import assert from "node:assert/strict";
import test from "node:test";
import { createServerClient } from "@supabase/ssr";
import { authStorageKey, isSessionCookie, prepareAuthCookies, REMEMBER_MAX_AGE, rememberCookieName, type AuthCookie } from "../src/lib/supabase/session-cookies";

const storageKey = authStorageKey("https://session-test.supabase.co");

test("remember choice applies to every session chunk without changing deletions, PKCE, or other projects", () => {
  const original: AuthCookie[] = [
    ...[storageKey, `${storageKey}.0`, `${storageKey}-user.1`].map(name => ({ name, value: "token", options: { path: "/", sameSite: "lax" as const, maxAge: 34560000, expires: new Date("2030-01-01") } })),
    { name: `${storageKey}.2`, value: "", options: { path: "/", maxAge: 0 } },
    { name: `${storageKey}-code-verifier`, value: "verifier", options: { maxAge: 34560000 } },
    { name: "sb-other-auth-token", value: "other", options: { maxAge: 34560000 } },
  ];
  for (const remember of [false, true]) {
    const output = prepareAuthCookies(original, storageKey, remember);
    for (const cookie of output.slice(0, 3)) {
      assert.equal(cookie.options.maxAge, remember ? REMEMBER_MAX_AGE : undefined);
      assert.equal(cookie.options.expires, undefined);
      assert.equal(cookie.options.sameSite, "lax");
    }
    assert.deepEqual(output.slice(3, 6), original.slice(3));
    assert.equal(output[6].name, rememberCookieName(storageKey));
    assert.equal(output[6].value, remember ? "1" : "0");
    assert.equal(output[6].options.maxAge, remember ? REMEMBER_MAX_AGE : undefined);
  }
  assert.equal(original[0].options.maxAge, 34560000, "SDK options must not be mutated");
  for (const name of [`${storageKey}-code-verifier`, `${storageKey}.not-a-chunk`, "sb-other-auth-token"]) assert.equal(isSessionCookie(name, storageKey), false);
});

test("real Supabase login writes the chosen lifetime; sign-out deletes the session in both modes", async () => {
  for (const remember of [false, true]) {
    const jar = new Map<string, AuthCookie>();
    const client = createServerClient("https://session-test.supabase.co", "test-key", {
      global: { fetch: async input => {
        if (String(input).includes("/logout")) return new Response(null, { status: 204 });
        return new Response(JSON.stringify({ access_token: "test-token", refresh_token: "test-refresh", token_type: "bearer", expires_in: 3600, user: { id: "10000000-0000-4000-8000-000000000001", aud: "authenticated", email: "staff@example.test" } }), { status: 200, headers: { "Content-Type": "application/json" } });
      } },
      cookies: {
        getAll: () => [...jar.values()].filter(cookie => cookie.options.maxAge !== 0).map(({ name, value }) => ({ name, value })),
        setAll: cookies => { prepareAuthCookies(cookies, storageKey, remember).forEach(cookie => jar.set(cookie.name, cookie)); },
      },
    });
    const { error } = await client.auth.signInWithPassword({ email: "staff@example.test", password: "not-a-real-password" });
    assert.equal(error, null);
    assert.equal(jar.get(storageKey)?.options.maxAge, remember ? REMEMBER_MAX_AGE : undefined);
    assert.equal(jar.get(rememberCookieName(storageKey))?.value, remember ? "1" : "0");
    await client.auth.signOut({ scope: "local" });
    assert.equal(jar.get(storageKey)?.options.maxAge, 0);
    assert.equal(jar.get(storageKey)?.value, "");
  }
});
