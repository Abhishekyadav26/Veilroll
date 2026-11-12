import { test } from "node:test";
import assert from "node:assert/strict";
import { generateAesKey } from "../src/core/crypto/aes.ts";
import { buildReceipt, decryptReceipts, encryptReceipts } from "../src/core/receipts.ts";
import type { Payment, PayrollRun, Receipt } from "../src/core/types.ts";

function makeRun(): PayrollRun {
  return {
    id: "run-1",
    employer: "acme.near",
    name: "October payroll",
    createdAt: "2026-11-01T10:00:00.000Z",
    currency: "USD",
    payments: [],
    runKeyId: "key-1",
  };
}

function makePayment(over: Partial<Payment> = {}): Payment {
  return {
    id: "pay-1",
    recipient: "0xabc",
    assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
    symbol: "USDC",
    amount: "2500000",
    decimals: 6,
    chain: "arb",
    status: "settled",
    confidentiality: "basic",
    createdAt: "2026-11-02T10:00:00.000Z",
    settlement: {
      destinationTxHash: "0xdeadbeef",
      amountOut: "2490000",
      settledAt: "2026-11-02T10:00:30.000Z",
      quote: {
        amountIn: "2500000",
        amountOut: "2490000",
        depositAddress: "0xdeposit",
        ownership: undefined,
        confidentiality: "basic",
        quotedAt: "2026-11-02T09:59:00.000Z",
      } as any,
    },
    ...over,
  } as Payment;
}

test("buildReceipt copies settlement details and prefers the realised amount", () => {
  const run = makeRun();
  const r = buildReceipt(run, makePayment());
  assert.equal(r.runId, "run-1");
  assert.equal(r.paymentId, "pay-1");
  assert.equal(r.amount, "2490000", "uses amount actually received, not the requested amount");
  assert.equal(r.settlementReference, "0xdeadbeef");
  assert.equal(r.settledAt, "2026-11-02T10:00:30.000Z");
  assert.equal(r.depositAddress, "0xdeposit");
  assert.equal(r.symbol, "USDC");
});

test("receipts encrypt/decrypt with the run key and fail with the wrong key", async () => {
  const run = makeRun();
  const receipts: Receipt[] = [buildReceipt(run, makePayment())];
  const key = await generateAesKey();
  const sealed = await encryptReceipts(receipts, key);

  const back = await decryptReceipts(sealed, key);
  assert.equal(back.length, 1);
  assert.equal(back[0].paymentId, "pay-1");

  const wrong = await generateAesKey();
  await assert.rejects(() => decryptReceipts(sealed, wrong));
});
