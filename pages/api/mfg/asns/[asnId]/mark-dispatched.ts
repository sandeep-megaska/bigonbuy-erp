import type { NextApiRequest, NextApiResponse } from "next";
import { createAnonClient, getSupabaseEnv } from "../../../../../lib/serverSupabase";
import { getCookieLast } from "../../../../../lib/mfgCookies";

type Resp = { ok: boolean; data?: any; error?: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey) return res.status(500).json({ ok: false, error: "Server misconfigured" });

  const token = (getCookieLast(req, "mfg_session") || "").trim();
  if (!token) return res.status(401).json({ ok: false, error: "Not authenticated" });

  const asnId = String(Array.isArray(req.query.asnId) ? req.query.asnId[0] : req.query.asnId || "").trim();
  if (!asnId) return res.status(400).json({ ok: false, error: "asnId is required" });

  const anon = createAnonClient(supabaseUrl, anonKey);
  const { data, error } = await anon.rpc("erp_mfg_asn_mark_dispatched_v1", {
    p_session_token: token,
    p_asn_id: asnId,
    p_transporter: String(req.body?.transporter_name || "").trim() || null,
    p_tracking_no: String(req.body?.tracking_no || "").trim() || null,
    p_dispatched_at: String(req.body?.dispatched_at || "").trim() || null,
    p_remarks: String(req.body?.remarks || "").trim() || null,
  });

  if (error) return res.status(400).json({ ok: false, error: error.message || "Failed to mark dispatched" });
  return res.status(200).json({ ok: true, data });
}
