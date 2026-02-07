import type { NextApiRequest, NextApiResponse } from "next";
import { createAnonClient, getSupabaseEnv } from "../../../../lib/serverSupabase";
import { getCookieLast } from "../../../../lib/mfgCookies";

type ApiResponse =
  | { ok: true; vendor_code: string; must_reset_password: boolean }
  | { ok: false; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  const { supabaseUrl, anonKey } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey) {
    return res.status(500).json({ ok: false, error: "Server misconfigured" });
  }

  const token = getCookieLast(req, "mfg_session");
  if (!token) return res.status(401).json({ ok: false, error: "Not authenticated" });

  const anon = createAnonClient(supabaseUrl, anonKey);
  const { data, error } = await anon.rpc("erp_mfg_vendor_me_v1", { p_session_token: token });

  if (error) return res.status(500).json({ ok: false, error: "Failed" });

  const payload = (data ?? {}) as any;
  if (!payload.ok) return res.status(401).json({ ok: false, error: "Not authenticated" });

  return res.status(200).json({
    ok: true,
    vendor_code: String(payload.vendor_code || ""),
    must_reset_password: Boolean(payload.must_reset_password),
  });
}
