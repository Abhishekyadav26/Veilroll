# Veilroll

Private payroll with auditor receipts, settled across chains through NEAR Confidential Intents.

Run a payroll batch of several recipients on different chains, get a per-payment encrypted
receipt for each one, and hand an auditor a scoped, expiring link that decrypts only the
payments you chose — with an on-chain settlement reference they can check themselves.

Built at NEAR HACKATHON (2026-11-01 → 2026-11-14). Tracks: **realworld** (primary), **privacy**.

---

## The problem

On-chain payroll publishes everything. If a company pays salaries in stablecoins, the public
ledger shows every amount, every recipient and every funding route. That is unacceptable for
real payroll, so companies don't do it on-chain — and then they have no verifiable record.

The other half of the problem is the audit. A company's auditor needs a defensible record of
what was paid to whom. A DEX swap is not accounting: it leaves no per-payment receipt, no
refund path, no export, and nothing you can hand to a third party.

## What Veilroll does

1. **Employer enters a payroll run** — recipient, amount, asset, destination chain, per row.
2. **Each payment is quoted** through the NEAR Intents 1Click Swap API with
   `confidentiality: "basic"` (or `"advanced"`). Confidential Intents means the deposit and the
   withdrawal cannot be linked to each other, so the public ledger shows that value moved
   without showing who was paid or from where.
3. **Each payment produces a receipt**: payment id, amount, asset, date, status
   (pending / settled / failed), settlement reference. Receipts are encrypted with a per-run
   AES-GCM key.
4. **The employer creates a scoped auditor share**: one payment, a date range, or the whole run,
   with an expiry. The run key is wrapped separately for each share (AES-KW), and the share
   payload is signed with NEP‑413 by the employer's wallet.
5. **The auditor opens the link**, which decrypts only the shared receipts in this browser tab,
   re-checks the employer's signature, can check settlement, and exports a CSV.

## How NEAR fits in

- **NEAR Intents** turns *"pay this person 2,400 USDC on Arbitrum"* into an intent that solvers
  fill from any chain, so one payroll can pay out on NEAR, Ethereum, Arbitrum, Base and Solana
  without the employer holding gas on each.
- **Confidential Intents** (`confidentiality: basic | advanced` on the quote endpoint) is the
  piece a public swap cannot provide: origin and destination are unlinkable. That is what makes
  private payroll possible at all.
- **NEAR accounts and NEP‑413** give the disclosure a signature that anyone can verify against
  the employer's on-chain access keys using standard `near-api-js` tooling.
- **Wallet approval per payment** follows NEAR's transaction model: `signAndSendTransactions`
  runs transactions independently, so one failed payment does not roll back the others. Veilroll
  models that with a per-payment state machine and a retry path.

## Verified facts (and what I could not confirm)

Checked against <https://docs.near-intents.org/> on 2026‑11‑12:

| Claim | Status |
| --- | --- |
| `confidentiality: "public" \| "basic" \| "advanced"` exists on `POST /v0/quote` | **Confirmed** — [Confidential Swaps](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/confidential-swaps.md) + the `QuoteRequest` schema in the API reference |
| Confidential quotes work without credentials | **No** — a live call returned `401 "User authentication is required for confidential intent quotes"`. A partner JWT (`INTENTS_API_KEY`) is required. Veilroll surfaces that message in the UI instead of failing silently. |
| Public quotes work unauthenticated | **Confirmed** — live dry quote returned 200 (1.0 USDC → 0.994498 USDC on Arbitrum, 19 s estimate) |
| API base is `https://1click.chaindefuser.com/v0` and sends `access-control-allow-origin: *` | **Confirmed** by live calls |
| `GET /v0/status?depositAddress=` returns `PENDING_DEPOSIT`…`SUCCESS`/`REFUNDED`/`FAILED` | **Confirmed** in the API reference |
| Intents has a testnet | **No** — none exists or is planned (hackathon Q‑007). Live mode costs real mainnet money. |

**Not found, and therefore not implemented:** I found no documented developer-facing *disclosure*
or *receipt* API in NEAR Intents. The receipt, encryption, share and auditor layers are
Veilroll's own implementation. There is no NEAR contract address claimed anywhere in this repo.

## Runs without funds (judges: start here)

```bash
npm install
npm run dev          # http://localhost:3000
```

Default mode is **mock settlement**: same UI, same crypto, no wallet transaction, no network
call to 1Click. Then:

1. Open `/payroll` → **Connect wallet** → **Use demo account (no wallet)**.
2. Click **Create run & quote**. **See:** three rows reach *Settled*, *Settled*, *Failed*.
   (Mock rule: a recipient address ending in `0` is scripted to fail on the first attempt, so
   the retry path is demoable.)
3. Click **Retry** on the failed row. **See:** it settles and the receipts count goes to 3.
4. Click **Create auditor share** → choose **One payment** → **Sign & create link**.
   **See:** a link ending in `#k=…`.
5. Click **Open as auditor**. **See:** exactly **1 receipt decrypted**; the other two recipients
   do not appear anywhere on the page.
6. Click **Export CSV**. **See:** a CSV with one data row and a `settlement_reference` column.

Verify the negative cases:

- Create a share with **Expires in: 1 hour**, wait, or hand-edit `expiresAt` in the fragment →
  **See:** "This auditor link expired…" and **nothing decrypted**.
- Open `/auditor#k=garbage` → **See:** "Not a valid Veilroll share link."

Run the test suites:

```bash
npm test                                        # 30 unit tests: money, crypto, scope, CSV, settlement
node tests/e2e.mjs                              # static/route smoke test (needs dev server + Chrome)
node --experimental-strip-types tests/integration.mjs  # real browser: scoped decryption, expiry, no leakage
node tests/flow.mjs                             # full demo flow through the UI
```

### Screenshots

`.shots/` holds a captured run of the demo: the composer, a live run mid-payout, the finished
run with receipts, the share page, and the auditor view.

## Live mode (real quotes, real money)

```bash
# .env.local
NEXT_PUBLIC_SETTLEMENT=oneclick
INTENTS_API_KEY=<partner JWT from https://partners.near-intents.org>   # only needed for confidential
NEXT_PUBLIC_NEAR_NETWORK=mainnet
```

- **Public** quotes and the tokens list work without `INTENTS_API_KEY`.
- **Confidential** quotes (`basic` / `advanced`) return `401` without it. The app says so
  explicitly; it does not pretend to have quoted.
- Start with **Dry run** ticked on `/payroll`: quotes are real, and no deposit address is issued,
  so nothing can settle.
- **Live deposit signing is deliberately not wired to a funded account in this build.** The
  confirm dialog in `src/pages/run/[runId].tsx` (`approve`) refuses and explains why. Wiring it
  means calling `wallet.signAndSendTransaction` to transfer the origin asset to the quoted
  `depositAddress`. I did not leave a hidden path that spends money, and there is no function-call
  key anywhere in this app — every payment would require real wallet approval.

## Architecture

```
src/core/                      pure TypeScript, no React, unit-tested
  types.ts                     domain types (PayrollRun, Payment, Receipt, AuditorShare…)
  money.ts                     bigint amounts; never floats for balances
  csv.ts                       RFC 4180 CSV export
  receipts.ts                  build / encrypt / decrypt receipts
  share.ts                     scoped shares, AES-KW wrapping, URL-fragment tokens
  crypto/{aes,bytes}.ts        WebCrypto only: AES-GCM + AES-KW, no custom primitives
  settlement/                  SettlementProvider interface
    mock.ts                    deterministic, offline, scripted failure
    oneclick.ts                live 1Click adapter
    index.ts                   provider selection from env
src/lib/
  near.ts                      near-connect wallet + JsonRpcProvider reads
  nep413.ts                    NEP-413 verification of a share
  store.ts                     localStorage runs, receipts encrypted at rest
  demoWallet.ts                labelled demo account for mock mode
src/pages/api/quote.ts         server proxy: the JWT never reaches the browser
src/pages/api/status.ts        server proxy for settlement status
```

**The settlement interface** (`src/core/settlement/SettlementProvider.ts`) is the seam that makes
the demo work without funds: `quote`, `execute`, `status`, `verify`, plus a description of the
run's `capabilities`. Mock and live both implement it, so every screen is identical in both modes.

**Encryption model**

- One random AES-GCM-256 key per run encrypts the receipt list.
- Each auditor share generates a fresh AES-KW-256 key, wraps the run key with it, and carries the
  wrapping key in the link. One share can be revoked (just stop handing out the link) without
  touching any other share's key material.
- The share payload — employer, run id, scope, expiry, wrapped key — is signed with NEP‑413.
  The auditor verifies it with `near-api-js` `verifyMessage`, which confirms the signature **and**
  that the signing key belongs to the employer's account.
- The share travels in the URL **fragment** (`#k=…`), which browsers never send to a server, so
  the hosting app never sees the key.

## Stack

| Library | Version | Use |
| --- | --- | --- |
| `next` | 15.5 | Pages-router app (`create-near-app` "Web Application / Next.js Classic" shape) |
| `react` / `react-dom` | 18.3 | UI |
| `@hot-labs/near-connect` | 0.12.0 | Wallet connection + `signMessage` (NEP‑413) + `signAndSendTransactions` |
| `near-api-js` | 7.5.3 | `JsonRpcProvider` reads and `nep413` verification |
| WebCrypto | platform | AES‑GCM, AES‑KW, `randomUUID` |
| NEAR Intents 1Click | REST | `POST /v0/quote`, `GET /v0/status`, `GET /v0/tokens` |

Deliberately **not** used: `@near-wallet-selector/*` (deprecated), any custom crypto primitive,
any function-call key for money movement.

### AI-assisted code

This project was built with an AI coding agent (Particle-1) working alongside the human author.
The agent wrote the application code, tests and this README, and verified NEAR Intents endpoint
behaviour by calling the live API. All API facts in the table above were checked against
`docs.near-intents.org` and live responses rather than taken from memory. Test suites and
screenshots in `.shots/` were run against the code as committed.

## Honest limitations

- **No testnet for Intents.** Live confidential settlement can only be exercised with real mainnet
  funds. Mock mode exists so the product is demonstrable without them; it is clearly labelled and
  its `verify()` returns `method: "none"` instead of faking a chain check.
- **Scope is enforced by the signed payload and the auditor UI, not by the ciphertext.** The
  shared run key can decrypt the whole receipts blob; the auditor page decrypts only in-scope
  receipts and the signed payload says which those are. Proper cryptographic scoping would mean
  per-payment keys wrapped per share — a good next step, not something I claim to have done.
- **Runs live in `localStorage`.** There is no backend and no database. Receipts are AES-GCM
  encrypted at rest under a device key, but clearing site data loses the runs. A share link is
  self-contained precisely so an auditor never needs the employer's browser.
- **The demo account has no private key.** Shares signed in demo mode show as "could not verify"
  on the auditor page. That is the honest outcome; a real wallet signature verifies.
- **Not compliance, tax or audit advice.** This is a prototype.
- **Intents' private layer runs on a small permissioned validator set** — a trust assumption you
  should state to an auditor rather than hide.

## License

MIT — see [LICENSE](./LICENSE).
