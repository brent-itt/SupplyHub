import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { deliverVipReminder, vipReminderMessage, type PreparedReminder } from "../src/lib/vip-reminder";
import type { VipQueueEntry } from "../src/lib/student-stock-out";

const entry = { student_name: "Maria Santos", item_name: "Type B", item_code: "TYPE-B", receipt_number: "OR-101", quantity: 10, fulfilled_quantity: 3, remaining_quantity: 7, available_quantity: 3, unit: "piece", item_position: 1, is_archived: false } as VipQueueEntry;

test("reminders distinguish partial availability, waiting stock, and archived items", () => {
  const ready = vipReminderMessage(entry);
  assert.match(ready.subject, /ready for collection/);
  for (const text of ["Hello Maria Santos", "3 piece are currently available", "Remaining: 7 piece", "Receipt number: OR-101", "bring your receipt"]) assert.ok(ready.text.includes(text));
  const waiting = vipReminderMessage({ ...entry, available_quantity: 0 });
  assert.match(waiting.subject, /update/);
  assert.match(waiting.text, /no stock ready/);
  assert.doesNotMatch(waiting.text, /Please visit/);
  const archived = vipReminderMessage({ ...entry, is_archived: true });
  assert.match(archived.text, /currently unavailable/);
  assert.doesNotMatch(archived.subject, /ready/);
});

test("Resend retries keep the saved payload and key; errors never claim success", async () => {
  const reminder: PreparedReminder = { id: randomUUID(), recipient: "student@example.test", accepted_at: null, payload: { from: "SupplyHub <supplies@example.test>", to: ["student@example.test"], ...vipReminderMessage(entry) } };
  const calls: RequestInit[] = [];
  const send: typeof fetch = async (url, options) => { assert.equal(url, "https://api.resend.com/emails"); calls.push(options!); return Response.json({ id: "email-id" }); };
  assert.equal(await deliverVipReminder(reminder, "test-key", send), "email-id");
  assert.equal(await deliverVipReminder(reminder, "test-key", send), "email-id");
  assert.equal(calls[0].body, calls[1].body);
  assert.deepEqual(calls[0].headers, calls[1].headers);
  assert.equal((calls[0].headers as Record<string, string>)["Idempotency-Key"], `vip-reminder/${reminder.id}`);
  assert.equal((calls[0].headers as Record<string, string>).Authorization, "Bearer test-key");
  for (const status of [400, 401, 403, 409, 429, 500]) await assert.rejects(deliverVipReminder(reminder, "test-key", async () => new Response("Provider detail", { status })), /email|reminder|Resend/i);
  for (const [status, name, message, expected] of [
    [403, "validation_error", "The example.test domain is not verified.", /DNS records.*Verified/],
    [403, "validation_error", "You can only send testing emails to your own email address.", /test recipients/],
    [403, "suspended_api_key", "This API key is suspended", /suspended/],
    [403, "restricted_api_key", "API key is not active", /inactive or restricted/],
    [401, "invalid_api_key", "API key is invalid", /did not accept the API key/],
  ] as const) {
    await assert.rejects(deliverVipReminder(reminder, "test-key", async () => Response.json({ name, message }, { status })), expected);
  }
  await assert.rejects(deliverVipReminder(reminder, "test-key", async () => Response.json({})), /confirmation/i);
  await assert.rejects(deliverVipReminder(reminder, "test-key", async () => { throw new TypeError("Network lost"); }), /Network/);
});

test("reminder records enforce admin access, save missing emails, freeze retries, and suppress duplicate sends", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz default now(),raw_user_meta_data jsonb default '{}'::jsonb);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;$$;
      grant usage on schema auth,public to anon,authenticated,service_role;
      grant execute on function auth.uid() to anon,authenticated,service_role;`);
    const dir = new URL("../supabase/migrations/", import.meta.url);
    for (const file of (await readdir(dir)).filter(file => file.endsWith(".sql")).sort()) await db.exec(await readFile(new URL(file, dir), "utf8"));
    const admin = randomUUID(), staff = randomUUID(), inactive = randomUUID(), item = randomUUID(), log = randomUUID();
    for (const [id, role, active] of [[admin, "admin", true], [staff, "staff", true], [inactive, "admin", false]]) {
      await db.query("insert into auth.users(id,email) values ($1,'office@example.test')", [id]);
      await db.query("update public.profiles set role=$1,is_active=$2 where id=$3", [role, active, id]);
    }
    await db.query("insert into public.items(id,sku,name,quantity) values ($1,'TYPE-B','Type B',0)", [item]);
    await db.query("insert into public.student_stock_out_logs(id,student_name,receipt_date,receipt_number,item_id,item_name,item_code,unit,quantity,vip_queued_at) values ($1,'Old Student','2026-10-15','OR-1',$2,'Type B','TYPE-B','piece',10,now())", [log, item]);
    async function asRole(role: "authenticated" | "service_role" | "anon", actor: string | null, sql: string, params: unknown[] = []) {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor ?? ""]);
      await db.exec(`set role ${role}`);
      try { return (await db.query<Record<string, unknown>>(sql, params)).rows; }
      finally { await db.exec("reset role"); }
    }
    const payload = { from: "SupplyHub <supplies@example.test>", to: ["student@example.test"], ...vipReminderMessage(entry) };
    const key = randomUUID();
    const sql = "select * from public.prepare_student_vip_reminder($1,$2,$3,$4,$5::jsonb)";
    const args = [key, log, admin, "student@example.test", JSON.stringify(payload)];
    const prepare = (values: unknown[] = args) => asRole("service_role", null, sql, values);
    for (const role of ["anon", "authenticated"] as const) await assert.rejects(asRole(role, admin, sql, args), /permission/i);
    for (const actor of [staff, inactive, null]) await assert.rejects(prepare([key, log, actor, ...args.slice(3)]), /administrators/i);
    await assert.rejects(prepare([key, log, admin, "invalid", args[4]]), /valid/i);
    const first = (await prepare())[0];
    assert.equal(first.recipient, "student@example.test");
    assert.equal((await db.query<{ student_email: string }>("select student_email from public.student_stock_out_logs where id=$1", [log])).rows[0].student_email, "student@example.test");
    const changed = JSON.stringify({ ...payload, text: "Stock changed" });
    assert.deepEqual((await prepare([key, ...args.slice(1, 4), changed]))[0], first, "Same request preserves the exact email payload");
    assert.deepEqual((await prepare([randomUUID(), ...args.slice(1)]))[0], first, "Another tab resumes the pending send");
    await assert.rejects(prepare([randomUUID(), log, admin, "other@example.test", JSON.stringify({ ...payload, to: ["other@example.test"] })]), /email has changed/i);
    await assert.rejects(asRole("authenticated", admin, "select public.complete_student_vip_reminder($1,'forged')", [key]), /permission/i);
    await asRole("service_role", null, "select public.complete_student_vip_reminder($1,'provider-id')", [key]);
    await asRole("service_role", null, "select public.complete_student_vip_reminder($1,'provider-id')", [key]);
    assert.ok((await prepare([randomUUID(), ...args.slice(1)]))[0].accepted_at);
    assert.equal((await asRole("authenticated", admin, "select * from public.student_vip_reminders")).length, 1);
    assert.equal((await asRole("authenticated", staff, "select * from public.student_vip_reminders")).length, 0);
    await assert.rejects(asRole("anon", null, "select * from public.student_vip_reminders"), /permission/i);
    await assert.rejects(asRole("authenticated", admin, "delete from public.student_vip_reminders"), /permission/i);
    await db.query("update public.student_vip_reminders set accepted_at=now()-interval '6 minutes' where id=$1", [key]);
    const nextKey = randomUUID();
    assert.equal((await prepare([nextKey, ...args.slice(1)]))[0].id, nextKey);
    await db.query("update public.student_vip_reminders set created_at=now()-interval '24 hours' where id=$1", [nextKey]);
    await assert.rejects(prepare([randomUUID(), ...args.slice(1)]), /unconfirmed/i);
    // Switching provider creates a Gmail payload, not the frozen Resend sender.
    const gmailKey = randomUUID();
    const gmailArgs = [gmailKey, ...args.slice(1, 4), JSON.stringify({ ...payload, from: "SupplyHub <office@gmail.com>" })];
    const gmailSql = "select * from public.prepare_student_vip_reminder($1,$2,$3,$4,$5::jsonb,'gmail')";
    const gmailRow = (await asRole("service_role", null, gmailSql, gmailArgs))[0];
    assert.equal(gmailRow.provider, "gmail");
    assert.equal((gmailRow.payload as typeof payload).from, "SupplyHub <office@gmail.com>");
    const claim = randomUUID();
    const claimSql = "select public.claim_student_gmail_reminder($1,$2) as claimed";
    await assert.rejects(asRole("authenticated", admin, claimSql, [gmailKey, claim]), /permission/i);
    assert.equal((await asRole("service_role", null, claimSql, [gmailKey, claim]))[0].claimed, true);
    assert.equal((await asRole("service_role", null, claimSql, [gmailKey, randomUUID()]))[0].claimed, false);
    assert.equal((await asRole("service_role", null, gmailSql, [randomUUID(), ...gmailArgs.slice(1)]))[0].id, gmailKey, "Refresh retains uncertain Gmail send");
    await asRole("service_role", null, "select public.release_student_gmail_reminder($1,$2)", [gmailKey, randomUUID()]);
    assert.equal((await asRole("service_role", null, claimSql, [gmailKey, randomUUID()]))[0].claimed, false, "Wrong attempt cannot release a send");
    await asRole("service_role", null, "select public.release_student_gmail_reminder($1,$2)", [gmailKey, claim]);
    assert.equal((await asRole("service_role", null, claimSql, [gmailKey, claim]))[0].claimed, true);
    await asRole("service_role", null, "select public.complete_student_vip_reminder($1,'gmail-message-id')", [gmailKey]);
    assert.equal((await asRole("service_role", null, claimSql, [gmailKey, randomUUID()]))[0].claimed, false);
    assert.ok((await asRole("service_role", null, gmailSql, [randomUUID(), ...gmailArgs.slice(1)]))[0].accepted_at);
    await db.query("update public.student_stock_out_logs set status='rejected',processed_by=$1,processed_at=now() where id=$2", [admin, log]);
    await assert.rejects(prepare([randomUUID(), ...args.slice(1)]), /no longer waiting/i);
    assert.equal((await db.query<{ quantity: number }>("select quantity from public.items where id=$1", [item])).rows[0].quantity, 0);
    assert.equal((await db.query<{ count: number }>("select count(*)::int as count from public.transactions")).rows[0].count, 0);
  } finally { await db.close(); }
});
