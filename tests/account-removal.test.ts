import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { loadAccountProfiles, removeAccount } from "../src/lib/account-removal";
import { hasVerifiedEmail } from "../src/lib/email-verification";
import type { Profile } from "../src/lib/types";

const actor: Profile = { id: "10000000-0000-4000-8000-000000000001", email: "owner@example.test", full_name: "Owner", role: "super_admin", is_active: true, created_at: "2026-10-23T00:00:00Z" };
const targetId = "10000000-0000-4000-8000-000000000002";
const authUser = { id: targetId, email: "staff@example.test", email_confirmed_at: "2026-10-23T00:00:00Z", aud: "authenticated", role: "authenticated", created_at: actor.created_at, app_metadata: {}, user_metadata: {} };

function client(fetch: typeof globalThis.fetch) {
  return createClient("https://accounts.example.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch },
  });
}

test("removal blocks self-removal, staff, admins, and inactive super admins before any request", async () => {
  const unexpected = client(async () => { throw new Error("Unexpected request"); });
  await assert.rejects(removeAccount(actor, actor.id, unexpected, unexpected), /own super admin/);
  for (const profile of [{ ...actor, role: "staff" as const }, { ...actor, role: "admin" as const }, { ...actor, is_active: false }]) {
    await assert.rejects(removeAccount(profile, targetId, unexpected, unexpected), /Only an active super admin/);
  }
});

test("removal revokes profile access before deleting sign-in and never deletes history or profiles", async () => {
  const calls: string[] = [];
  const supabase = client(async (input, init) => {
    const url = new URL(String(input));
    calls.push(`${init?.method} ${url.pathname}`);
    if (url.pathname === "/rest/v1/profiles") {
      assert.equal(url.searchParams.get("id"), `eq.${targetId}`);
      return Response.json({ id: targetId, role: "admin" });
    }
    if (url.pathname === "/rest/v1/rpc/set_user_access") {
      assert.deepEqual(JSON.parse(String(init?.body)), { p_user_id: targetId, p_role: "admin", p_is_active: false });
      return Response.json(null);
    }
    assert.equal(url.pathname, `/auth/v1/admin/users/${targetId}`);
    if (init?.method === "DELETE") {
      assert.deepEqual(JSON.parse(String(init.body)), { should_soft_delete: true });
      return Response.json({ ...authUser, deleted_at: actor.created_at });
    }
    return Response.json(authUser);
  });
  assert.match(await removeAccount(actor, targetId, supabase, supabase), /Account removed/);
  assert.deepEqual(calls, ["GET /rest/v1/profiles", "POST /rest/v1/rpc/set_user_access", `GET /auth/v1/admin/users/${targetId}`, `DELETE /auth/v1/admin/users/${targetId}`]);
});

test("a current database authorization failure prevents privileged Auth deletion", async () => {
  const supabase = client(async (input) => {
    const path = new URL(String(input)).pathname;
    if (path === "/rest/v1/profiles") return Response.json({ id: targetId, role: "staff" });
    assert.equal(path, "/rest/v1/rpc/set_user_access");
    return Response.json({ code: "42501", message: "Your account does not have permission for this action." }, { status: 403 });
  });
  await assert.rejects(removeAccount(actor, targetId, supabase, supabase), /permission/);
});

test("failed Auth removal leaves access disabled and a retry safely finishes removal", async () => {
  let active = true;
  let attempts = 0;
  let deleted = false;
  const supabase = client(async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === "/rest/v1/profiles") return Response.json({ id: targetId, role: "staff" });
    if (path === "/rest/v1/rpc/set_user_access") { active = false; return Response.json(null); }
    assert.equal(path, `/auth/v1/admin/users/${targetId}`);
    if (init?.method === "DELETE") {
      assert.equal(active, false);
      attempts++;
      if (attempts === 1) return Response.json({ msg: "Auth temporarily unavailable" }, { status: 500 });
      deleted = true;
    }
    return Response.json({ ...authUser, deleted_at: deleted ? actor.created_at : undefined });
  });
  await assert.rejects(removeAccount(actor, targetId, supabase, supabase), /access was disabled.*Try Remove account again/);
  assert.equal(active, false);
  assert.match(await removeAccount(actor, targetId, supabase, supabase), /Account removed/);
  assert.match(await removeAccount(actor, targetId, supabase, supabase), /Account removed/);
  assert.equal(attempts, 2, "A repeated successful request must not delete again");
});

test("missing profiles fail without changing access or Auth", async () => {
  const supabase = client(async (input) => {
    assert.equal(new URL(String(input)).pathname, "/rest/v1/profiles");
    return Response.json(null);
  });
  await assert.rejects(removeAccount(actor, targetId, supabase, supabase), /Account not found/);
});

test("user access excludes removed accounts, retains pending accounts, and derives verification from Auth", async () => {
  const pendingId = "10000000-0000-4000-8000-000000000003";
  const removedId = "10000000-0000-4000-8000-000000000004";
  const supabase = client(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/admin/users") return Response.json({ users: [authUser,
      { ...authUser, id: pendingId, email_confirmed_at: undefined, user_metadata: { email_verified: true } },
      { ...authUser, id: removedId, deleted_at: actor.created_at }], aud: "authenticated" });
    assert.equal(url.pathname, "/rest/v1/profiles");
    assert.equal(url.searchParams.get("id"), `in.(${targetId},${pendingId})`);
    return Response.json([targetId, pendingId].map(id => ({ ...actor, id, role: "staff" })));
  });
  const profiles = await loadAccountProfiles(supabase, supabase);
  assert.deepEqual(profiles.map(p => [p.id, p.email_verified]), [[targetId, true], [pendingId, false]]);
  assert.equal(hasVerifiedEmail({ ...authUser, deleted_at: actor.created_at }), false);
  assert.equal(profiles.some(p => "user_metadata" in p || "app_metadata" in p), false);
});

test("account listing reads later Auth pages and batches profile lookups", async () => {
  const authPages: number[] = [];
  let profileCalls = 0;
  const supabase = client(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/admin/users") {
      const page = Number(url.searchParams.get("page"));
      authPages.push(page);
      return Response.json({ users: page === 1 ? Array.from({ length: 1000 }, (_, i) => ({ ...authUser, id: `id-${i}` })) : [authUser], aud: "authenticated" });
    }
    profileCalls++;
    const ids = url.searchParams.get("id")!.slice(4, -1).split(",");
    assert.ok(ids.length <= 200);
    return Response.json(ids.map(id => ({ ...actor, id })));
  });
  assert.equal((await loadAccountProfiles(supabase, supabase)).length, 1001);
  assert.deepEqual(authPages, [1, 2]);
  assert.equal(profileCalls, 6);
});

test("account listing errors are reported rather than displaying a partial list", async () => {
  const supabase = client(async () => Response.json({ msg: "Unavailable" }, { status: 500 }));
  await assert.rejects(loadAccountProfiles(supabase, supabase), /Unable to load accounts/);
});
