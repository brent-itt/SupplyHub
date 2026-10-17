import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { analyticsWindow, movementTrend, readDashboardTransactions, stockHealth } from "../src/lib/dashboard-analytics";

test("analytics uses seven university calendar dates across UTC midnight and month boundaries", () => {
  const window = analyticsWindow(new Date("2026-02-28T16:05:00Z"));
  assert.deepEqual(window.days, ["2026-02-23", "2026-02-24", "2026-02-25", "2026-02-26", "2026-02-27", "2026-02-28", "2026-03-01"]);
  assert.equal(window.start, "2026-02-22T16:00:00.000Z");
  assert.equal(window.end, "2026-02-28T16:05:00.000Z");
});

test("stock categories are exclusive and exclude archived inventory", () => {
  const item = (quantity: number, low_stock_threshold: number, is_archived = false) => ({ quantity, low_stock_threshold, is_archived });
  assert.deepEqual(stockHealth([item(0, 0), item(5, 5), item(6, 5), item(0, 3, true)]), { healthy: 1, low: 1, out: 1 });
});

test("movement totals include zero days, distinguish adjustments, and bucket stock-out units positively", () => {
  const result = movementTrend(["2026-03-01", "2026-03-02"], [
    { created_at: "2026-02-28T16:00:00Z", kind: "stock_in", quantity_delta: 12 },
    { created_at: "2026-03-01T01:00:00Z", kind: "stock_out", quantity_delta: -3 },
    { created_at: "2026-03-01T03:00:00Z", kind: "adjustment", quantity_delta: -2 },
    { created_at: "2026-02-28T15:59:59Z", kind: "stock_in", quantity_delta: 999 },
  ]);
  assert.deepEqual(result, [
    { date: "2026-03-01", stockIn: 12, stockOut: 3, adjustments: 1, transactions: 3 },
    { date: "2026-03-02", stockIn: 0, stockOut: 0, adjustments: 0, transactions: 0 },
  ]);
});

test("every staff transaction page is scoped to the authenticated actor and excludes private ledger fields", async () => {
  const urls: URL[] = [];
  const client = createClient("https://analytics.example.test", "test-key", { auth: { persistSession: false }, global: { fetch: async input => {
    const url = new URL(String(input));
    urls.push(url);
    return new Response(JSON.stringify(Array.from({ length: urls.length === 1 ? 1000 : 1 }, (_, index) => ({ id: String(index) }))), { status: 200, headers: { "Content-Type": "application/json" } });
  } } });
  const rows = await readDashboardTransactions(client, { actorId: "staff-a" }, "2026-03-01T00:00:00Z", "2026-03-07T00:00:00Z");
  assert.equal(rows.length, 1001);
  assert.equal(urls.length, 2);
  for (const url of urls) {
    assert.equal(url.searchParams.get("actor_id"), "eq.staff-a");
    assert.deepEqual(url.searchParams.getAll("created_at"), ["gte.2026-03-01T00:00:00Z", "lte.2026-03-07T00:00:00Z"]);
    assert.ok(!/note|reference|email|\*/.test(url.searchParams.get("select")!));
    assert.equal(url.searchParams.get("order"), "created_at.desc,id.desc");
  }
  assert.equal(urls[1].searchParams.get("offset"), "1000");
});

test("authorized overall analytics has no actor filter and query failures never appear as zero activity", async () => {
  let fail = false;
  const client = createClient("https://analytics.example.test", "test-key", { auth: { persistSession: false }, global: { fetch: async input => {
    assert.equal(new URL(String(input)).searchParams.has("actor_id"), false);
    return new Response(JSON.stringify(fail ? { message: "Unavailable" } : []), { status: fail ? 403 : 200, headers: { "Content-Type": "application/json" } });
  } } });
  assert.deepEqual(await readDashboardTransactions(client, { all: true }, "2026-03-01", "2026-03-07"), []);
  fail = true;
  await assert.rejects(readDashboardTransactions(client, { all: true }, "2026-03-01", "2026-03-07"), /Unable to load/);
});
