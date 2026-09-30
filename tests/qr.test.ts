import assert from "node:assert/strict";
import test from "node:test";
import { buildItemCode, parseItemCode } from "../src/lib/qr";

const id = "78aab2ce-f753-4fa5-83a6-04a9c4551e31";

test("generated item codes round trip to the same item UUID", () => {
  const code = buildItemCode(id);
  assert.equal(code, `supalies:item:${id}`);
  assert.equal(parseItemCode(code), id);
});

test("manual UUIDs and surrounding whitespace are accepted and normalized", () => {
  assert.equal(parseItemCode(`  ${id.toUpperCase()}\n`), id);
  assert.equal(parseItemCode(`\n${buildItemCode(id)}  `), id);
  assert.equal(buildItemCode(id.toUpperCase()), buildItemCode(id));
});

test("malformed prefixes and nested payloads are rejected", () => {
  for (const value of [
    `supalies:${id}`,
    `supalies:item${id}`,
    `supalies:item: ${id}`,
    `Supalies:item:${id}`,
    `supalies:item:supalies:item:${id}`,
    `supalies:item:${id}:extra`,
  ]) {
    assert.equal(parseItemCode(value), null, value);
  }
});

test("URLs and executable payloads cannot become navigation targets", () => {
  for (const value of [
    `https://example.com/inventory/${id}`,
    `/inventory/${id}`,
    `//example.com/${id}`,
    "javascript:alert(1)",
    `supalies:item:${id}?movement=stock_out`,
    `supalies:item:${id}/../../admin`,
  ]) {
    assert.equal(parseItemCode(value), null, value);
  }
});

test("empty, incomplete, and invalid UUID values are rejected", () => {
  for (const value of [
    "",
    " \n ",
    "supalies:item:",
    "not-a-uuid",
    id.slice(0, -1),
    id.replace("78aa", "78ag"),
    id.replace("4fa5", "0fa5"),
    id.replace("83a6", "73a6"),
    "00000000-0000-0000-0000-000000000000",
  ]) {
    assert.equal(parseItemCode(value), null, value);
    assert.throws(() => buildItemCode(value), /valid item UUID/);
  }
});
