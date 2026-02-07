import type { NextApiRequest, NextApiResponse } from "next";
import { clearMfgSessionCookies, getCookieLast } from "../../../../lib/mfgCookies";
import { createAnonClient, getSupabaseEnv } from "../../../../lib/serverSupabase";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey) return res.status(500).json({ ok: false, error: "Server misconfigured" });

  const token = getCookieLast(req, "mfg_session");
  if (token) {
    const anon = createAnonClient(supabaseUrl, anonKey);
    await anon.rpc("erp_mfg_vendor_logout_v1", { p_session_token: token });
  }

  clearMfgSessionCookies(res);
  return res.status(200).json({ ok: true });
}
