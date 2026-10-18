import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

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
