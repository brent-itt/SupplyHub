import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { matchingSupplyNames, universityDate } from "../src/lib/requisitions";
import { requestSchema } from "../src/lib/validation";
import type { Item } from "../src/lib/types";

test("requisitions validate the requestor and calendar date and resolve exact supply names", () => {
  const base = { item_id: randomUUID(), quantity: "2", purpose: "School office supplies", requester_name: "  Maria Santos  ", request_date: "2026-10-04" };
  assert.equal(requestSchema.parse(base).requester_name, "Maria Santos");
  for (const request_date of ["", "2026-02-30", "0000-01-01", "2026-13-01", "2026-10-04T00:00:00Z"]) {
    assert.equal(requestSchema.safeParse({ ...base, request_date }).success, false);
  }
  assert.equal(requestSchema.safeParse({ ...base, requester_name: " " }).success, false);
  assert.equal(universityDate(new Date("2026-10-03T17:00:00Z")), "2026-10-04");
  const items = [{ id: "1", name: "Paper", sku: "PAPER-A", is_archived: false }, { id: "2", name: "Paper", sku: "PAPER-B", is_archived: false }, { id: "3", name: "Pen", sku: "PEN", is_archived: false }, { id: "4", name: "Old paper", is_archived: true }] as Item[];
  assert.deepEqual(matchingSupplyNames(items, " pen ").map(item => item.sku), ["PEN"]);
  assert.equal(matchingSupplyNames(items, "Paper").length, 2);
  assert.equal(matchingSupplyNames(items, "Pap").length, 0);
  assert.equal(matchingSupplyNames(items, "Old paper").length, 0);
});

test("school staff requisitions persist metadata, retain approval rules, and are independent of direct stock out", async () => {
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
    const migrationDir = new URL("../supabase/migrations/", import.meta.url);
    const latest = "202610040002_school_staff_requisitions.sql";
    for (const file of (await readdir(migrationDir)).filter(name => name.endsWith(".sql") && name < latest).sort()) {
      await db.exec(await readFile(new URL(file, migrationDir), "utf8"));
    }
    const staff = randomUUID(), admin = randomUUID(), inactive = randomUUID(), item = randomUUID(), archived = randomUUID();
    for (const [id, role, active] of [[staff, "staff", true], [admin, "admin", true], [inactive, "staff", false]]) {
      await db.query("insert into auth.users(id, email) values ($1,'school@example.test')", [id]);
      await db.query("update public.profiles set role=$1,is_active=$2,full_name='Staff Recorder' where id=$3", [role, active, id]);
    }
    await db.query("insert into public.items(id,sku,name,quantity) values ($1,'PAPER-A4','Bond paper',10)", [item]);
    await db.query("insert into public.items(id,sku,name,is_archived) values ($1,'ARCHIVED','Old paper',true)", [archived]);
    async function asUser(actor: string | null, sql: string, values: unknown[] = [], role = "authenticated") {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor ?? ""]);
      await db.exec(role === "anon" ? "set role anon" : "set role authenticated");
      try { return (await db.query(sql, values)).rows as Record<string, unknown>[]; }
      finally { await db.exec("reset role"); }
    }
    const old = (await asUser(staff, "select public.create_requisition($1,1,'School supplies') as id", [item]))[0].id;
    await db.query("update public.requisitions set created_at='2026-10-03T17:00:00Z' where id=$1", [old]);
    await db.exec(await readFile(new URL(latest, migrationDir), "utf8"));
    const savedOld = (await db.query("select requester_name, request_date::text, item_name, item_code from public.requisitions where id=$1", [old])).rows[0];
    assert.deepEqual(savedOld, { requester_name: "Staff Recorder", request_date: "2026-10-04", item_name: "Bond paper", item_code: "PAPER-A4" });

    const sql = "select public.create_requisition($1,$2,$3,$4,$5::date) as id";
    const args = [item, 3, "Department supplies", "  Maria Santos  ", "2026-10-04"];
    for (const actor of [admin, inactive, null]) await assert.rejects(asUser(actor, sql, args), /permission|sign in/i);
    await assert.rejects(asUser(null, sql, args, "anon"), /permission/i);
    await assert.rejects(asUser(staff, "select public.create_requisition($1,1,'Old endpoint')", [item]), /does not exist/i);
    for (const badArgs of [[item, 3, "Purpose", " ", "2026-10-04"], [item, 3, "Purpose", "Maria Santos", null], [item, 0, "Purpose", "Maria Santos", "2026-10-04"], [item, 3, "Purpose", "Maria Santos", "2026-02-30"], [archived, 3, "Purpose", "Maria Santos", "2026-10-04"]]) {
      await assert.rejects(asUser(staff, sql, badArgs), /enter|date|range|unavailable/i);
    }
    const id = (await asUser(staff, sql, args))[0].id;
    const saved = (await asUser(staff, "select requester_id, requester_name, request_date::text, item_name, item_code, status from public.requisitions where id=$1", [id]))[0];
    assert.deepEqual(saved, { requester_id: staff, requester_name: "Maria Santos", request_date: "2026-10-04", item_name: "Bond paper", item_code: "PAPER-A4", status: "pending" });
    const balance = async () => (await db.query<{quantity: number}>("select quantity from public.items where id=$1", [item])).rows[0].quantity;
    assert.equal(await balance(), 10, "Creating a requisition must not issue stock");
    await assert.rejects(asUser(staff, "update public.requisitions set item_code='FORGED' where id=$1", [id]), /permission/i);
    await db.query("update public.items set name='Renamed paper',sku='NEW-CODE' where id=$1", [item]);
    assert.equal((await asUser(admin, "select item_code from public.requisitions where id=$1", [id]))[0].item_code, "PAPER-A4");
    await assert.rejects(asUser(staff, "select public.review_requisition($1,'approved','')", [id]), /permission/i);
    await asUser(admin, "select public.review_requisition($1,'approved','Issued')", [id]);
    assert.equal(await balance(), 7);
    await assert.rejects(asUser(admin, "select public.review_requisition($1,'approved','Issued')", [id]), /already/i);

    const requestCount = (await db.query("select count(*)::int as count from public.requisitions")).rows[0];
    await asUser(staff, "select public.stock_movement($1,'stock_out',2,'Direct issue','POS-test',$2)", [item, randomUUID()]);
    assert.equal(await balance(), 5);
    assert.deepEqual((await db.query("select count(*)::int as count from public.requisitions")).rows[0], requestCount);
    assert.equal((await db.query<{request_id: string | null}>("select request_id from public.transactions where reference='POS-test'")).rows[0].request_id, null);
  } finally { await db.close(); }
});
