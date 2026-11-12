import { test } from "node:test";
import assert from "node:assert/strict";
import { formatUnits, parseUnits, sumAmounts, toUsd } from "../src/core/money.ts";

test("formatUnits trims and respects decimals", () => {
  assert.equal(formatUnits("1000000", 6), "1");
  assert.equal(formatUnits("1500000", 6), "1.5");
  assert.equal(formatUnits("1", 6), "0.000001");
  assert.equal(formatUnits(0n, 6), "0");
  assert.equal(formatUnits("1234567890123456789012", 18, 4), "1234.5678");
  assert.equal(formatUnits("-1500000", 6), "-1.5");
});

test("parseUnits round-trips and rejects bad input", () => {
  assert.equal(parseUnits("1.5", 6), 1_500_000n);
  assert.equal(parseUnits("1", 6), 1_000_000n);
  assert.equal(parseUnits(".5", 6), 500_000n);
  assert.throws(() => parseUnits("1.1234567", 6), /Too many decimal places/);
  assert.throws(() => parseUnits("abc", 6), /Invalid amount/);
  assert.throws(() => parseUnits("", 6), /Invalid amount/);
});

test("sumAmounts adds smallest units without float error", () => {
  assert.equal(sumAmounts(["1", "2", "3"]), "6");
  assert.equal(sumAmounts(["1000000000000000000", "1"]), "1000000000000000001");
});

test("toUsd is approximate and finite", () => {
  assert.equal(toUsd("2000000", 6, 1), "2.00");
  assert.equal(toUsd("1000000", 6, 0.5), "0.50");
});
