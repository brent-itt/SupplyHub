import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { requisitionChanges } from "../src/lib/requisition-logs";
import { editRequestSchema, reviewSchema } from "../src/lib/validation";
import type { RequisitionLog } from "../src/lib/types";

test("edits and reviews require a valid version and audit details describe changed fields only", () => {
  const request = { request_id: randomUUID(), item_id: randomUUID(), quantity: 3, purpose: "School supplies", requester_name: "Maria Santos", request_date: "2026-10-04", expected_version: "2" };
  assert.equal(editRequestSchema.parse(request).expected_version, 2);
  for (const expected_version of [undefined, 0, -1, "bad"]) {
    assert.equal(editRequestSchema.safeParse({ ...request, expected_version }).success, false);
    assert.equal(reviewSchema.safeParse({ request_id: request.request_id, decision: "approved", review_note: "", expected_version }).success, false);
  }
  assert.deepEqual(requisitionChanges({ before_data: { quantity: 2, purpose: "Office", version: 1 }, after_data: { quantity: 3, purpose: "Office", version: 2 } } as RequisitionLog), [{ label: "Quantity", before: "2", after: "3" }]);
});

test("pending edits, version conflicts, and immutable admin logs are enforced in PostgreSQL", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon nologin; create role authenticated nologin;
      create schema auth;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'::jsonb);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; $$;
      grant usage on schema auth,public to anon,authenticated;
      grant execute on function auth.uid() to anon,authenticated;
    `);
    const dir = new URL("../supabase/migrations/", import.meta.url);
    const migration = "202610040003_requisition_edits_and_logs.sql";
    for (const file of (await readdir(dir)).filter(file => file.endsWith(".sql") && file < migration).sort()) await db.exec(await readFile(new URL(file, dir), "utf8"));
    const staff = randomUUID(), other = randomUUID(), admin = randomUUID(), superAdmin = randomUUID(), inactive = randomUUID(), item = randomUUID(), second = randomUUID();
    for (const [id, role, name, active] of [[staff, "staff", "School Staff", true], [other, "staff", "Other Staff", true], [admin, "admin", "Office Admin", true], [superAdmin, "super_admin", "Super Admin", true], [inactive, "staff", "Inactive Staff", false]]) {
      await db.query("insert into auth.users(id) values ($1)", [id]);
      await db.query("update public.profiles set role=$1,full_name=$2,is_active=$3 where id=$4", [role, name, active, id]);
    }
    await db.query("insert into public.items(id,sku,name,quantity) values ($1,'PAPER','Paper',20),($2,'PEN','Pen',20)", [item, second]);
    async function asUser(actor: string | null, sql: string, values: unknown[] = [], role = "authenticated") {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor ?? ""]);
      await db.exec(role === "anon" ? "set role anon" : "set role authenticated");
      try { return (await db.query(sql, values)).rows as Record<string, unknown>[]; }
      finally { await db.exec("reset role"); }
    }
    const create = async () => (await asUser(staff, "select public.create_requisition($1,2,'Office supplies','Maria Santos','2026-10-04') as id", [item]))[0].id as string;
    const historical = await create();
    await db.exec(await readFile(new URL(migration, dir), "utf8"));
    assert.equal((await asUser(admin, "select * from public.requisition_logs")).length, 0, "Do not invent historical logs");
    const id = await create();
    const logs = async (requestId = id) => await asUser(admin, "select * from public.requisition_logs where request_id=$1 order by created_at,id", [requestId]);
    const snapshot = async () => (await asUser(admin, "select * from public.requisitions where id=$1", [id]))[0];
    const editSql = "select public.update_requisition($1,$2,$3,$4,$5,$6::date,$7)";
    const edit = (actor: string | null, version: number, quantity = 4) => asUser(actor, editSql, [id, second, quantity, "New purpose", "Jose Reyes", "2026-10-05", version]);
    const review = (actor: string, version: number, decision = "approved", requestId = id) => asUser(actor, "select public.review_requisition($1,$2,'Reviewed',$3)", [requestId, decision, version]);
    assert.equal((await logs())[0].event, "submitted");
    assert.equal((await logs())[0].actor_id, staff);
    assert.equal((await logs())[0].before_data, null);
    for (const actor of [other, inactive, null]) await assert.rejects(edit(actor, 1), /permission|cannot|sign in/i);
    await assert.rejects(asUser(null, editSql, [id, item, 1, "Test", "Name", "2026-10-04", 1], "anon"), /permission/i);
    await assert.rejects(edit(staff, 1, 0), /positive/i);
    assert.equal((await logs()).length, 1, "Rejected writes must not leave logs");

    await edit(staff, 1);
    let current = await snapshot();
    assert.equal(current.version, 2);
    assert.equal(current.requester_id, staff);
    assert.equal(current.item_code, "PEN");
    assert.equal(current.requester_name, "Jose Reyes");
    const editLog = (await logs())[1] as unknown as RequisitionLog;
    assert.equal(editLog.actor_name, "School Staff");
    assert.equal(editLog.before_data?.quantity, 2);
    assert.equal(editLog.after_data.quantity, 4);
    assert.equal(editLog.after_data.request_date, "2026-10-05");
    assert.deepEqual((await asUser(admin, "select quantity from public.items order by sku")).map(row => row.quantity), [20, 20]);
    await assert.rejects(edit(staff, 1), /changed/i);
    await assert.rejects(review(admin, 1), /changed/i);
    await assert.rejects(review(staff, 2), /permission/i);
    await edit(staff, 2); // no-op: do not produce a fake edit or change the version
    assert.equal((await logs()).length, 2);
    assert.equal((await snapshot()).version, 2);
    await edit(admin, 2, 5);
    await edit(superAdmin, 3, 6);
    assert.equal((await logs())[2].actor_id, admin);
    assert.equal((await logs())[3].actor_id, superAdmin);
    // Failure after locking the request must roll back without a decision log.
    await edit(staff, 4, 21);
    await assert.rejects(review(admin, 5), /insufficient/i);
    assert.equal((await snapshot()).status, "pending");
    assert.equal((await logs()).length, 5);
    await edit(staff, 5, 6);
    await review(admin, 6);
    current = await snapshot();
    assert.equal(current.version, 7);
    assert.equal(current.status, "approved");
    assert.equal((await asUser(admin, "select quantity from public.items where id=$1", [second]))[0].quantity, 14);
    assert.equal((await logs()).at(-1)?.event, "approved");
    await assert.rejects(edit(staff, 7), /pending/i);
    await assert.rejects(edit(admin, 7), /pending/i);
    await assert.rejects(review(admin, 7), /already/i);

    const rejected = await create();
    await review(admin, 1, "rejected", rejected);
    assert.equal((await logs(rejected)).at(-1)?.event, "rejected");
    const cancelled = await create();
    await asUser(staff, "select public.cancel_requisition($1)", [cancelled]);
    assert.equal((await logs(cancelled)).at(-1)?.event, "cancelled");
    for (const closed of [rejected, cancelled]) await assert.rejects(asUser(admin, editSql, [closed, item, 1, "Purpose", "Name", "2026-10-04", 2]), /pending/i);
    await asUser(staff, editSql, [historical, item, 3, "Updated older request", "Maria Santos", "2026-10-04", 1]);
    assert.equal((await logs(historical))[0].event, "edited");

    for (const actor of [staff, other, inactive, null]) assert.equal((await asUser(actor, "select * from public.requisition_logs")).length, 0);
    assert.ok((await asUser(superAdmin, "select * from public.requisition_logs")).length > 0);
    await assert.rejects(asUser(null, "select * from public.requisition_logs", [], "anon"), /permission/i);
    for (const actor of [staff, admin, superAdmin]) {
      await assert.rejects(asUser(actor, "update public.requisition_logs set actor_name='Forged'"), /permission/i);
      await assert.rejects(asUser(actor, "delete from public.requisition_logs"), /permission/i);
      await assert.rejects(asUser(actor, "insert into public.requisition_logs(request_id,actor_name,event,after_data) values ($1,'Forged','edited','{}')", [id]), /permission/i);
      await assert.rejects(asUser(actor, "update public.requisitions set quantity=999 where id=$1", [id]), /permission/i);
    }
    await db.query("update public.profiles set full_name='Renamed user' where id=$1", [staff]);
    assert.equal((await logs())[0].actor_name, "School Staff", "Audit actor names are historical snapshots");
    const before = (await asUser(admin, "select count(*)::int as count from public.requisition_logs"))[0].count;
    await asUser(staff, "select public.stock_movement($1,'stock_out',1,'Direct','POS',$2)", [item, randomUUID()]);
    assert.equal((await asUser(admin, "select count(*)::int as count from public.requisition_logs"))[0].count, before);
  } finally { await db.close(); }
});
