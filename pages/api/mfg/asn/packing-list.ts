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

  const asnId = String(Array.isArray(req.query.asn_id) ? req.query.asn_id[0] : req.query.asn_id || "").trim();
  if (!asnId) return res.status(400).json({ ok: false, error: "asn_id is required" });

  const anon = createAnonClient(supabaseUrl, anonKey);
  const { data, error } = await anon.rpc("erp_mfg_vendor_asn_packing_list_v1", {
    p_session_token: token,
    p_asn_id: asnId,
  });

  if (error) return res.status(400).json({ ok: false, error: error.message || "Failed to load packing list" });
  return res.status(200).json({ ok: true, data: { items: data ?? [] } });
}
