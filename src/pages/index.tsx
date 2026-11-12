import Head from "next/head";
import Link from "next/link";
import { useWallet } from "@/components/WalletProvider";
import { isLiveMode, confidentialEnabled } from "@/core/settlement";

export default function Home() {
  const { account, connect, connecting } = useWallet();
  const live = isLiveMode();
  const conf = confidentialEnabled();

  return (
    <>
      <Head>
        <title>Veilroll — private payroll, auditable receipts</title>
      </Head>

      <section className="hero">
        <span className="pill priv" style={{ marginBottom: "0.9rem" }}>
          NEAR Confidential Intents
        </span>
        <h1>
          Pay your team across chains.
          <br />
          Prove it to your auditor, not the internet.
        </h1>
        <p className="muted" style={{ maxWidth: "62ch", fontSize: "1.02rem" }}>
          On-chain payroll publishes every salary and every route. Companies still owe auditors a
          record of what was paid. Veilroll runs a payroll batch through NEAR Intents, gives every
          payment its own encrypted receipt, and hands an auditor a scoped, expiring link that
          decrypts only what you chose — with an on-chain settlement reference they can check
          themselves.
        </p>

        <div className="row" style={{ marginTop: "1.5rem" }}>
          <Link href="/payroll" className="btn primary" style={{ padding: "0.6rem 1.1rem" }}>
            Start a payroll run
          </Link>
          {!account && (
            <button className="ghost" onClick={connect} disabled={connecting}>
              {connecting ? "Connecting…" : "Connect wallet"}
            </button>
          )}
          <Link href="/demo" className="btn ghost" style={{ padding: "0.6rem 1.1rem" }}>
            Judge? See the 60-second path
          </Link>
        </div>
      </section>

      {(!live || !conf) && (
        <div className={`notice ${!conf ? "warn" : ""}`} style={{ marginBottom: "1.5rem" }}>
          {!live ? (
            <>
              <b>Mock settlement mode.</b> No funds and no wallet transaction are needed. Quotes,
              receipts, shares and CSV export all work; the settlement checkbox is simulated so the
              failure and retry path is demoable. Set <span className="kbd">NEXT_PUBLIC_SETTLEMENT=oneclick</span>{" "}
              to use the live 1Click API.
            </>
          ) : (
            <>
              <b>Live mode, but no partner JWT.</b> Public quotes work. Confidential quotes
              (<span className="kbd">confidentiality: basic</span>) are rejected by 1Click with HTTP
              401 until you set <span className="kbd">INTENTS_API_KEY</span>. Veilroll will tell you
              that instead of failing silently.
            </>
          )}
        </div>
      )}

      <div className="grid-3" style={{ marginBottom: "1.5rem" }}>
        {[
          {
            t: "1 · Compose",
            d: "Recipient, amount, asset, destination chain. Each payment gets a confidential quote.",
          },
          {
            t: "2 · Settle",
            d: "You approve each payment in your wallet. One failure never rolls back the others.",
          },
          {
            t: "3 · Disclose",
            d: "Share one payment, a date range, or a whole run. Signed, expiring, decryptable only there.",
          },
        ].map((c) => (
          <div className="panel" key={c.t}>
            <h3>{c.t}</h3>
            <p className="muted small" style={{ margin: 0 }}>
              {c.d}
            </p>
          </div>
        ))}
      </div>

      <div className="panel">
        <h2>What NEAR does here</h2>
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>
            NEAR Intents turns <i>“pay this person 2,400 USDC on Arbitrum”</i> into an intent that
            solvers fill from any chain. With <span className="kbd">confidentiality: basic</span> the
            deposit and the withdrawal cannot be linked, so the public ledger shows that{" "}
            <i>something</i> moved without showing who was paid or from where. That is exactly the
            piece a payroll product needs and a public DEX swap cannot provide.
          </p>
          <div className="flow">
            <span className="step">Employer</span>
            <span>→</span>
            <span className="step">confidential quote (1Click)</span>
            <span>→</span>
            <span className="step">deposit on NEAR</span>
            <span>→</span>
            <span className="step">solver fills</span>
            <span>→</span>
            <span className="step">recipient paid on destination chain</span>
            <span>→</span>
            <span className="step">receipt · share · audit</span>
          </div>
        </div>
      </div>

      <div className="spacer" />
      <div className="notice">
        <b>Honest limits.</b> Intents has no testnet, so live mode costs real (tiny) mainnet
        amounts. The receipt, share and auditor layers are Veilroll&apos;s own implementation — NEAR
        Intents documents no developer-facing disclosure API. Scope is enforced by the signed share
        payload and the auditor UI, not by the ciphertext. This is a prototype, not audit or accounting
        software. <Link href="/demo">Details</Link>.
      </div>
    </>
  );
}
