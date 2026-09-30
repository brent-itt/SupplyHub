import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const users = {
  super: "10000000-0000-4000-8000-000000000001",
  admin: "10000000-0000-4000-8000-000000000002",
  staff: "10000000-0000-4000-8000-000000000003",
  otherStaff: "10000000-0000-4000-8000-000000000004",
  student: "10000000-0000-4000-8000-000000000005",
  inactive: "10000000-0000-4000-8000-000000000006",
};

// A real Supabase request gets auth.uid() from a verified JWT. Only this test
// harness sets the claim directly; browser callers never have SQL access.
before(async () => {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (
      id uuid primary key,
      email text,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    grant usage on schema auth, public to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  const migration = await readFile(
    new URL("../supabase/migrations/202609250001_supplies_system.sql", import.meta.url),
    "utf8",
  );
  await db.exec(migration);
  for (const [name, id] of Object.entries(users)) {
    await db.query("insert into auth.users(id, email) values ($1, $2)", [id, `${name}@university.test`]);
    const role = name === "super" ? "super_admin" : name === "otherStaff" ? "staff" : name === "inactive" ? "admin" : name;
    await db.query("update public.profiles set role = $1, is_active = $2 where id = $3", [role, name !== "inactive", id]);
  }
});

after(async () => {
  await db.close();
});

async function asUser(user, sql, params = [], role = "authenticated") {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [users[user] ?? user ?? ""]);
  await db.exec(`set role ${role === "anon" ? "anon" : "authenticated"}`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

async function createItem(user = "admin", sku = `SUP-${randomUUID().slice(0, 8)}`) {
  const rows = await asUser(user, `select public.upsert_item(null, $1, 'Scantron sheets', 'Exam sheets', 'Scantron', 'sheet', 'Supplies office', 5) as id`, [sku]);
  return rows[0].id;
}

async function move(item, kind, quantity, { user = "admin", note = "Delivery", reference = "REF-01", key = randomUUID() } = {}) {
  const rows = await asUser(user, "select public.stock_movement($1, $2, $3, $4, $5, $6) as id", [item, kind, quantity, note, reference, key]);
  return rows[0].id;
}

async function quantity(item) {
  return (await asUser("admin", "select quantity from public.items where id = $1", [item]))[0].quantity;
}

async function request(item, count, user = "staff") {
  return (await asUser(user, "select public.create_requisition($1, $2, 'Midterm examinations') as id", [item, count]))[0].id;
}

test("auth metadata cannot activate or elevate a new account; email updates preserve assigned access", async () => {
  const id = randomUUID();
  await db.query("insert into auth.users(id, email, raw_user_meta_data) values ($1, 'new@university.test', $2)", [
    id, JSON.stringify({ full_name: "New Student", role: "super_admin", is_active: true }),
  ]);
  let profile = (await asUser(id, "select * from public.profiles"))[0];
  assert.equal(profile.role, "student");
  assert.equal(profile.is_active, false);
  assert.equal(profile.full_name, "New Student");
  await asUser("super", "select public.set_user_access($1, 'staff', true)", [id]);
  await db.query("update auth.users set email = 'updated@university.test' where id = $1", [id]);
  profile = (await asUser(id, "select * from public.profiles"))[0];
  assert.equal(profile.role, "staff");
  assert.equal(profile.is_active, true);
  assert.equal(profile.email, "updated@university.test");
});

test("anonymous, missing-session, inactive, student and staff callers cannot mutate inventory", async () => {
  await assert.rejects(asUser(null, "select * from public.items", [], "anon"), /permission denied/i);
  await assert.rejects(asUser(null, "select public.archive_item($1, true)", [randomUUID()], "anon"), /permission denied/i);
  await assert.rejects(createItem(null), /sign in/i);
  for (const user of ["inactive", "student", "staff"]) {
    await assert.rejects(createItem(user), /permission/i);
    await assert.rejects(move(randomUUID(), "stock_in", 1, { user }), /permission/i);
    await assert.rejects(asUser(user, "select public.archive_item($1, true)", [randomUUID()]), /permission/i);
  }
  await assert.rejects(asUser("admin", "select public.require_role(array['admin'])"), /permission denied/i);
});

test("direct writes are denied even to managers and super admins", async () => {
  const item = await createItem();
  for (const user of ["student", "staff", "admin", "super"]) {
    await assert.rejects(asUser(user, "update public.items set quantity = 999 where id = $1", [item]), /permission denied/i);
    await assert.rejects(asUser(user, "delete from public.items where id = $1", [item]), /permission denied/i);
    await assert.rejects(asUser(user, "update public.profiles set role = 'super_admin' where id = $1", [users[user]]), /permission denied/i);
    await assert.rejects(asUser(user, "insert into public.requisitions(item_id, requester_id, quantity, purpose) values ($1, $2, 1, 'Bypass')", [item, users[user]]), /permission denied/i);
    await assert.rejects(asUser(user, "delete from public.transactions"), /permission denied/i);
  }
  assert.equal(await quantity(item), 0);
});

test("students see active supplies, managers see archives, and inactive accounts see no inventory", async () => {
  const visible = await createItem();
  const archived = await createItem();
  await asUser("admin", "select public.archive_item($1, true)", [archived]);
  const studentItems = await asUser("student", "select id from public.items where id = any($1::uuid[])", [[visible, archived]]);
  assert.deepEqual(studentItems.map((item) => item.id), [visible]);
  assert.equal((await asUser("admin", "select id from public.items where id = $1", [archived])).length, 1);
  assert.equal((await asUser("inactive", "select id from public.items")).length, 0);
  assert.equal((await asUser(null, "select id from public.items")).length, 0);
  const own = await asUser("student", "select id from public.profiles");
  assert.deepEqual(own.map((profile) => profile.id), [users.student]);
  assert.equal((await asUser("inactive", "select id from public.profiles")).length, 1);
  await asUser("admin", "select public.archive_item($1, false)", [archived]);
  assert.equal((await asUser("student", "select id from public.items where id = $1", [archived])).length, 1);
});

test("item edits preserve balance and enforce unique normalized SKUs", async () => {
  const sku = `sku-${randomUUID().slice(0, 8)}`;
  const item = await createItem("admin", sku);
  await move(item, "stock_in", 12);
  await asUser("admin", "select public.upsert_item($1, $2, 'Updated sheets', '', 'Scantron', 'sheet', 'Room 2', 2)", [item, sku]);
  const row = (await asUser("admin", "select * from public.items where id = $1", [item]))[0];
  assert.equal(row.quantity, 12);
  assert.equal(row.sku, sku.toUpperCase());
  assert.equal(row.name, "Updated sheets");
  await assert.rejects(createItem("admin", sku.toUpperCase()), /unique|duplicate/i);
  await assert.rejects(asUser("admin", "select public.upsert_item(null, 'X', '', '', 'General', 'piece', '', -1)"), /valid/i);
});

test("stock in, out and adjustments produce an immutable, arithmetically consistent ledger", async () => {
  const item = await createItem();
  await move(item, "stock_in", 20);
  await move(item, "stock_out", 7, { note: "Issued to faculty" });
  await move(item, "adjustment", 10, { note: "Physical count correction" });
  assert.equal(await quantity(item), 10);
  const history = await asUser("admin", "select quantity_delta, balance_after from public.transactions where item_id = $1 order by created_at, id", [item]);
  assert.deepEqual(history.map((row) => row.quantity_delta), [20, -7, -3]);
  assert.deepEqual(history.map((row) => row.balance_after), [20, 13, 10]);
  assert.equal((await asUser("student", "select * from public.transactions")).length, 0);
  assert.equal((await asUser("staff", "select * from public.transactions")).length, 0);
  // Even privileged SQL edits must explicitly override the immutable trigger.
  await assert.rejects(db.query("update public.transactions set note = 'Rewritten' where item_id = $1", [item]), /immutable/i);
  await assert.rejects(db.query("delete from public.transactions where item_id = $1", [item]), /immutable/i);
});

test("invalid and insufficient-stock changes roll back balances and history", async () => {
  const item = await createItem();
  await move(item, "stock_in", 4);
  await assert.rejects(move(item, "stock_out", 5), /insufficient/i);
  await assert.rejects(move(item, "stock_in", 0), /invalid/i);
  await assert.rejects(move(item, "stock_out", -2), /invalid/i);
  await assert.rejects(move(item, "adjustment", 2, { note: "  " }), /reason/i);
  await assert.rejects(move(item, "adjustment", -1), /invalid/i);
  await assert.rejects(move(item, "stock_in", 2147483647), /supported quantity/i);
  assert.equal(await quantity(item), 4);
  assert.equal((await asUser("admin", "select id from public.transactions where item_id = $1", [item])).length, 1);
});

test("idempotency returns the original movement and rejects altered payloads or actors", async () => {
  const item = await createItem();
  const key = randomUUID();
  const id = await move(item, "stock_in", 8, { key });
  assert.equal(await move(item, "stock_in", 8, { key }), id);
  assert.equal(await quantity(item), 8);
  await assert.rejects(move(item, "stock_in", 9, { key }), /different movement/i);
  await assert.rejects(move(item, "stock_in", 8, { key, note: "Changed" }), /different movement/i);
  await assert.rejects(move(item, "stock_in", 8, { key, user: "super" }), /different movement/i);
  await assert.rejects(move(item, "stock_in", 8, { key, reference: "Changed" }), /different movement/i);
  const otherItem = await createItem();
  await assert.rejects(move(otherItem, "stock_in", 8, { key }), /different movement/i);
  const adjustKey = randomUUID();
  const adjusted = await move(item, "adjustment", 5, { key: adjustKey, note: "Recount" });
  await move(item, "stock_out", 1);
  assert.equal(await move(item, "adjustment", 5, { key: adjustKey, note: "Recount" }), adjusted);
  assert.equal(await quantity(item), 4);
  await assert.rejects(move(item, "adjustment", 6, { key: adjustKey, note: "Recount" }), /different movement/i);
});

test("staff requisitions are private, own-cancellable, and not available to students", async () => {
  const item = await createItem();
  const id = await request(item, 2);
  assert.equal((await asUser("staff", "select id from public.requisitions where id = $1", [id])).length, 1);
  assert.equal((await asUser("otherStaff", "select id from public.requisitions where id = $1", [id])).length, 0);
  assert.equal((await asUser("student", "select id from public.requisitions where id = $1", [id])).length, 0);
  assert.equal((await asUser("admin", "select id from public.requisitions where id = $1", [id])).length, 1);
  await assert.rejects(request(item, 1, "student"), /permission/i);
  await assert.rejects(request(item, 0), /positive/i);
  await assert.rejects(asUser("otherStaff", "select public.cancel_requisition($1)", [id]), /own requisitions/i);
  await assert.rejects(asUser("staff", "select public.review_requisition($1, 'approved', '')", [id]), /permission/i);
  await asUser("staff", "select public.cancel_requisition($1)", [id]);
  assert.equal((await asUser("staff", "select status from public.requisitions where id = $1", [id]))[0].status, "cancelled");
  await assert.rejects(asUser("admin", "select public.review_requisition($1, 'approved', '')", [id]), /already been processed/i);
});

test("approval deducts stock exactly once and failed approval leaves the whole request pending", async () => {
  const item = await createItem();
  const id = await request(item, 5);
  await move(item, "stock_in", 3);
  await assert.rejects(asUser("admin", "select public.review_requisition($1, 'approved', 'Approved')", [id]), /insufficient/i);
  assert.equal(await quantity(item), 3);
  let row = (await asUser("staff", "select * from public.requisitions where id = $1", [id]))[0];
  assert.equal(row.status, "pending");
  assert.equal(row.reviewer_id, null);
  assert.equal((await asUser("admin", "select id from public.transactions where request_id = $1", [id])).length, 0);
  await move(item, "stock_in", 4);
  await asUser("admin", "select public.review_requisition($1, 'approved', 'For exams')", [id]);
  assert.equal(await quantity(item), 2);
  row = (await asUser("staff", "select * from public.requisitions where id = $1", [id]))[0];
  assert.equal(row.status, "approved");
  assert.equal(row.reviewer_id, users.admin);
  const ledger = await asUser("admin", "select * from public.transactions where request_id = $1", [id]);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].quantity_delta, -5);
  await assert.rejects(asUser("admin", "select public.review_requisition($1, 'approved', 'Retry')", [id]), /already been processed/i);
  await assert.rejects(asUser("staff", "select public.cancel_requisition($1)", [id]), /pending/i);
  assert.equal(await quantity(item), 2);
  const rejected = await request(item, 1);
  await asUser("admin", "select public.review_requisition($1, 'rejected', 'Request later')", [rejected]);
  assert.equal(await quantity(item), 2);
  assert.equal((await asUser("admin", "select id from public.transactions where request_id = $1", [rejected])).length, 0);
});

test("archiving requires zero stock and no pending requests; archived items reject new movements", async () => {
  const item = await createItem();
  await move(item, "stock_in", 1);
  await assert.rejects(asUser("admin", "select public.archive_item($1, true)", [item]), /zero stock/i);
  await move(item, "stock_out", 1);
  const id = await request(item, 1);
  await assert.rejects(asUser("admin", "select public.archive_item($1, true)", [item]), /pending requisitions/i);
  await asUser("staff", "select public.cancel_requisition($1)", [id]);
  await asUser("admin", "select public.archive_item($1, true)", [item]);
  await assert.rejects(move(item, "stock_in", 1), /restore/i);
  await assert.rejects(request(item, 1), /unavailable/i);
});

test("only a super admin can manage access; self-demotion and self-disable are blocked", async () => {
  for (const user of ["student", "staff", "admin", "inactive"]) {
    await assert.rejects(asUser(user, "select public.set_user_access($1, 'super_admin', true)", [users[user]]), /permission/i);
  }
  await assert.rejects(asUser("super", "select public.set_user_access($1, 'admin', true)", [users.super]), /own super admin/i);
  await assert.rejects(asUser("super", "select public.set_user_access($1, 'super_admin', false)", [users.super]), /own super admin/i);
  await assert.rejects(asUser("super", "select public.set_user_access($1, 'owner', true)", [users.student]), /valid role/i);
  await asUser("super", "select public.set_user_access($1, 'staff', false)", [users.otherStaff]);
  const item = await createItem();
  await assert.rejects(request(item, 1, "otherStaff"), /permission/i);
  assert.equal((await asUser("otherStaff", "select id from public.items")).length, 0);
  await asUser("super", "select public.set_user_access($1, 'staff', true)", [users.otherStaff]);
  assert.ok(await request(item, 1, "otherStaff"));
});
