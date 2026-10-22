import assert from "node:assert/strict";
import test from "node:test";
import { reportDateRange } from "../src/lib/report-dates";

test("reports include a complete Philippine calendar day across UTC midnight", () => {
  const range = reportDateRange("2026-10-19", "2026-10-19");
  assert.equal(range.start, "2026-10-18T16:00:00.000Z");
  assert.equal(range.end, "2026-10-19T15:59:59.999Z");
  for (const [timestamp, expected] of [
    ["2026-10-18T15:59:59.999Z", false],
    ["2026-10-18T16:00:00.000Z", true],
    ["2026-10-19T15:59:59.999Z", true],
    ["2026-10-19T16:00:00.000Z", false],
  ] as const) {
    assert.equal(timestamp >= range.start && timestamp <= range.end, expected);
  }
});

test("default reports cover 30 university calendar days regardless of server timezone", () => {
  const range = reportDateRange(undefined, null, new Date("2026-12-31T16:30:00Z"));
  assert.equal(range.from, "2026-12-03");
  assert.equal(range.to, "2027-01-01");
});

test("report dates reject impossible dates and reversed periods", () => {
  for (const invalid of ["2026-02-30", "2026-02-29", "0000-01-01", "2026-13-01", ["2026-10-19"]]) {
    assert.throws(() => reportDateRange(invalid, "2026-10-19"), RangeError);
    assert.throws(() => reportDateRange("2026-10-19", invalid), RangeError);
  }
  assert.throws(() => reportDateRange("2026-10-20", "2026-10-19"), /From date/);
  assert.equal(reportDateRange("2028-02-29", "2028-02-29").from, "2028-02-29");
});
