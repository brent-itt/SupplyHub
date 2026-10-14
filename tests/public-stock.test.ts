import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { publicVisibilitySchema } from "../src/lib/validation";

test("public display requires an explicit nonnegative whole quantity", () => {
  const input = { item_id: randomUUID(), show_on_landing: "true", public_quantity: "12" };
  assert.equal(publicVisibilitySchema.parse(input).public_quantity, 12);
  assert.equal(publicVisibilitySchema.parse({ ...input, public_quantity: "0" }).public_quantity, 0);
  for (const value of [undefined, null, "", " ", "-1", "1.5", "2147483648", "NaN"]) {
    assert.equal(publicVisibilitySchema.safeParse({ ...input, public_quantity: value }).success, false);
  }
});

test("public quantities are private, capped, persistent, and independent of inventory", async () => {
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
    const admin = randomUUID(), superAdmin = randomUUID(), staff = randomUUID(), inactive = randomUUID();
    for (const [id, role] of [[admin, "admin"], [superAdmin, "super_admin"], [staff, "staff"], [inactive, "admin"]]) {
      await db.query("insert into auth.users(id) values ($1)", [id]);
      await db.query("update public.profiles set role=$1,is_active=$2 where id=$3", [role, id !== inactive, id]);
    }
    const item = randomUUID(), hidden = randomUUID(), archived = randomUUID();
    await db.query("insert into public.items(id,sku,name,quantity,show_on_landing,is_archived) values ($1,'PAPER','Paper',100,true,false),($2,'HIDDEN','Hidden',25,false,false),($3,'ARCHIVED','Archived',0,true,true)", [item, hidden, archived]);
    const migration = await readFile(new URL("../supabase/migrations/202610040007_public_display_quantity.sql", import.meta.url), "utf8");
    await db.exec(migration);

    async function asRole(role: "anon" | "authenticated", actor: string | null, sql: string, params: unknown[] = []) {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor ?? ""]);
      await db.exec(`set role ${role}`);
      try { return (await db.query<Record<string, unknown>>(sql, params)).rows; }
      finally { await db.exec("reset role"); }
    }
    const publicStock = () => asRole("anon", null, "select * from public.get_public_stock()");
    const save = (actor: string | null, amount: number | null, visible: boolean | null = true, id = item) =>
      asRole("authenticated", actor, "select public.set_item_public_visibility($1,$2,$3)", [id, visible, amount]);
    const record = async () => (await db.query<Record<string, unknown>>("select quantity,public_quantity,show_on_landing from public.items where id=$1", [item])).rows[0];
    assert.equal((await publicStock())[0].quantity, 100, "Upgrade preserves the current display");
    assert.equal((await publicStock()).length, 1, "Hidden and archived items are excluded");
    await save(admin, 12);
    assert.deepEqual(await record(), { quantity: 100, public_quantity: 12, show_on_landing: true });
    assert.deepEqual(await publicStock(), [{ id: item, name: "Paper", category: "General", unit: "piece", quantity: 12 }]);
    assert.equal((await db.query<{ count: number }>("select count(*)::int as count from public.transactions")).rows[0].count, 0);
    await assert.rejects(asRole("anon", null, "select quantity from public.items"), /permission/i);
    await assert.rejects(asRole("anon", null, "select * from public.items"), /permission/i);
    await assert.rejects(asRole("anon", null, "select public.set_item_public_visibility($1,true,99)", [item]), /permission/i);
    for (const actor of [null, staff, inactive]) await assert.rejects(save(actor, 99), /permission|sign in/i);
    for (const amount of [-1, null]) await assert.rejects(save(admin, amount), /nonnegative/i);
    await assert.rejects(save(admin, 12, null), /visibility/i);
    await assert.rejects(save(admin, 12, true, randomUUID()), /not found/i);
    await assert.rejects(asRole("authenticated", staff, "update public.items set public_quantity=99 where id=$1", [item]), /permission/i);
    await save(superAdmin, 0);
    assert.equal((await publicStock())[0].quantity, 0);
    assert.equal((await record()).quantity, 100);
    await save(admin, 12, false);
    assert.deepEqual(await publicStock(), []);
    await save(admin, 12);
    await asRole("authenticated", staff, "select public.stock_movement($1,'stock_out',95,'Issue supplies','',$2)", [item, randomUUID()]);
    assert.equal((await publicStock())[0].quantity, 5, "Public quantity cannot exceed actual stock");
    assert.equal((await record()).public_quantity, 12, "Issuance retains the chosen display limit");
    assert.equal((await asRole("authenticated", staff, "select quantity from public.items where id=$1", [item]))[0].quantity, 5);
    await asRole("authenticated", admin, "select public.stock_movement($1,'stock_in',20,'Receive supplies','',$2)", [item, randomUUID()]);
    assert.equal((await publicStock())[0].quantity, 12);
    await db.exec(migration);
    assert.equal((await record()).public_quantity, 12, "Rerunning the migration preserves saved limits");
    const newItem = await db.query<{ public_quantity: number }>("insert into public.items(sku,name) values ('NEW','New supply') returning public_quantity");
    assert.equal(newItem.rows[0].public_quantity, 0);
    await db.query("update public.items set category='Uniform' where id in ($1,$2,$3)", [item, hidden, archived]);
    await db.exec("update public.items set category='Paper products',quantity=3,public_quantity=2,show_on_landing=true where sku='NEW'");
    const uniformStock = await asRole("anon", null, "select * from public.get_public_stock() where category=$1", ["Uniform"]);
    assert.deepEqual(uniformStock, [{ id: item, name: "Paper", category: "Uniform", unit: "piece", quantity: 12 }], "Category pages exclude other categories, hidden supplies, and archived supplies while retaining capped quantities");
    assert.deepEqual(await asRole("anon", null, "select * from public.get_public_stock() where category=$1", ["Unknown"]), []);
  } finally { await db.close(); }
});
