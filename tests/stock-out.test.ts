import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { checkoutSchema, issueCheckout, stockOutNote, matchesStudentCheckout, type Checkout } from "../src/lib/stock-out";
import type { StudentCheckoutLog } from "../src/lib/student-stock-out";

const receipt = { recipient_name: "Maria Santos", receipt_number: "SO-2026-0001", receipt_date: "2026-10-04" };

test("student checkout requires a scan and matches the saved student, receipt, item, and quantity", () => {
  const log: StudentCheckoutLog = { id: randomUUID(), student_name: receipt.recipient_name, receipt_number: receipt.receipt_number, receipt_date: receipt.receipt_date, item_id: randomUUID(), item_name: "Uniform", quantity: 2, unit: "piece", status: "pending", student_email: "student@example.test", fulfilled_quantity: 0, vip_queued_at: null };
  const checkout = { ...receipt, reference: randomUUID(), student_log_id: log.id, scanned_barcode: "UNIFORM", note: "Student collection", lines: [{ item_id: log.item_id, quantity: 2, idempotency_key: randomUUID() }] };
  assert.equal(checkoutSchema.safeParse({ ...checkout, scanned_barcode: undefined }).success, false);
  assert.equal(matchesStudentCheckout(checkoutSchema.parse(checkout), log), true);
  assert.equal(matchesStudentCheckout({ ...checkout, lines: [{ ...checkout.lines[0], quantity: 1 }] }, log), true);
  for (const invalid of [{ recipient_name: "Other student" }, { receipt_number: "OTHER" }, { receipt_date: "2026-10-05" }, { lines: [{ ...checkout.lines[0], quantity: 3 }] }, { lines: [{ ...checkout.lines[0], item_id: randomUUID() }] }]) {
    assert.equal(matchesStudentCheckout({ ...checkout, ...invalid }, log), false);
  }
});

test("checkout rejects empty carts, duplicate items, repeated keys and invalid quantities", () => {
  const line = { item_id: randomUUID(), quantity: 1, idempotency_key: randomUUID() };
  const base = { ...receipt, reference: randomUUID(), note: "Office supplies", lines: [line] };
  assert.equal(checkoutSchema.safeParse(base).success, true);
  for (const lines of [[], [line, line], [line, { ...line, item_id: randomUUID() }], [{ ...line, quantity: 0 }], [{ ...line, quantity: 1.5 }], [{ ...line, quantity: 2147483648 }]]) {
    assert.equal(checkoutSchema.safeParse({ ...base, lines }).success, false);
  }
});

test("receipt details are required, trimmed, and fit in the transaction note", () => {
  const base = { ...receipt, reference: randomUUID(), note: "Office supplies", lines: [{ item_id: randomUUID(), quantity: 1, idempotency_key: randomUUID() }] };
  for (const invalid of [{ recipient_name: " " }, { receipt_number: " " }, { receipt_date: "2026-02-30" }, { receipt_date: "0000-01-01" }, { receipt_date: "" }, { recipient_name: "Name\nDate: forged" }, { receipt_number: "SO-1\nName: forged" }, { note: "x".repeat(1501) }]) {
    assert.equal(checkoutSchema.safeParse({ ...base, ...invalid }).success, false);
  }
  const parsed = checkoutSchema.parse({ ...base, recipient_name: "  Maria Santos  ", receipt_number: "  SO-2026-0001  " });
  assert.equal(stockOutNote(parsed), "Name: Maria Santos\nReceipt number: SO-2026-0001\nDate: 2026-10-04\nPurpose: Office supplies");
  const longest = checkoutSchema.parse({ ...base, recipient_name: "N".repeat(160), receipt_number: "R".repeat(160), note: "P".repeat(1500) });
  assert.ok(stockOutNote(longest).length <= 2000);
});

test("stock-out checkout reports partial issuance, retries without double deductions, and enforces database permissions", async () => {
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
    for (const file of ["202609250001_supplies_system.sql", "202609270001_public_stock_no_students.sql", "202609270002_admin_only_stock_edits.sql", "202610040001_staff_stock_out.sql"]) {
      await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
    }
    const admin = randomUUID(), staff = randomUUID(), first = randomUUID(), second = randomUUID();
    for (const [id, role] of [[admin, "admin"], [staff, "staff"]]) {
      await db.query("insert into auth.users(id) values ($1)", [id]);
      await db.query("update public.profiles set role=$1, is_active=true where id=$2", [role, id]);
    }
    await db.query("insert into public.items(id, sku, name, quantity) values ($1,'FIRST','First supply',10),($2,'SECOND','Second supply',1)", [first, second]);
    const checkout: Checkout = { ...receipt, reference: randomUUID(), note: "Registrar supplies", lines: [first, second].map(item_id => ({ item_id, quantity: 3, idempotency_key: randomUUID() })) };
    const issue = (actor: string) => async (line: Checkout["lines"][number]) => {
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [actor]);
      await db.exec("set role authenticated");
      try {
        await db.query("select public.stock_movement($1,'stock_out',$2,$3,$4,$5)", [line.item_id, line.quantity, stockOutNote(checkout), `POS-${checkout.reference}`, line.idempotency_key]);
        return { error: null };
      } catch (error) {
        return { error: error as { message: string; code?: string } };
      } finally { await db.exec("reset role"); }
    };
    const balance = async (id: string) => (await db.query<{quantity: number}>("select quantity from public.items where id=$1", [id])).rows[0].quantity;
    await db.query("update public.profiles set is_active=false where id=$1", [staff]);
    const denied = await issueCheckout(checkout, issue(staff));
    assert.equal(denied.completed.length, 0);
    assert.match(denied.error!, /permission/i);
    assert.equal(await balance(first), 10);

    await db.query("update public.profiles set is_active=true where id=$1", [staff]);
    const partial = await issueCheckout(checkout, issue(staff));
    assert.deepEqual(partial.completed, [first]);
    assert.match(partial.error!, /insufficient stock/i);
    assert.equal(partial.canEdit, true);
    assert.equal(await balance(first), 7);
    assert.equal(await balance(second), 1);
    // Simulate receiving new stock before the operator retries the original cart.
    await db.query("update public.items set quantity=5 where id=$1", [second]);
    const retried = await issueCheckout(checkout, issue(staff));
    assert.deepEqual(retried.completed, [first, second]);
    assert.equal(retried.error, undefined);
    assert.equal(await balance(first), 7);
    assert.equal(await balance(second), 2);
    assert.equal((await db.query<{count: number}>("select count(*)::int as count from public.transactions")).rows[0].count, 2);
    const recorded = await db.query("select note,reference from public.transactions");
    assert.deepEqual(recorded.rows, Array.from({ length: 2 }, () => ({ note: stockOutNote(checkout), reference: `POS-${checkout.reference}` })));
    // Receipt details are part of the immutable retry payload.
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [staff]);
    await db.exec("set role authenticated");
    try {
      await assert.rejects(db.query("select public.stock_movement($1,'stock_out',3,$2,$3,$4)", [first, stockOutNote({ ...checkout, recipient_name: "Changed recipient" }), `POS-${checkout.reference}`, checkout.lines[0].idempotency_key]), /different|retry|key/i);
    } finally { await db.exec("reset role"); }
    assert.equal(await balance(first), 7);

    // A response can be lost after PostgreSQL commits. Retrying must confirm it.
    const lost: Checkout = { ...checkout, reference: randomUUID(), lines: [{ item_id: first, quantity: 2, idempotency_key: randomUUID() }] };
    const uncertain = await issueCheckout(lost, async line => { await issue(staff)(line); throw new Error("Response lost"); });
    assert.equal(uncertain.canEdit, false);
    assert.equal(uncertain.completed.length, 0);
    assert.equal(await balance(first), 5);
    await issueCheckout(lost, issue(staff));
    assert.equal(await balance(first), 5);

    await db.query("update public.items set is_archived=true where id=$1", [second]);
    const archived = await issueCheckout({ ...checkout, lines: [{ item_id: second, quantity: 1, idempotency_key: randomUUID() }] }, issue(staff));
    assert.match(archived.error!, /restore/i);
    assert.equal(await balance(second), 2);
  } finally { await db.close(); }
});
