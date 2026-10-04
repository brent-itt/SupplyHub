import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import sharp from "sharp";
import { BinaryBitmap, HybridBinarizer, RGBLuminanceSource, QRCodeReader } from "@zxing/library";
import { studentStockOutSchema, studentFormURL } from "../src/lib/student-stock-out";
import { studentFormQR } from "../src/lib/student-form-qr";

test("student form validates required fields and QR codes open the public form", async () => {
  const input = { submission_id: randomUUID(), student_name: "  Maria Santos  ", receipt_date: "2026-10-04", receipt_number: "OR-001", item_id: randomUUID(), quantity: "2" };
  assert.equal(studentStockOutSchema.parse(input).student_name, "Maria Santos");
  for (const invalid of [{ student_name: " " }, { receipt_number: "" }, { receipt_date: "2026-02-30" }, { receipt_date: "0000-01-01" }, { quantity: "0" }, { quantity: "1.5" }, { item_id: "fake" }]) {
    assert.equal(studentStockOutSchema.safeParse({ ...input, ...invalid }).success, false);
  }
  for (const site of ["https://supplyhub.example/scan?x=1", "http://192.168.1.10:3000"]) {
    const qr = studentFormQR(site);
    const { data, info } = await sharp(Buffer.from(qr.image.split(",")[1], "base64")).flatten({ background: "white" }).greyscale().raw().toBuffer({ resolveWithObject: true });
    const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(new Uint8ClampedArray(data), info.width, info.height)));
    assert.equal(new QRCodeReader().decode(bitmap).getText(), new URL("/form", site).href);
  }
  for (const site of ["javascript:alert(1)", "file:///form", "https://user:password@example.com"]) assert.throws(() => studentFormURL(site));
});

test("student submissions stay private and pending; staff confirmation is atomic, logged, and safe to retry", async () => {
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
    for (const file of (await readdir(dir)).filter(file => file.endsWith(".sql")).sort()) await db.exec(await readFile(new URL(file, dir), "utf8"));
    const staff = randomUUID(), admin = randomUUID(), superAdmin = randomUUID(), inactive = randomUUID(), item = randomUUID();
    for (const [id, role, active] of [[staff, "staff", true], [admin, "admin", true], [superAdmin, "super_admin", true], [inactive, "staff", false]]) {
      await db.query("insert into auth.users(id,email) values ($1,'school@example.test')", [id]);
      await db.query("update public.profiles set role=$1,is_active=$2,full_name='Office Staff' where id=$3", [role, active, id]);
    }
    await db.query("insert into public.items(id,sku,name,quantity) values ($1,'UNIFORM-A','Uniform Type A',10)", [item]);
    async function asRole(role: "anon" | "authenticated" | "service_role", actor: string | null, sql: string, args: unknown[] = []) {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor ?? ""]);
      await db.exec(`set role ${role}`);
      try { return (await db.query<Record<string, unknown>>(sql, args)).rows; }
      finally { await db.exec("reset role"); }
    }
    const submitSQL = "select public.submit_student_stock_out($1,$2,$3::date,$4,$5,$6,$7) as id";
    const id = randomUUID(), rateKey = "a".repeat(64);
    const args = [id, "Student Name", "2026-10-04", "OR-001", item, 2, rateKey];
    const submit = (values = args) => asRole("service_role", null, submitSQL, values);
    const process = (actor: string | null, logId: string, decision = "issued", note = "Receipt checked", barcode: string | null = "UNIFORM-A") => asRole("authenticated", actor, "select public.process_student_stock_out($1,$2,$3,$4) as id", [logId, decision, note, barcode]);
    const balance = async () => (await db.query<{ quantity: number }>("select quantity from public.items where id=$1", [item])).rows[0].quantity;
    const log = async (logId = id) => (await db.query<Record<string, unknown>>("select * from public.student_stock_out_logs where id=$1", [logId])).rows[0];
    for (const [role, actor] of [["anon", null], ["authenticated", staff]] as const) await assert.rejects(asRole(role, actor, submitSQL, args), /permission/i);
    await submit();
    await submit();
    assert.equal((await db.query<{ count: number }>("select count(*)::int as count from public.student_stock_out_logs")).rows[0].count, 1);
    assert.equal(await balance(), 10);
    assert.equal((await log()).status, "pending");
    await assert.rejects(submit([id, "Changed name", ...args.slice(2)]), /different details/i);
    await assert.rejects(asRole("anon", null, "select * from public.student_stock_out_logs"), /permission/i);
    assert.equal((await asRole("authenticated", inactive, "select * from public.student_stock_out_logs")).length, 0);
    for (const actor of [staff, admin, superAdmin]) assert.equal((await asRole("authenticated", actor, "select * from public.student_stock_out_logs")).length, 1);
    await assert.rejects(asRole("authenticated", staff, "update public.student_stock_out_logs set quantity=1 where id=$1", [id]), /permission/i);
    await assert.rejects(asRole("authenticated", admin, "delete from public.student_stock_out_logs where id=$1", [id]), /permission/i);
    await assert.rejects(asRole("anon", null, "select public.process_student_stock_out($1,'issued','')", [id]), /permission/i);
    for (const actor of [null, inactive]) await assert.rejects(process(actor, id), /permission|sign in/i);
    await assert.rejects(asRole("authenticated", staff, "select public.process_student_stock_out($1,'issued','')", [id]), /scan/i);
    await assert.rejects(process(staff, id, "issued", "", null), /scan/i);
    await assert.rejects(process(staff, id, "issued", "", "WRONG-ITEM"), /wrong barcode/i);
    assert.equal(await balance(), 10, "A missing or incorrect scan cannot issue stock");
    assert.equal((await log()).status, "pending");
    const first = await process(staff, id);
    const issued = await log();
    assert.equal(await balance(), 8);
    assert.equal(issued.status, "issued");
    assert.equal(issued.processed_by, staff);
    assert.equal(issued.processed_by_name, "Office Staff");
    assert.equal(issued.scanned_barcode, "UNIFORM-A");
    assert.equal(issued.transaction_id, first[0].id);
    assert.deepEqual(await process(admin, id), first);
    assert.deepEqual(await log(), issued, "A repeated confirmation must not change audit attribution");
    assert.equal(await balance(), 8);
    await assert.rejects(process(admin, id, "rejected"), /already/i);
    const transaction = (await db.query<Record<string, unknown>>("select * from public.transactions where id=$1", [issued.transaction_id])).rows[0];
    assert.match(String(transaction.note), /Student Name[\s\S]*OR-001[\s\S]*2026-10-04/);
    assert.equal(transaction.quantity_delta, -2);

    const insufficient = randomUUID();
    await submit([insufficient, ...args.slice(1, 5), 20, rateKey]);
    await assert.rejects(process(staff, insufficient), /insufficient/i);
    assert.equal((await log(insufficient)).status, "pending");
    assert.equal((await log(insufficient)).transaction_id, null);
    assert.equal(await balance(), 8);
    await assert.rejects(process(admin, insufficient, "rejected", ""), /reason/i);
    await process(admin, insufficient, "rejected", "Receipt does not match");
    assert.equal((await log(insufficient)).status, "rejected");
    assert.equal(await balance(), 8);
    await assert.rejects(process(staff, insufficient), /already/i);

    const archived = randomUUID();
    await submit([archived, ...args.slice(1)]);
    await db.query("update public.items set is_archived=true where id=$1", [item]);
    await assert.rejects(process(staff, archived), /restore/i);
    await assert.rejects(submit([randomUUID(), ...args.slice(1)]), /no longer available/i);
    await db.query("update public.items set is_archived=false,name='Renamed uniform' where id=$1", [item]);
    assert.equal((await log()).item_name, "Uniform Type A", "Submitted item name is retained");
    await process(superAdmin, archived);
    assert.equal(await balance(), 6);

    await db.query("update public.student_form_rate_limits set submissions=60 where rate_key=$1", [rateKey]);
    await assert.rejects(submit([randomUUID(), ...args.slice(1)]), /too many submissions/i);
    await submit(); // Retrying an existing submission does not consume rate quota.
    await db.query("update public.student_form_rate_limits set window_start=now()-interval '6 minutes' where rate_key=$1", [rateKey]);
    await submit([randomUUID(), ...args.slice(1)]);
    assert.equal((await db.query<{ submissions: number }>("select submissions from public.student_form_rate_limits where rate_key=$1", [rateKey])).rows[0].submissions, 1);
  } finally { await db.close(); }
});
