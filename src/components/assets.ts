/**
 * Asset registry.
 *
 * Live mode: GET /v0/tokens from 1Click (230 assets, public, CORS *).
 * Mock mode: a small curated list so the demo needs no network at all.
 *
 * Asset ids below were read from the live /v0/tokens response; see README for the
 * date they were captured.
 */

import type { Asset } from "@/core/types";

export const MOCK_ASSETS: Asset[] = [
  {
    assetId: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    decimals: 6,
    blockchain: "near",
    symbol: "USDC",
    price: 1,
  },
  {
    assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
    decimals: 6,
    blockchain: "arb",
    symbol: "USDC",
    price: 1,
  },
  {
    assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
    decimals: 6,
    blockchain: "base",
    symbol: "USDC",
    price: 1,
  },
  {
    assetId: "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near",
    decimals: 6,
    blockchain: "eth",
    symbol: "USDT",
    price: 1,
  },
  {
    assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near",
    decimals: 6,
    blockchain: "sol",
    symbol: "USDC",
    price: 1,
  },
];

let cache: Asset[] | null = null;

export async function loadAssets(): Promise<Asset[]> {
  if (cache) return cache;
  try {
    const res = await fetch("https://1click.chaindefuser.com/v0/tokens", { cache: "force-cache" });
    if (!res.ok) throw new Error(`tokens: HTTP ${res.status}`);
    const all = (await res.json()) as Asset[];
    // Keep a focused, payroll-relevant subset: stablecoins on common payroll chains.
    const wanted = new Set(["near", "eth", "arb", "base", "sol", "polygon", "tron"]);
    const stable = new Set(["USDC", "USDT", "DAI", "USDT0"]);
    const filtered = all.filter((a) => wanted.has(a.blockchain) && stable.has(a.symbol));
    cache = filtered.length ? filtered : all.slice(0, 40);
    return cache;
  } catch {
    cache = MOCK_ASSETS;
    return cache;
  }
}

export function assetById(assets: Asset[], assetId: string): Asset | undefined {
  return assets.find((a) => a.assetId === assetId);
}

/** A sensible origin asset: USDC on NEAR is the usual payroll funding source. */
export const DEFAULT_ORIGIN_ASSET = MOCK_ASSETS[0].assetId;

export function decimalsFor(assets: Asset[], assetId: string): number {
  return assetById(assets, assetId)?.decimals ?? 6;
}
