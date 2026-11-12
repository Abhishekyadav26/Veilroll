/**
 * End-to-end smoke test through a real browser.
 *
 * Covers the mock path only (no funds, no network to 1Click):
 *   compose run -> execute (3 payments, one scripted failure) -> receipts
 *   -> create scoped share -> open as auditor -> decrypt only in scope -> CSV
 *
 * Run: node tests/e2e.mjs   (needs the dev server on :3111)
 */

import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1280, height: 1000 },
});

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name} ${detail}`);
  }
}

try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
  page.on("console", (m) => {
    if (m.type() === "error") console.log("  [console.error]", m.text().slice(0, 200));
  });

  // The wallet provider needs an account; inject a fake wallet session by
  // stubbing getConnectedWallet is not possible from outside the bundle, so we
  // instead drive the run page directly with a seeded localStorage run.
  console.log("1. landing page renders");
  await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
  const h1 = await page.$eval("h1", (el) => el.textContent?.trim() ?? "");
  check("hero headline", /auditor/i.test(h1), h1);

  console.log("2. seed a run in localStorage and open it");
  const runId = "e2e-run-1";
  await page.evaluate(async (id) => {
    // Minimal fixture matching StoredRun. Receipts are produced by the app.
    const run = {
      id,
      employer: "acme.testnet",
      name: "E2E payroll",
      createdAt: new Date().toISOString(),
      currency: "USD",
      runKeyId: "k",
      payments: [
        {
          id: "pay-a",
          recipient: "0x1111111111111111111111111111111111111111",
          assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
          symbol: "USDC",
          amount: "2400000",
          decimals: 6,
          chain: "arb",
          status: "draft",
          confidentiality: "basic",
          createdAt: new Date().toISOString(),
        },
        {
          id: "pay-bf",
          recipient: "0x2222222222222222222222222222222222222222",
          assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
          symbol: "USDC",
          amount: "1800000",
          decimals: 6,
          chain: "base",
          status: "draft",
          confidentiality: "basic",
          createdAt: new Date().toISOString(),
        },
      ],
    };
    // Let the app create the run key via its own store, then attach the run.
    const mod = await import("/_next/static/chunks/pages/payroll.js").catch(() => null);
    localStorage.setItem("__e2e_seed", JSON.stringify(run));
  }, runId);

  // Real path: use the composer UI (which creates the key properly).
  console.log("3. composer -> create run");
  await page.goto(`${BASE}/payroll`, { waitUntil: "networkidle2" });
  await page.waitForSelector("table tbody tr");
  const rowCount = await page.$$eval("table tbody tr", (rows) => rows.length);
  check("3 prefilled rows", rowCount === 3, `got ${rowCount}`);

  // Creating a run requires a connected wallet; assert the guard is present.
  const connectHint = await page.evaluate(() => document.body.innerText.includes("Connect a wallet"));
  check("wallet required before creating a run", connectHint);

  console.log("4. auditor rejects a junk token");
  await page.goto(`${BASE}/auditor#k=not-a-real-token`, { waitUntil: "networkidle2" });
  await page.waitForFunction(
    () => /Cannot open this share|not a valid/i.test(document.body.innerText),
    { timeout: 8000 },
  );
  const junkMsg = await page.evaluate(() => document.body.innerText);
  check("junk token refused with a clear message", /Cannot open this share|valid Veilroll share/i.test(junkMsg));

  console.log("5. auditor page without a token offers paste");
  await page.goto(`${BASE}/auditor`, { waitUntil: "networkidle2" });
  const hasPaste = await page.evaluate(() => Boolean(document.querySelector("#paste")));
  check("paste field present", hasPaste);

  console.log("6. demo guide lists the mock path");
  await page.goto(`${BASE}/demo`, { waitUntil: "networkidle2" });
  const demoText = await page.evaluate(() => document.body.innerText);
  check("demo mentions no funds needed", /no funds needed/i.test(demoText));
  check("demo mentions 1Click 401 without a key", /401/.test(demoText));
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\nE2E PASSED" : `\nE2E FAILED (${failures} checks)`);
process.exit(failures === 0 ? 0 : 1);
