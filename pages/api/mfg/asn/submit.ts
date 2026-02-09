import type { NextApiRequest, NextApiResponse } from "next";
import { createAnonClient, getSupabaseEnv } from "../../../../lib/serverSupabase";
import { getCookieLast } from "../../../../lib/mfgCookies";

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

  const asn_id = String(req.body?.asn_id || "").trim();
  if (!asn_id) return res.status(400).json({ ok: false, error: "asn_id is required" });

  const anon = createAnonClient(supabaseUrl, anonKey);
  const { data, error } = await anon.rpc("erp_mfg_asn_submit_v1", {
    p_session_token: token,
    p_asn_id: asn_id,
  });

  if (error) return res.status(400).json({ ok: false, error: error.message || "Failed to submit ASN" });
  return res.status(200).json({ ok: true, data });
}
