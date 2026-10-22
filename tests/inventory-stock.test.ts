import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { loadInventoryVipNeeds, newCustomerStock } from "../src/lib/inventory-stock";

function client(fetch: typeof globalThis.fetch) {
  return createClient("https://inventory.example.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
}

test("inventory totals all VIP balance pages and only requests the displayed items", async () => {
  const offsets: number[] = [];
  const supabase = client(async (input) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/rest/v1/student_vip_queue");
    assert.equal(url.searchParams.get("select"), "item_id,remaining_quantity");
    assert.equal(url.searchParams.get("item_id"), "in.(item-a,item-b)");
    assert.equal(url.searchParams.get("order"), "id.asc");
    assert.equal(url.searchParams.get("limit"), "500");
    const offset = Number(url.searchParams.get("offset"));
    offsets.push(offset);
    return Response.json(offset < 1000
      ? Array.from({ length: 500 }, () => ({ item_id: "item-a", remaining_quantity: 2 }))
      : [{ item_id: "item-a", remaining_quantity: 7 }, { item_id: "item-b", remaining_quantity: 3 }]);
  });
  const needs = await loadInventoryVipNeeds(supabase, ["item-a", "item-b"]);
  assert.deepEqual(offsets, [0, 500, 1000]);
  assert.deepEqual(needs, new Map([["item-a", 2007], ["item-b", 3]]));
});

test("failed later queue pages discard partial totals instead of overstating availability", async () => {
  const supabase = client(async (input) => {
    const offset = Number(new URL(String(input)).searchParams.get("offset"));
    return offset === 0
      ? Response.json(Array.from({ length: 500 }, () => ({ item_id: "item-a", remaining_quantity: 1 })))
      : Response.json({ code: "42501", message: "Permission denied" }, { status: 403 });
  });
  assert.equal(await loadInventoryVipNeeds(supabase, ["item-a"]), null);
});

test("items without VIP requests have no reserved demand; an empty inventory skips querying", async () => {
  const supabase = client(async () => Response.json([]));
  assert.deepEqual(await loadInventoryVipNeeds(supabase, ["item-a"]), new Map());
  assert.deepEqual(await loadInventoryVipNeeds(client(async () => { throw new Error("Unexpected query"); }), []), new Map());
});

test("new customer stock accounts for VIP balances without going negative", () => {
  assert.equal(newCustomerStock(67, 20), 47);
  assert.equal(newCustomerStock(67, 0), 67);
  assert.equal(newCustomerStock(20, 20), 0);
  assert.equal(newCustomerStock(5, 20), 0);
  assert.equal(newCustomerStock(0, 20), 0);
});
