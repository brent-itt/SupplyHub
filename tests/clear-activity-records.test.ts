import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("activity reset clears linked records while preserving inventory, schema, and transaction protection", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'::jsonb);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; $$;
      grant usage on schema auth,public to anon,authenticated,service_role;
      grant execute on function auth.uid() to anon,authenticated,service_role;
    `);
    const dir = new URL("../supabase/migrations/", import.meta.url);
    for (const file of (await readdir(dir)).filter(file => file.endsWith(".sql")).sort()) {
      await db.exec(await readFile(new URL(file, dir), "utf8"));
    }
    await db.exec(`
      insert into auth.users(id,email) values ('00000000-0000-4000-8000-000000000001','admin@example.test');
      update public.profiles set role='staff',is_active=true;
      select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
      insert into public.items(id,sku,name,quantity) values ('00000000-0000-4000-8000-000000000002','TEST','Supply',10);
      select public.create_requisition('00000000-0000-4000-8000-000000000002',2,'Office supplies','Staff Member','2026-10-14');
      update public.profiles set role='admin';
      select public.review_requisition(id,'approved','Approved',version) from public.requisitions;
      select public.submit_student_stock_out('00000000-0000-4000-8000-000000000003','Student Name','2026-10-14','RECEIPT',
        '00000000-0000-4000-8000-000000000002',12,repeat('a',64),'student@example.test');
      select public.process_student_stock_out('00000000-0000-4000-8000-000000000003','issued','Checked','TEST',3,gen_random_uuid());
      insert into public.student_vip_reminders(id,log_id,actor_id,recipient,payload)
        values (gen_random_uuid(),'00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','student@example.test','{}');
    `);
    const inventoryBefore = (await db.query("select * from public.items order by id")).rows;
    const accountsBefore = (await db.query("select * from public.profiles order by id")).rows;
    const schemaSql = "select table_name,column_name,data_type from information_schema.columns where table_schema='public' order by table_name,ordinal_position";
    const schemaBefore = (await db.query(schemaSql)).rows;
    const clearedTables = ["requisitions", "requisition_logs", "transactions", "student_stock_out_logs", "student_stock_out_issues", "student_vip_reminders", "student_vip_queue"];
    for (const table of clearedTables) {
      assert.ok((await db.query<{ count: number }>(`select count(*)::int as count from public.${table}`)).rows[0].count > 0, `${table} has linked fixture records`);
    }
    await db.exec(await readFile(new URL("../supabase/maintenance/clear-activity-records.sql", import.meta.url), "utf8"));
    for (const table of clearedTables) {
      assert.equal((await db.query<{ count: number }>(`select count(*)::int as count from public.${table}`)).rows[0].count, 0, table);
    }
    assert.deepEqual((await db.query("select * from public.items order by id")).rows, inventoryBefore);
    assert.deepEqual((await db.query("select * from public.profiles order by id")).rows, accountsBefore);
    assert.deepEqual((await db.query(schemaSql)).rows, schemaBefore);
    await db.exec("select public.stock_movement('00000000-0000-4000-8000-000000000002','stock_in',1,'New stock','',gen_random_uuid())");
    await assert.rejects(db.exec("delete from public.transactions"), /immutable|cannot|append.only/i);
  } finally { await db.close(); }
});
