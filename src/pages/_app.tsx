import "@/styles/globals.css";
import type { AppProps } from "next/app";
import Head from "next/head";
import { WalletProvider } from "@/components/WalletProvider";
import { TopBar } from "@/components/TopBar";
import { isLiveMode, confidentialEnabled } from "@/core/settlement";

export default function App({ Component, pageProps }: AppProps) {
  const mode = isLiveMode() ? "live" : "mock";
  const conf = confidentialEnabled();

  return (
    <>
      <Head>
        <title>Veilroll — private payroll with auditor receipts</title>
        <meta
          name="description"
          content="Pay a cross-chain payroll through NEAR Confidential Intents and share verifiable receipts with an auditor without publishing them."
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <WalletProvider>
        <TopBar />
        <main className="shell" style={{ paddingBottom: "4rem" }}>
          <Component {...pageProps} />
        </main>
        <footer className="shell" style={{ paddingBottom: "2rem" }}>
          <div className="row tiny dim" style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
            <span>Prototype — not compliance advice.</span>
            <span>·</span>
            <span>
              Settlement: <b>{mode}</b>
            </span>
            <span>·</span>
            <span>
              Confidential quotes:{" "}
              <b>{conf ? "available" : "need INTENTS_API_KEY"}</b>
            </span>
          </div>
        </footer>
      </WalletProvider>
    </>
  );
}
