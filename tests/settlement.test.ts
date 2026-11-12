/**
 * Tests the run pipeline without a browser: mock quote -> execute -> receipt,
 * including the scripted failure and the retry-then-succeed transition.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createMock } from "../src/core/settlement/index.ts";
import { buildReceipt } from "../src/core/receipts.ts";
import type { PayrollRun } from "../src/core/types.ts";

function intent(id: string, amount = "2400000") {
  return {
    id,
    originAsset: "nep141:usdc.near",
    destinationAsset: "nep141:arb-usdc.omft.near",
    amountIn: amount,
    recipient: "0xabc",
    refundTo: "acme.testnet",
    confidentiality: "basic" as const,
    dry: false,
  };
}

test("mock quote converts amount and returns a deposit address", async () => {
  const p = createMock();
  const q = await p.quote(intent("pay-1"));
  assert.equal(q.amountIn, "2400000");
  assert.equal(q.amountOut, "2390400", "0.996 conversion");
  assert.match(q.depositAddress ?? "", /^mock-deposit-/);
  assert.equal(q.snapshot.confidentiality, "basic");
});

test("dry quotes expose no deposit address, matching 1Click behaviour", async () => {
  const p = createMock();
  const q = await p.quote({ ...intent("pay-1"), dry: true });
  assert.equal(q.depositAddress, undefined);
});

test("successful payment walks PROCESSING then SUCCESS", async () => {
  const p = createMock();
  const i = intent("pay-ok");
  const q = await p.quote(i);
  const started = await p.execute(i, q);
  assert.equal(started.state, "PROCESSING");

  const polls = [await p.status(i.id), await p.status(i.id), await p.status(i.id)];
  assert.equal(polls[0].state, "PROCESSING");
  assert.equal(polls[1].state, "PROCESSING");
  assert.equal(polls[2].state, "SUCCESS");
  assert.ok(polls[2].destinationTxHash, "settlement reference present");
});

test("a scripted failure fails the first attempt, and retry recovers without touching others", async () => {
  const p = createMock();
  const bad = intent("pay-xf"); // ids ending in "f" are scripted to fail on attempt 1
  const good = intent("pay-ok");

  const qBad = await p.quote(bad);
  const qGood = await p.quote(good);
  const sBad = await p.execute(bad, qBad);
  const sGood = await p.execute(good, qGood);

  assert.equal(sBad.state, "FAILED");
  assert.equal(sGood.state, "PROCESSING");

  // The failure does not affect the healthy payment: it still settles.
  await p.status(good.id);
  await p.status(good.id);
  const settledGood = await p.status(good.id);
  assert.equal(settledGood.state, "SUCCESS");

  // The failed payment stays failed across polls (no silent auto-retry).
  assert.equal((await p.status(bad.id)).state, "FAILED");

  // An explicit retry succeeds.
  const reQuote = await p.quote(bad);
  const retried = await p.execute(bad, reQuote);
  assert.equal(retried.state, "PROCESSING");
  await p.status(bad.id);
  await p.status(bad.id);
  assert.equal((await p.status(bad.id)).state, "SUCCESS");
});

test("receipts are only built for settled payments", async () => {
  const p = createMock();
  const run: PayrollRun = {
    id: "run-t",
    employer: "acme.testnet",
    name: "t",
    createdAt: new Date().toISOString(),
    currency: "USD",
    payments: [],
    runKeyId: "k",
  };
  const i = intent("pay-r");
  const q = await p.quote(i);
  await p.execute(i, q);
  await p.status(i.id);
  await p.status(i.id);
  const st = await p.status(i.id);
  assert.equal(st.state, "SUCCESS");

  const receipt = buildReceipt(run, {
    id: i.id,
    recipient: i.recipient,
    assetId: i.destinationAsset,
    symbol: "USDC",
    amount: q.amountOut,
    decimals: 6,
    chain: "arb",
    status: "settled",
    confidentiality: "basic",
    createdAt: new Date().toISOString(),
    settlement: {
      quote: q.snapshot,
      state: st.state,
      destinationTxHash: st.destinationTxHash,
      amountOut: st.amountOut,
      settledAt: st.updatedAt,
    },
  });
  assert.equal(receipt.settlementReference, st.destinationTxHash);
  assert.equal(receipt.status, "settled");
});

test("mock verify is honest: method none, no fake chain check", async () => {
  const p = createMock();
  const v = await p.verify({
    paymentId: "x",
    runId: "r",
    recipient: "0x",
    assetId: "a",
    symbol: "USDC",
    decimals: 6,
    amount: "1",
    chain: "arb",
    status: "settled",
    confidentiality: "basic",
    date: new Date().toISOString(),
  });
  assert.equal(v.method, "none");
  assert.match(v.note ?? "", /no on-chain settlement to check/i);
});
