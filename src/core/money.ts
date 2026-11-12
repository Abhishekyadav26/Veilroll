/**
 * Money helpers. All arithmetic is bigint on smallest units; only display
 * converts to decimal. Never use floats for balances.
 */

/** Format a smallest-unit amount string for display, trimming trailing zeros. */
export function formatUnits(amount: string | bigint | undefined | null, decimals: number, maxFrac = 6): string {
  // Tolerate older stored receipts that predate a field rather than throwing in render.
  const safeDecimals = Number.isFinite(decimals) ? decimals : 6;
  const raw = typeof amount === "bigint" ? amount : BigInt(amount || "0");
  const value = raw;
  const negative = value < 0n;
  const abs = negative ? -value : value;

  const base = 10n ** BigInt(safeDecimals);
  const whole = abs / base;
  const frac = abs % base;

  let fracStr = frac.toString().padStart(safeDecimals, "0");
  // Keep only up to maxFrac significant decimals, then trim.
  if (fracStr.length > maxFrac) fracStr = fracStr.slice(0, maxFrac);
  fracStr = fracStr.replace(/0+$/, "");

  const sign = negative ? "-" : "";
  return fracStr ? `${sign}${whole.toString()}.${fracStr}` : `${sign}${whole.toString()}`;
}

/**
 * Parse a human decimal string ("12.5") into smallest units for `decimals`.
 * Throws on malformed input rather than silently returning 0.
 */
export function parseUnits(input: string, decimals: number): bigint {
  const trimmed = (input ?? "").trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === "" || trimmed === ".") {
    throw new Error(`Invalid amount: "${input}"`);
  }
  const [wholePart, fracPart = ""] = trimmed.split(".");
  if (fracPart.length > decimals) {
    throw new Error(`Too many decimal places for this asset (max ${decimals}).`);
  }
  const whole = wholePart === "" ? "0" : wholePart;
  const frac = fracPart.padEnd(decimals, "0");
  return BigInt(whole + frac);
}

/** Approximate USD value of a token amount, using a per-unit USD price. */
export function toUsd(amount: string, decimals: number, pricePerUnit: number): string {
  const units = Number(formatUnits(amount, decimals, 12));
  if (!Number.isFinite(units) || !Number.isFinite(pricePerUnit)) return "";
  return (units * pricePerUnit).toFixed(2);
}

/** Sum smallest-unit amounts held as decimal strings. */
export function sumAmounts(amounts: string[]): string {
  return amounts.reduce((acc, a) => acc + BigInt(a || "0"), 0n).toString();
}
