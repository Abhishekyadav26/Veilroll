# Demo script — 75 seconds

Zoom the browser to ~110% so the tables are legible. Close other tabs.
Mock mode (default). No funds, no wallet extension.

---

## 0:00 – 0:08 · The problem

**Say:** "Every on-chain payroll publishes every salary and every route. Companies won't do that.
But their auditor still needs a record. Veilroll pays privately through NEAR and hands the auditor
a scoped receipt."

**Show:** the landing page headline — *"Pay your team across chains. Prove it to your auditor, not
the internet."*

---

## 0:08 – 0:20 · Compose the run

`/payroll` → **Connect wallet** → **Use demo account (no wallet)**.

**Say:** "Three people, three assets, three chains. Each row gets its own confidential quote."

**Do:** click **Create run & quote**.

**Show:** rows transitioning — *Quoted* → *Settling* → *Settled, Settled, Failed*.

**Say:** "Each payment settles on its own. NEAR transactions don't roll back together, so one
failure doesn't undo the others."

---

## 0:20 – 0:28 · Retry

**Do:** click **Retry** on the failed row.

**Show:** it becomes *Settled*; receipts count → **3**.

**Say:** "That's the difference between a swap and payroll: per-payment state, and a retry path."

---

## 0:28 – 0:38 · Privacy, concretely

**Show:** point at the **confidential · basic / advanced** column.

**Say:** "These quotes go to NEAR Intents with `confidentiality: basic`. On the public ledger, the
deposit and the payout can't be linked — you see value moved, not who was paid or from where."

*(Optional, if you have live mode: show a public explorer and point out there's no visible link
from the employer's NEAR deposit to the Arbitrum payout.)*

---

## 0:38 – 0:52 · Create the auditor share

**Do:** **Create auditor share** → **One payment** → pick the second payment → **24 hours** →
**Sign & create link**.

**Say:** "The run key is wrapped with a fresh key for this share alone, and the scope and expiry are
signed by the employer's wallet — a NEP-413 message, no gas."

**Show:** the link ending in `#k=…`.

**Say:** "The key is in the URL fragment, which browsers never send to a server."

---

## 0:52 – 1:05 · Auditor opens it

**Do:** **Open as auditor** in a new tab.

**Show:** **1 receipt decrypted**, the scope label *Single payment*, the expiry, and the signature row.

**Say:** "They get exactly one payment. The other two recipients don't appear anywhere — not in the
table, not in the page source."

**Do:** click **Export CSV**.

**Show:** the downloaded CSV with a `settlement_reference` column.

**Say:** "That reference is what makes it auditable: they can re-check it on the destination chain."

---

## 1:05 – 1:15 · Negative cases (this is the proof)

**Do:** edit `expiresAt` in the link, or open `/auditor#k=garbage`.

**Show:** *"This auditor link expired…"* / *"Not a valid Veilroll share link."*

**Say:** "An expired or tampered link decrypts nothing. Expiry is inside the signed payload, so it
can't be edited."

---

## 1:15 · Close

**Say:** "Private payroll through NEAR Confidential Intents, with receipts a real auditor can check.
It's a prototype: Intents has no testnet, and the receipt layer is my own — NEAR doesn't document a
disclosure API. Repo and setup are in the README."

---

## Recording checklist

- [ ] `npm test` passes (30 tests) before recording
- [ ] Browser zoom readable; no dev-tools open
- [ ] One clean take of the run (mock is deterministic)
- [ ] Show the auditor tab's URL containing `#k=` at least once
- [ ] CSV download visible in the corner
- [ ] Post tags @NEARProtocol and #NEARHackathon, links the repo and demo
