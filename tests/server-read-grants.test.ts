import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("fresh databases explicitly grant server reads without enabling public reads or direct stock writes", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb default '{}'::jsonb);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;$$;
      grant usage on schema auth,public to anon,authenticated,service_role;
      grant execute on function auth.uid() to anon,authenticated,service_role;
    `);
    const dir = new URL("../supabase/migrations/", import.meta.url);
    const repair = "202610190001_server_read_grants.sql";
    for (const file of (await readdir(dir)).filter(file => file.endsWith(".sql") && file < repair).sort()) {
      await db.exec(await readFile(new URL(file, dir), "utf8"));
    }
    await db.exec("set role service_role");
    for (const table of ["items", "transactions"]) {
      await assert.rejects(db.query(`select * from public.${table}`), /permission denied/);
    }
    await db.exec("reset role");
    const migration = await readFile(new URL(repair, dir), "utf8");
    await db.exec(migration);
    await db.exec(migration);
    await db.exec("insert into public.items(sku,name,quantity) values ('SUP-GRANTS','Grant test',12)");
    await db.exec("set role service_role");
    assert.equal((await db.query("select id,name,sku,unit from public.items where not is_archived")).rows.length, 1);
    await db.query("select t.id,t.item_id,t.kind,t.quantity_delta,t.created_at,i.name from public.transactions t join public.items i on i.id=t.item_id");
    await assert.rejects(db.query("update public.items set quantity=99"), /permission denied/);
    await assert.rejects(db.query("select * from public.student_form_rate_limits"), /permission denied/);
    await db.exec("reset role; set role anon");
    await assert.rejects(db.query("select * from public.items"), /permission denied/);
    await assert.rejects(db.query("select * from public.transactions"), /permission denied/);
    await db.query("select * from public.get_public_stock()");
    await db.exec("reset role; set role authenticated");
    assert.equal((await db.query("select * from public.items")).rows.length, 0, "RLS still requires an active verified account");
  } finally { await db.close(); }
});
