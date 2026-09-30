import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("stock edit migration rejects Staff writes and permits Admin and Super Admin", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;
      grant usage on schema auth, public to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
    `);
    for (const file of ["202609250001_supplies_system.sql", "202609270001_public_stock_no_students.sql", "202609270002_admin_only_stock_edits.sql"]) {
      await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
    }
    const users = {};
    for (const role of ["staff", "admin", "super_admin"]) {
      users[role] = randomUUID();
      await db.query("insert into auth.users(id, email) values ($1, $2)", [users[role], `${role}@example.test`]);
      await db.query("update public.profiles set role = $1, is_active = true where id = $2", [role, users[role]]);
    }
    const item = randomUUID();
    await db.query("insert into public.items(id, sku, name, quantity) values ($1, 'ACCESS', 'Access test supply', 10)", [item]);
    async function asUser(role, sql, params) {
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [users[role]]);
      await db.exec("set role authenticated");
      try { return await db.query(sql, params); }
      finally { await db.exec("reset role"); }
    }
    const movement = "select public.stock_movement($1, $2, $3, $4, '', $5)";
    for (const kind of ["stock_in", "stock_out", "adjustment"]) {
      await assert.rejects(asUser("staff", movement, [item, kind, 3, "Count correction", randomUUID()]), /permission/i);
    }
    assert.equal((await db.query("select quantity from public.items where id = $1", [item])).rows[0].quantity, 10);
    assert.equal((await db.query("select count(*)::int as count from public.transactions")).rows[0].count, 0);
    await assert.rejects(asUser("staff", "update public.items set quantity = 99 where id = $1", [item]), /permission/i);
    assert.equal((await asUser("staff", "select quantity from public.items where id = $1", [item])).rows[0].quantity, 10);
    for (const role of ["admin", "super_admin"]) {
      await asUser(role, movement, [item, "stock_in", 2, "Delivery", randomUUID()]);
      await asUser(role, movement, [item, "stock_out", 1, "Issue", randomUUID()]);
      await asUser(role, movement, [item, "adjustment", 10, "Count correction", randomUUID()]);
    }
    assert.equal((await db.query("select count(*)::int as count from public.transactions")).rows[0].count, 6);
  } finally {
    await db.close();
  }
});
