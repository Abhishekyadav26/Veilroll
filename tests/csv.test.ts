import { test } from "node:test";
import assert from "node:assert/strict";
import { CSV_HEADER, receiptsToCsv } from "../src/core/csv.ts";
import type { Receipt } from "../src/core/types.ts";

function r(over: Partial<Receipt> = {}): Receipt {
  return {
    paymentId: "p1",
    runId: "run",
    recipient: "0xabc",
    assetId: "asset",
    symbol: "USDC",
    decimals: 6,
    amount: "1500000",
    chain: "arb",
    status: "settled",
    confidentiality: "basic",
    date: "2026-11-02T10:00:00.000Z",
    settlementReference: "0xtx",
    ...over,
  };
}

test("CSV has a header and CRLF endings", () => {
  const csv = receiptsToCsv([r()]);
  const lines = csv.split("\r\n");
  assert.equal(lines[0], CSV_HEADER.join(","));
  assert.ok(csv.endsWith("\r\n"));
});

test("CSV quotes fields containing commas, quotes or newlines", () => {
  const csv = receiptsToCsv([r({ note: undefined })]);
  assert.ok(!csv.includes('""'), "no stray quoting when unnecessary");

  const risky = receiptsToCsv([r({ recipient: 'a,b"c\nd' })]);
  assert.ok(risky.includes('"a,b""c\nd"'), "RFC 4180 escaping");
});

test("CSV uses each receipt's own decimals (18-decimal assets are not mis-scaled)", () => {
  const dai = r({ assetId: "dai", symbol: "DAI", decimals: 18, amount: "1500000000000000000" });
  const csv = receiptsToCsv([dai]);
  assert.ok(csv.includes("1.5"), "1.5 DAI, not 1.5e-12");
  assert.ok(!csv.includes("0.000000"), "must not truncate an 18-decimal amount to zero-ish");
});

test("CSV includes the decimal amount for the auditor", () => {
  const csv = receiptsToCsv([r()], { decimalsById: { asset: 6 } });
  assert.ok(csv.includes("1.5"), "human-readable amount present");
});

test("CSV handles missing settlement references without emitting 'undefined'", () => {
  const csv = receiptsToCsv([r({ settlementReference: undefined, explorerUrl: undefined })]);
  assert.ok(!csv.includes("undefined"));
});
