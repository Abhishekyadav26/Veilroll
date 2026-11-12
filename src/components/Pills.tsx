import type { PaymentStatus, SettlementState } from "@/core/types";

/** Map our per-payment status onto a coloured pill. */
export function StatusPill({ status }: { status: PaymentStatus }) {
  const map: Record<PaymentStatus, { cls: string; label: string }> = {
    draft: { cls: "", label: "Draft" },
    quoted: { cls: "info", label: "Quoted" },
    signing: { cls: "warn", label: "Awaiting wallet" },
    submitted: { cls: "warn", label: "Settling" },
    settled: { cls: "good", label: "Settled" },
    failed: { cls: "bad", label: "Failed" },
    retry: { cls: "warn", label: "Retrying" },
  };
  const { cls, label } = map[status] ?? { cls: "", label: status };
  return <span className={`pill ${cls}`}>{label}</span>;
}

export function SettlementPill({ state }: { state?: SettlementState }) {
  if (!state) return <span className="pill dim">—</span>;
  const map: Partial<Record<SettlementState, string>> = {
    SUCCESS: "good",
    FAILED: "bad",
    REFUNDED: "bad",
    PROCESSING: "warn",
    PENDING_DEPOSIT: "info",
    KNOWN_DEPOSIT_TX: "info",
    INCOMPLETE_DEPOSIT: "warn",
  };
  return <span className={`pill ${map[state] ?? ""}`}>{state.replace(/_/g, " ")}</span>;
}

export function PrivacyPill({ confidentiality }: { confidentiality: string }) {
  if (confidentiality === "public") return <span className="pill">public</span>;
  return <span className="pill priv">confidential · {confidentiality}</span>;
}
