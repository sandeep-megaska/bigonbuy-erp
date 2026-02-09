import type { NextApiRequest, NextApiResponse } from "next";
import { createAnonClient, getSupabaseEnv } from "../../../../lib/serverSupabase";
import { getCookieLast } from "../../../../lib/mfgCookies";

type Resp = { ok: boolean; data?: any; error?: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey) return res.status(500).json({ ok: false, error: "Server misconfigured" });

  const token = (getCookieLast(req, "mfg_session") || "").trim();
  if (!token) return res.status(401).json({ ok: false, error: "Not authenticated" });

  const status = String(Array.isArray(req.query.status) ? req.query.status[0] : req.query.status || "").trim() || null;
  const from = String(Array.isArray(req.query.from) ? req.query.from[0] : req.query.from || "").trim() || null;
  const to = String(Array.isArray(req.query.to) ? req.query.to[0] : req.query.to || "").trim() || null;

  const anon = createAnonClient(supabaseUrl, anonKey);
  const { data, error } = await anon.rpc("erp_mfg_vendor_asns_list_v1", {
    p_session_token: token,
    p_status: status,
    p_from: from,
    p_to: to,
  });

  if (error) return res.status(400).json({ ok: false, error: error.message || "Failed to list ASNs" });
  return res.status(200).json({ ok: true, data: { items: data ?? [] } });
}
