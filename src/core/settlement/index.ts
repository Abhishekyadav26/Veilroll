/**
 * Provider selection. Mock by default so the app works with no funds and no
 * credentials; live 1Click when NEXT_PUBLIC_SETTLEMENT=oneclick.
 */

import type { SettlementProvider } from "./SettlementProvider.ts";
import { MockSettlementProvider } from "./mock.ts";
import { OneClickProvider } from "./oneclick.ts";

let cached: SettlementProvider | null = null;

export function isLiveMode(): boolean {
  return (process.env.NEXT_PUBLIC_SETTLEMENT ?? "mock").toLowerCase() === "oneclick";
}

/** True when the server has a partner JWT, so confidential quotes can work. */
export function confidentialEnabled(): boolean {
  return Boolean(process.env.INTENTS_API_KEY || process.env.NEXT_PUBLIC_INTENTS_JWT);
}

export function getProvider(): SettlementProvider {
  if (cached) return cached;
  cached = isLiveMode()
    ? new OneClickProvider({ confidentialEnabled: confidentialEnabled() })
    : new MockSettlementProvider();
  return cached;
}

/** Fresh mock instance (tests). */
export function createMock(): MockSettlementProvider {
  return new MockSettlementProvider();
}

export type {
  PaymentIntent,
  QuoteResult,
  SettlementProvider,
  SettlementStatus,
} from "./SettlementProvider.ts";
