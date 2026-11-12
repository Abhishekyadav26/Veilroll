import Head from "next/head";
import Link from "next/link";

export default function DemoPage() {
  return (
    <>
      <Head>
        <title>Demo guide — Veilroll</title>
      </Head>

      <h1 style={{ marginTop: "2rem" }}>Try it in 60 seconds (no funds needed)</h1>
      <p className="muted" style={{ maxWidth: "62ch" }}>
        Default mode is <b>mock settlement</b>: identical UI, identical crypto, no wallet transaction
        and no network call to 1Click. Every step below works offline.
      </p>

      <div className="panel" style={{ marginBottom: "1rem" }}>
        <h2>Mock path — do this, see that</h2>
        <table>
          <tbody>
            <Step n="1" do="Open /payroll. Connect a wallet (testnet is fine; nothing is spent)." see="Your account id appears in the top bar." />
            <Step n="2" do="Click “Create run & quote” with the 3 prefilled rows." see="You land on the run page and all 3 rows reach Quoted then Settled." />
            <Step n="3" do="Note the third row." see="It is scripted to fail (ids ending in “f” fail), so you can press Retry on that row alone." />
            <Step n="4" do="Open the Receipts panel, click “Create auditor share”." see="The share page shows how many receipts fall in scope." />
            <Step n="5" do="Pick “One payment”, choose 24 hours, click “Sign & create link”." see="The wallet asks you to sign a message (NEP-413) — no gas, no transaction. A link appears." />
            <Step n="6" do="Click “Open as auditor”." see="Only that one receipt decrypts. The other two never appear." />
            <Step n="7" do="Click “Export CSV”." see="A CSV with that single receipt downloads." />
            <Step n="8" do="Go back and create a share with “Expires in: 1 hour”, then edit the link's expiry… " see="fails: the expiry is inside the signed payload and the audit page refuses an expired share before decrypting anything." />
          </tbody>
        </table>
      </div>

      <div className="panel" style={{ marginBottom: "1rem" }}>
        <h2>Live path (costs real, tiny amounts)</h2>
        <p className="small muted">
          NEAR Intents has no testnet. To use live quotes:
        </p>
        <ol className="small muted" style={{ paddingLeft: "1.2rem" }}>
          <li>
            Put <span className="kbd">NEXT_PUBLIC_SETTLEMENT=oneclick</span> in <span className="kbd">.env.local</span>.
          </li>
          <li>
            For confidential quotes also set <span className="kbd">INTENTS_API_KEY</span> to a partner JWT from{" "}
            <a href="https://partners.near-intents.org" target="_blank" rel="noreferrer">
              partners.near-intents.org
            </a>
            . Without it, 1Click answers <span className="kbd">401</span> and Veilroll says so on screen.
          </li>
          <li>Tick “Dry run” first: quotes are real, deposits are impossible.</li>
          <li>
            Only then, from a separate dev account holding a few dollars, let a deposit go through. Live
            deposit signing is intentionally not wired to a funded account in this build — see the README.
          </li>
        </ol>
      </div>

      <div className="panel">
        <h2>What is provably true here</h2>
        <ul className="small muted" style={{ paddingLeft: "1.2rem", margin: 0 }}>
          <li>Receipts are AES-GCM encrypted under a per-run key; the run key is wrapped per share with AES-KW.</li>
          <li>Each share wraps the run key separately, so one share can be revoked without touching others.</li>
          <li>The share payload (employer, run, scope, expiry, wrapped key) is signed with NEP-413 and verified with <code>near-api-js verifyMessage</code>.</li>
          <li>No key material is ever sent to a server: it lives in the URL fragment.</li>
          <li>Scope is enforced by the signed payload and the auditor UI, <b>not</b> by the ciphertext — the shared run key can decrypt the whole blob. Stated plainly in the README.</li>
        </ul>
      </div>

      <p className="small muted" style={{ marginTop: "1.5rem" }}>
        <Link href="/payroll">Start the demo →</Link>
      </p>
    </>
  );
}

function Step({ n, do: action, see }: { n: string; do: string; see: string }) {
  return (
    <tr>
      <td style={{ width: "2rem" }} className="mono dim">{n}</td>
      <td className="small" style={{ width: "52%" }}>{action}</td>
      <td className="small muted">{see}</td>
    </tr>
  );
}
