/**
 * Server-side proxy for POST /v0/quote.
 *
 * The partner JWT (INTENTS_API_KEY) lives only here. The browser never sees it.
 *
 * Behaviour by request:
 *   confidentiality: "public"        -> sent to 1Click, no auth needed
 *   confidentiality: "basic"|"advanced" -> requires a JWT; without one we return
 *                                        authRequired so the UI can say so plainly
 *                                        instead of failing mysteriously.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { rememberDeposit } from "@/lib/depositMap";

const ONE_CLICK = "https://1click.chaindefuser.com/v0/quote";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { paymentId, body } = req.body ?? {};
  if (!body || typeof body !== "object") {
    return res.status(400).json({ ok: false, error: "Missing quote body" });
  }

  const confidentiality = String(body.confidentiality ?? "public");
  const isConfidential = confidentiality === "basic" || confidentiality === "advanced";
  const apiKey = process.env.INTENTS_API_KEY;

  if (isConfidential && !apiKey) {
    return res.status(200).json({
      ok: false,
      authRequired: true,
      code: "CONFIDENTIAL_AUTH_REQUIRED",
      error:
        "Confidential quotes need a NEAR Intents partner JWT (INTENTS_API_KEY). 1Click returns 401 without one. Public or mock quotes still work.",
      paymentId,
    });
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["X-API-Key"] = apiKey;

  // Server-side deadline refresh: the client's clock may drift.
  const outgoing = {
    ...body,
    deadline: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
  };

  try {
    const upstream = await fetch(ONE_CLICK, {
      method: "POST",
      headers,
      body: JSON.stringify(outgoing),
    });

    const text = await upstream.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }

    if (!upstream.ok) {
      const msg =
        (parsed as any)?.message || (parsed as any)?.error || text.slice(0, 300) || `HTTP ${upstream.status}`;
      return res.status(200).json({
        ok: false,
        code: upstream.status === 401 ? "CONFIDENTIAL_AUTH_REQUIRED" : `UPSTREAM_${upstream.status}`,
        authRequired: upstream.status === 401,
        error: msg,
        paymentId,
      });
    }

    const depositAddress = (parsed as any)?.quote?.depositAddress;
    if (paymentId && depositAddress) rememberDeposit(String(paymentId), String(depositAddress));

    return res.status(200).json({ ok: true, quote: parsed, paymentId });
  } catch (e) {
    return res.status(502).json({
      ok: false,
      code: "UPSTREAM_UNREACHABLE",
      error: `Could not reach NEAR Intents: ${(e as Error).message}`,
      paymentId,
    });
  }
}
