import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

for (const state of ["missing fields", "partial metadata", "fully migrated"]) {
  test(`requisition repair handles ${state} and can be rerun without changing requests`, async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        create role anon nologin; create role authenticated nologin;
        create schema auth;
        create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
        create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
        grant usage on schema auth, public to anon, authenticated;
        grant execute on function auth.uid() to anon, authenticated;
      `);
      const dir = new URL("../supabase/migrations/", import.meta.url);
      const repairFile = "202610040004_requisition_rpc_compat.sql";
      const fieldsFile = "202610040002_school_staff_requisitions.sql";
      for (const file of (await readdir(dir)).filter(file => file.endsWith(".sql") && file < repairFile).sort()) {
        if (state !== "fully migrated" && file === fieldsFile) continue;
        await db.exec(await readFile(new URL(file, dir), "utf8"));
      }
      const staff = randomUUID(), admin = randomUUID(), item = randomUUID();
      for (const [id, role] of [[staff, "staff"], [admin, "admin"]]) {
        await db.query("insert into auth.users(id,email) values ($1,'recorder@example.test')", [id]);
        await db.query("update public.profiles set role=$1,is_active=true,full_name='Staff Recorder' where id=$2", [role, id]);
      }
      await db.query("insert into public.items(id,sku,name,quantity) values ($1,'PAPER','Bond paper',10)", [item]);
      async function asUser(actor: string, sql: string, args: unknown[] = []) {
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
        await db.exec("set role authenticated");
        try { return (await db.query<Record<string, unknown>>(sql, args)).rows; }
        finally { await db.exec("reset role"); }
      }
      const createSql = "select public.create_requisition($1,2,'School supplies','Maria Santos','2026-10-04') as id";
      const historical = (await asUser(staff, state === "fully migrated" ? createSql : "select public.create_requisition($1,2,'School supplies') as id", [item]))[0].id;
      await db.query("update public.requisitions set created_at='2026-10-03T17:00:00Z' where id=$1", [historical]);
      if (state === "missing fields") {
        // Reproduce the live state: the new RPC exists, but its columns do not.
        const fieldsSql = await readFile(new URL(fieldsFile, dir), "utf8");
        const rpc = fieldsSql.slice(fieldsSql.indexOf("create function public.create_requisition("), fieldsSql.lastIndexOf("commit;"));
        await db.exec(rpc);
        await assert.rejects(asUser(staff, createSql, [item]), /column "requester_name".*does not exist/i);
      }
      if (state === "partial metadata") {
        await db.exec("alter table public.requisitions add column requester_name text, add column request_date date, add column item_name text, add column item_code text");
        await db.query("update public.requisitions set requester_name='Original Requestor',item_name='Original supply' where id=$1", [historical]);
      }
      const repair = await readFile(new URL(repairFile, dir), "utf8");
      await db.exec(repair);
      const saved = (await db.query("select requester_name,request_date::text,item_name,item_code from public.requisitions where id=$1", [historical])).rows[0];
      assert.deepEqual(saved, {
        requester_name: state === "fully migrated" ? "Maria Santos" : state === "partial metadata" ? "Original Requestor" : "Staff Recorder",
        request_date: "2026-10-04",
        item_name: state === "partial metadata" ? "Original supply" : "Bond paper",
        item_code: "PAPER",
      });
      const beforeRerun = await db.query("select * from public.requisitions order by id");
      const logsBeforeRerun = await db.query("select * from public.requisition_logs order by id");
      await db.exec(repair);
      assert.deepEqual((await db.query("select * from public.requisitions order by id")).rows, beforeRerun.rows);
      assert.deepEqual((await db.query("select * from public.requisition_logs order by id")).rows, logsBeforeRerun.rows);
      const id = (await asUser(staff, createSql, [item]))[0].id;
      await assert.rejects(asUser(staff, "select public.create_requisition($1,1,'Legacy request')", [item]), /does not exist/i);
      await assert.rejects(asUser(admin, createSql, [item]), /permission/i);
      await assert.rejects(db.query("update public.requisitions set requester_name=null where id=$1", [id]), /not-null/i);
      await assert.rejects(db.query("update public.requisitions set requester_name=' ' where id=$1", [id]), /check constraint/i);
      await asUser(staff, "select public.update_requisition($1,$2,3,'Updated purpose','Jose Reyes','2026-10-05',1)", [id, item]);
      assert.equal((await db.query<{ quantity: number }>("select quantity from public.items where id=$1", [item])).rows[0].quantity, 10);
      await asUser(admin, "select public.review_requisition($1,'approved','Issued',2)", [id]);
      assert.equal((await db.query<{ quantity: number }>("select quantity from public.items where id=$1", [item])).rows[0].quantity, 7);
      const logs = await asUser(admin, "select event from public.requisition_logs where request_id=$1 order by created_at,id", [id]);
      assert.deepEqual(logs.map(row => row.event), ["submitted", "edited", "approved"]);
    } finally { await db.close(); }
  });
}
