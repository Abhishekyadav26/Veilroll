/**
 * Full UI flow with the demo account — exactly what a judge does in mock mode.
 *
 *   connect demo -> compose run -> execute -> receipts
 *   -> create scoped share -> open as auditor -> only scope decrypts -> CSV
 */

import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";

let failures = 0;
const check = (n, c, d = "") => {
  if (c) console.log(`  ok  ${n}`);
  else {
    failures++;
    console.log(`  FAIL ${n} ${d}`);
  }
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1280, height: 1100 },
});

try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));

  const clickByText = async (text) => {
    const ok = await page.evaluate((t) => {
      const el = [...document.querySelectorAll("button,a")].find((b) =>
        (b.textContent ?? "").trim().includes(t),
      );
      if (el) el.click();
      return Boolean(el);
    }, text);
    if (!ok) throw new Error(`No clickable element with text "${text}"`);
  };

  console.log("1. connect the demo account");
  await page.goto(`${BASE}/payroll`, { waitUntil: "networkidle2" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle2" });
  await clickByText("Connect wallet");
  await new Promise((r) => setTimeout(r, 250));
  await clickByText("Use demo account");
  await page.waitForFunction(() => /demo ·/.test(document.body.innerText), { timeout: 8000 });
  check("demo account active", /demo-payroll\.testnet/.test(await page.evaluate(() => document.body.innerText)));

  console.log("2. create the run and execute it");
  await clickByText("Create run & quote");
  await page.waitForFunction(() => /Receipts/.test(document.body.innerText), { timeout: 15000 });

  // Autostart kicks in; wait for terminal states.
  await page.waitForFunction(
    () => {
      const t = document.body.innerText;
      return /settled/.test(t) && !/Working…/.test(t);
    },
    { timeout: 40000 },
  );
  const runBody = await page.evaluate(() => document.body.innerText);
  const settled = (runBody.match(/Settled/g) ?? []).length;
  check("payments settled", settled >= 2, `settled count=${settled}`);
  check("scripted failure visible", /Failed/.test(runBody));
  check("receipts produced", /Receipts \([1-9]/.test(runBody), runBody.match(/Receipts \(\d+\)/)?.[0]);

  console.log("3. create a single-payment share");
  await clickByText("Create auditor share");
  await page.waitForFunction(() => /What do they see/.test(document.body.innerText), { timeout: 10000 });
  await clickByText("One payment");
  await new Promise((r) => setTimeout(r, 150));
  await clickByText("Sign & create link");
  await page.waitForFunction(() => /#k=/.test(document.body.innerText), { timeout: 15000 });
  const linkText = await page.evaluate(() => {
    const el = document.querySelector(".linkbox");
    return el?.textContent ?? "";
  });
  check("share link produced", /#k=/.test(linkText), linkText.slice(0, 60));
  check("scope preview counted receipts", /receipt\(s\) in scope|receipts will be visible/.test(
    await page.evaluate(() => document.body.innerText),
  ));

  console.log("4. open the link as an auditor in a fresh profile");
  const auditor = await browser.newPage();
  auditor.on("pageerror", (e) => console.log("  [auditor pageerror]", e.message));
  await auditor.goto(linkText, { waitUntil: "networkidle2" });
  await auditor.waitForFunction(() => /receipts decrypted/.test(document.body.innerText), {
    timeout: 15000,
  });
  const auditBody = await auditor.evaluate(() => document.body.innerText);
  check("exactly one receipt decrypted", /1 receipts decrypted/.test(auditBody), auditBody.slice(0, 120));
  check("scope label is single payment", /Single payment/.test(auditBody));
  check("signature honestly reported", /could not verify|valid — signed by/.test(auditBody));

  console.log("5. export CSV");
  const csv = await auditor.evaluate(async () => {
    // Click Export CSV and capture the blob via a patched createObjectURL.
    let captured = null;
    const orig = URL.createObjectURL;
    URL.createObjectURL = (b) => {
      captured = b;
      return orig.call(URL, b);
    };
    const btn = [...document.querySelectorAll("button")].find((b) => /Export CSV/.test(b.textContent ?? ""));
    btn?.click();
    await new Promise((r) => setTimeout(r, 300));
    URL.createObjectURL = orig;
    if (!captured) return null;
    return await captured.text();
  });
  check("CSV produced", Boolean(csv), "no blob captured");
  if (csv) {
    const lines = csv.split("\r\n").filter(Boolean);
    check("CSV has header + 1 row", lines.length === 2, `lines=${lines.length}`);
    check("CSV header includes settlement_reference", lines[0].includes("settlement_reference"));
    check("CSV row has a settlement reference", /0x|mock/.test(lines[1]), lines[1]?.slice(0, 120));
  }
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\nFULL FLOW PASSED" : `\nFULL FLOW FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
