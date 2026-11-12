/**
 * Server-side proxy for GET /v0/status?depositAddress=...
 *
 * The client stores the deposit address per payment, so it passes it here. We
 * keep the mapping server-side too when a quote is requested, but the address is
 * not secret: it is public on chain.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { lookupDeposit } from "@/lib/depositMap";

const ONE_CLICK = "https://1click.chaindefuser.com/v0/status";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const depositAddress = String(req.query.depositAddress ?? "").trim();
  const depositMemo = String(req.query.depositMemo ?? "").trim();
  const paymentId = String(req.query.paymentId ?? "").trim();

  // Prefer the explicit address from the client; fall back to our map.
  const fromMap = paymentId ? lookupDeposit(paymentId) : {};
  const address = depositAddress || fromMap.depositAddress;
  const memo = depositMemo || fromMap.depositMemo;

  if (!address) {
    return res.status(400).json({ ok: false, error: "depositAddress (or a known paymentId) is required" });
  }

  const url = new URL(ONE_CLICK);
  url.searchParams.set("depositAddress", address);
  if (memo) url.searchParams.set("depositMemo", memo);

  const headers: Record<string, string> = {};
  if (process.env.INTENTS_API_KEY) headers["X-API-Key"] = process.env.INTENTS_API_KEY;

  try {
    const upstream = await fetch(url, { headers, cache: "no-store" });
    const text = await upstream.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    if (!upstream.ok) {
      return res.status(200).json({
        ok: false,
        code: `UPSTREAM_${upstream.status}`,
        error: parsed?.message || parsed?.error || text.slice(0, 200) || `HTTP ${upstream.status}`,
      });
    }
    return res.status(200).json({
      ok: true,
      status: parsed?.status,
      updatedAt: parsed?.updatedAt,
      swapDetails: parsed?.swapDetails,
      quoteResponse: parsed?.quoteResponse,
    });
  } catch (e) {
    return res.status(502).json({ ok: false, code: "UPSTREAM_UNREACHABLE", error: (e as Error).message });
  }
}
