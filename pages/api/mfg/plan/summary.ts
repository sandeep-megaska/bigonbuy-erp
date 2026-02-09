import type { NextApiRequest, NextApiResponse } from "next";
import { getCookieLast } from "../../../../lib/mfgCookies";
import { createAnonClient, getSupabaseEnv } from "../../../../lib/serverSupabase";

type Resp = { ok: boolean; data?: any; error?: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey) {
    return res.status(500).json({ ok: false, error: "Server misconfigured" });
  }

  const token = (getCookieLast(req, "mfg_session") || "").trim();
  if (!token) return res.status(401).json({ ok: false, error: "Not authenticated" });

  const horizon = Math.max(Number(req.query.horizon_days || 30), 1);

  const anon = createAnonClient(supabaseUrl, anonKey);
  const { data, error } = await anon.rpc("erp_mfg_vendor_forecast_summary_v1", {
    p_session_token: token,
    p_horizon_days: horizon,
  });

  if (error) {
    return res.status(400).json({ ok: false, error: error.message || "Failed to load summary" });
  }

  return res.status(200).json({ ok: true, data: data || {} });
}
