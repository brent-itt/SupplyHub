import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("pending accounts cannot be activated until verified and confirmation status is restricted to super admins", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon nologin; create role authenticated nologin;
      create schema auth;
      create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb default '{}'::jsonb);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
      grant usage on schema auth, public to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
    `);
    for (const file of ["202609250001_supplies_system.sql", "202609270001_public_stock_no_students.sql", "202610180001_require_verified_email.sql"]) {
      await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
    }
    const superAdmin = "10000000-0000-4000-8000-000000000001";
    const pending = "10000000-0000-4000-8000-000000000002";
    const admin = "10000000-0000-4000-8000-000000000003";
    for (const [id, role, verified] of [[superAdmin, "super_admin", true], [pending, "staff", false], [admin, "admin", true]] as const) {
      await db.query("insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, $3, '{\"email_verified\":true}')", [id, `${role}@example.com`, verified ? "2026-10-18T00:00:00Z" : null]);
      await db.query("update public.profiles set role = $2, is_active = true where id = $1", [id, role]);
    }
    const migration = await readFile(new URL("../supabase/migrations/202610180002_pending_account_verification.sql", import.meta.url), "utf8");
    await db.exec(migration);
    await db.exec(migration);
    const asUser = async (id: string, role = "authenticated") => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
      await db.exec(role === "anon" ? "set role anon" : "set role authenticated");
    };
    const activate = () => db.query("select public.set_user_access($1, 'staff', true)", [pending]);
    const accounts = () => db.query<{ id: string; email_verified: boolean; is_active: boolean; role: string }>("select * from public.get_account_profiles()");
    await asUser(superAdmin);
    let rows = (await accounts()).rows;
    assert.equal(rows.find(row => row.id === superAdmin)?.is_active, true, "Existing verified access stays active");
    assert.equal(rows.find(row => row.id === pending)?.email_verified, false, "Editable metadata must not prove verification");
    assert.equal(rows.find(row => row.id === pending)?.is_active, false, "Migration repairs previously active unconfirmed accounts");
    await assert.rejects(activate(), /verify their email before activation/);
    await db.query("select public.set_user_access($1, 'admin', false)", [pending]);
    assert.equal((await accounts()).rows.find(row => row.id === pending)?.role, "admin", "Role can be assigned while pending");
    for (const id of [admin, pending]) {
      await asUser(id);
      await assert.rejects(accounts(), /does not have permission/);
      await assert.rejects(activate(), /does not have permission/);
    }
    await asUser("", "anon");
    await assert.rejects(accounts(), /permission denied/);
    await db.exec("reset role");
    await db.query("update auth.users set email_confirmed_at = now() where id = $1", [pending]);
    await asUser(superAdmin);
    rows = (await accounts()).rows;
    assert.equal(rows.find(row => row.id === pending)?.email_verified, true);
    assert.equal(rows.find(row => row.id === pending)?.is_active, false, "Email confirmation alone does not override administrator approval");
    await activate();
    assert.equal((await accounts()).rows.find(row => row.id === pending)?.is_active, true);
    await db.query("select public.set_user_access($1, 'staff', false)", [pending]);
    await db.exec("reset role");
    await db.exec(migration);
    await asUser(superAdmin);
    assert.equal((await accounts()).rows.find(row => row.id === pending)?.is_active, false, "Rerunning the migration preserves deactivation");
    await assert.rejects(db.query("select public.set_user_access($1, 'staff', false)", [superAdmin]), /cannot disable or demote/);
  } finally {
    await db.close();
  }
});

test("unverified accounts cannot read protected inventory or mutate data through the API", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon nologin; create role authenticated nologin;
      create schema auth;
      create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb default '{}'::jsonb);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
      grant usage on schema auth, public to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
    `);
    for (const file of ["202609250001_supplies_system.sql", "202609270001_public_stock_no_students.sql", "202610180001_require_verified_email.sql", "202610180001_require_verified_email.sql"]) {
      await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
    }
    const id = "10000000-0000-4000-8000-000000000001";
    await db.query("insert into auth.users(id, email, raw_user_meta_data) values ($1, 'person@example.com', '{\"email_verified\":true}')", [id]);
    await db.query("update public.profiles set role = 'super_admin', is_active = true where id = $1", [id]);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    await db.exec("insert into public.items(sku, name, category, unit) values ('PAPER', 'Paper', 'Supplies', 'box')");
    const mutate = () => db.query("select public.upsert_item(null, 'NEW', 'New item', '', 'Supplies', 'box', '', 0)");
    await db.exec("set role authenticated");
    assert.equal((await db.query<{ role: string | null }>("select public.active_role() as role")).rows[0].role, null);
    assert.equal((await db.query("select * from public.items")).rows.length, 0);
    await assert.rejects(mutate(), /Verify your email/);
    await db.exec("reset role");
    await db.query("update auth.users set email_confirmed_at = now() where id = $1", [id]);
    await db.exec("set role authenticated");
    assert.equal((await db.query<{ role: string }>("select public.active_role() as role")).rows[0].role, "super_admin");
    assert.equal((await db.query("select * from public.items")).rows.length, 1);
    await mutate();
    await db.exec("reset role");
    await db.query("update public.profiles set is_active = false where id = $1", [id]);
    await db.exec("set role authenticated");
    assert.equal((await db.query("select * from public.items")).rows.length, 0);
    await assert.rejects(mutate(), /does not have permission/);
  } finally {
    await db.close();
  }
});
