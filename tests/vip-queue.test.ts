import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("VIP collections preserve partial balances, FIFO reservations, privacy, retries, and historical submissions", async () => {
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
    const migration = "202610150001_student_vip_queue.sql";
    for (const file of (await readdir(dir)).filter(file => file.endsWith(".sql") && file < migration).sort()) await db.exec(await readFile(new URL(file, dir), "utf8"));
    const staff = randomUUID(), admin = randomUUID(), inactive = randomUUID();
    for (const [id, role, active] of [[staff, "staff", true], [admin, "admin", true], [inactive, "staff", false]]) {
      await db.query("insert into auth.users(id,email) values ($1,'office@example.test')", [id]);
      await db.query("update public.profiles set role=$1,is_active=$2,full_name='Office Staff' where id=$3", [role, active, id]);
    }
    async function asRole(role: "authenticated" | "service_role" | "anon", actor: string | null, sql: string, args: unknown[] = []) {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor ?? ""]);
      await db.exec(`set role ${role}`);
      try { return (await db.query<Record<string, unknown>>(sql, args)).rows; }
      finally { await db.exec("reset role"); }
    }
    const item = randomUUID(), historical = randomUUID(), oldWaiting = randomUUID();
    await db.query("insert into public.items(id,sku,name,quantity) values ($1,'TYPE-B','Type B',4)", [item]);
    const oldSubmit = "select public.submit_student_stock_out($1,'Old Student','2026-10-15','OLD-RECEIPT',$2,$3,$4)";
    await asRole("service_role", null, oldSubmit, [historical, item, 1, "a".repeat(64)]);
    await asRole("authenticated", staff, "select public.process_student_stock_out($1,'issued','Receipt checked','TYPE-B')", [historical]);
    await asRole("service_role", null, oldSubmit, [oldWaiting, item, 10, "a".repeat(64)]);
    await db.exec(await readFile(new URL(migration, dir), "utf8"));
    await db.exec(await readFile(new URL("202610150004_vip_queue_positions.sql", dir), "utf8"));
    const log = async (id: string) => (await db.query<Record<string, unknown>>("select * from public.student_stock_out_logs where id=$1", [id])).rows[0];
    const stock = async () => (await db.query<{ quantity: number }>("select quantity from public.items where id=$1", [item])).rows[0].quantity;
    const queue = async () => {
      const rows = await asRole("authenticated", admin, "select * from public.student_vip_queue order by created_at,id");
      const balances = await asRole("authenticated", admin, `
        select id,item_id,quantity-fulfilled_quantity as remaining_quantity
        from public.student_stock_out_logs
        where status='pending' and vip_queued_at is not null order by created_at,id
      `);
      assert.deepEqual(balances, rows.map(({ id, item_id, remaining_quantity }) => ({ id, item_id, remaining_quantity })),
        "Inventory's direct balance query matches the ranked queue after every collection, rejection, and stock change");
      return rows;
    };
    assert.equal((await log(historical)).fulfilled_quantity, 1);
    assert.equal((await log(historical)).student_email, null);
    assert.equal((await queue())[0].id, oldWaiting, "Existing shortages enter VIP Queue");
    await asRole("authenticated", staff, "select public.process_student_stock_out($1,'issued','Receipt checked','TYPE-B')", [historical]);
    assert.equal(await stock(), 3, "Historical completed collections remain safe to retry");
    await asRole("authenticated", admin, "select public.process_student_stock_out($1,'rejected','Duplicate old request')", [oldWaiting]);

    const first = randomUUID(), second = randomUUID(), rateKey = "b".repeat(64);
    const submitSQL = "select public.submit_student_stock_out($1,$2,'2026-10-15',$3,$4,$5,$6,$7)";
    const submit = (id: string, quantity: number, email = "student@example.test") => asRole("service_role", null, submitSQL, [id, "Student Name", id, item, quantity, rateKey, email]);
    const collect = (id: string, quantity: number, key = randomUUID(), barcode = "TYPE-B", actor = staff) => asRole("authenticated", actor,
      "select public.process_student_stock_out($1,'issued','Receipt checked',$2,$3,$4) as id", [id, barcode, quantity, key]);
    const move = (quantity: number, kind = "stock_in", key = randomUUID()) => asRole("authenticated", admin,
      "select public.stock_movement($1,$2,$3,'Inventory movement','TEST',$4) as id", [item, kind, quantity, key]);
    const available = async (id: string | null) => (await asRole("authenticated", staff, "select * from public.student_stock_availability($1) where item_id=$2", [id, item]))[0].available_quantity;

    await assert.rejects(submit(randomUUID(), 10, "bad-email"), /email/i);
    await submit(first, 10, "  Student@Example.test  ");
    await submit(first, 10, "student@example.test");
    await assert.rejects(submit(first, 10, "different@example.test"), /different details/i);
    assert.equal((await log(first)).student_email, "student@example.test");
    assert.equal((await queue()).length, 1, "Repeated submission does not duplicate a VIP entry");
    assert.equal(await available(null), 0);
    assert.equal(await available(first), 3);
    assert.equal((await queue())[0].available_quantity, 3);
    await assert.rejects(collect(first, 3, randomUUID(), "WRONG"), /wrong barcode/i);
    await assert.rejects(collect(first, 3, randomUUID(), "TYPE-B", inactive), /permission/i);
    await assert.rejects(collect(first, 4), /insufficient stock/i);
    await assert.rejects(move(1, "stock_out"), /VIP/i);
    await assert.rejects(asRole("anon", null, "select * from public.student_vip_queue"), /permission/i);
    await assert.rejects(asRole("anon", null, "select item_id,quantity,fulfilled_quantity from public.student_stock_out_logs"), /permission/i);
    assert.equal((await asRole("authenticated", inactive, "select * from public.student_vip_queue")).length, 0);
    assert.equal((await asRole("authenticated", inactive, "select item_id,quantity,fulfilled_quantity from public.student_stock_out_logs")).length, 0);
    await assert.rejects(asRole("authenticated", staff, "update public.student_stock_out_logs set fulfilled_quantity=10 where id=$1", [first]), /permission/i);
    await assert.rejects(asRole("authenticated", staff, "select public.student_reserved_quantity($1)", [item]), /permission/i);

    const firstKey = randomUUID();
    const firstIssue = await collect(first, 3, firstKey);
    assert.equal(await stock(), 0);
    assert.equal((await log(first)).fulfilled_quantity, 3);
    assert.equal((await log(first)).status, "pending");
    assert.equal((await queue())[0].remaining_quantity, 7);
    const partialLog = await log(first);
    assert.deepEqual(await collect(first, 3, firstKey), firstIssue);
    assert.deepEqual(await log(first), partialLog, "Retry preserves collection attribution and progress");
    await assert.rejects(collect(first, 2, firstKey), /different details/i);
    await assert.rejects(collect(first, 1, randomUUID(), "TYPE-B", inactive), /permission/i);
    await submit(second, 2);
    await assert.rejects(collect(second, 2, firstKey), /different details/i);
    await move(5);
    assert.equal(await available(first), 5);
    assert.equal(await available(second), 0);
    await assert.rejects(collect(second, 1), /priority/i);
    await assert.rejects(move(1, "stock_out"), /VIP/i);
    const request = await asRole("authenticated", staff, "select public.create_requisition($1,1,'Office use','Teacher','2026-10-15') as id", [item]);
    await assert.rejects(asRole("authenticated", admin, "select public.review_requisition($1,'approved','Checked',1)", [request[0].id]), /VIP/i);

    await collect(first, 5);
    assert.equal((await log(first)).fulfilled_quantity, 8);
    assert.equal((await queue())[0].remaining_quantity, 2);
    await move(5);
    assert.equal(await available(first), 5);
    assert.equal(await available(second), 3);
    assert.equal(await available(null), 1, "Surplus beyond all VIP balances can be issued normally");
    assert.deepEqual((await queue()).map(row => row.available_quantity), [2, 2]);
    assert.deepEqual((await queue()).map(row => [row.queue_position, row.item_position, row.reminder_position]), [[1, 1, 1], [2, 2, 2]]);
    await move(1, "stock_out");
    const finalKey = randomUUID();
    await collect(first, 2, finalKey);
    assert.equal((await log(first)).status, "issued");
    assert.equal((await queue()).length, 1);
    assert.equal((await queue())[0].queue_position, 1, "Completing a collection advances the remaining queue");
    assert.equal((await queue())[0].reminder_position, 1);
    await collect(first, 2, finalKey);
    await collect(first, 3, firstKey); // A lost response can be retried even after later collections.
    await assert.rejects(collect(first, 1), /already/i);
    await collect(second, 2);
    assert.equal(await stock(), 0);
    assert.equal((await queue()).length, 0);
    const recorded = (await db.query<{ total: number; count: number }>("select sum(quantity)::int as total,count(*)::int as count from public.student_stock_out_issues where log_id=$1", [first])).rows[0];
    assert.deepEqual(recorded, { total: 10, count: 3 });

    // A later stock reduction queues previously satisfiable student requests.
    await move(10);
    const later = randomUUID();
    await submit(later, 6);
    assert.equal((await log(later)).vip_queued_at, null);
    await move(8, "stock_out");
    assert.ok((await log(later)).vip_queued_at);
    await collect(later, 2);
    const partialTransaction = (await log(later)).transaction_id;
    await asRole("authenticated", admin, "select public.process_student_stock_out($1,'rejected','Student cancelled balance')", [later]);
    assert.equal((await log(later)).fulfilled_quantity, 2);
    assert.equal((await log(later)).transaction_id, partialTransaction);
    assert.equal((await queue()).length, 0);
    await move(4);
    assert.equal(await available(null), 4, "Rejecting an unfilled balance releases reservations");
    await assert.rejects(collect(later, 1), /already/i);

    // Different items and tied timestamps must retain global ranks even when
    // the UI filters to one student or requests the second page.
    const emptyItem = randomUUID();
    await db.query("insert into public.items(id,sku,name,quantity) values ($1,'EMPTY','Empty item',0)", [emptyItem]);
    for (let index = 0; index < 28; index++) {
      const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      await db.query(`insert into public.student_stock_out_logs
        (id,student_name,receipt_date,receipt_number,item_id,item_name,item_code,unit,quantity,created_at,vip_queued_at)
        values ($1,$2,'2026-10-15',$2,$3,'Queue test','TEST','piece',1,'2026-10-15','2026-10-15')`,
      [id, `Position ${index + 1}`, [1, 3].includes(index) ? item : emptyItem]);
    }
    const ranked = await queue();
    assert.equal(ranked[0].queue_position, 1);
    assert.equal(ranked[0].reminder_position, null, "An older request without stock has no collection reminder rank");
    assert.deepEqual(ranked.filter(row => row.reminder_position !== null).map(row => [row.queue_position, row.reminder_position]), [[2, 1], [4, 2]]);
    const filtered = await asRole("authenticated", admin, "select * from public.student_vip_queue where student_name='Position 4'");
    assert.equal(filtered[0].queue_position, 4);
    assert.equal(filtered[0].reminder_position, 2, "Filtering must not renumber reminders");
    const nextPage = await asRole("authenticated", admin, "select * from public.student_vip_queue order by created_at,id limit 25 offset 25");
    assert.deepEqual(nextPage.map(row => row.queue_position), [26, 27, 28]);
    await db.query("update public.items set is_archived=true where id=$1", [item]);
    assert.ok((await queue()).every(row => row.reminder_position === null), "Archived items cannot be ready for collection reminders");
  } finally { await db.close(); }
});
