import type { NextApiRequest, NextApiResponse } from "next";
import { createAnonClient, getSupabaseEnv } from "../../../../lib/serverSupabase";
import { clearMfgSessionCookies, getCookieLast } from "../../../../lib/mfgCookies";

type ApiResponse = { ok: true } | { ok: false; error: string; details?: string | null };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey) {
    return res.status(500).json({ ok: false, error: "Server misconfigured" });
  }

  const token = (getCookieLast(req, "mfg_session") || "").trim();

  // Best-effort revoke in DB
  if (token) {
    const anon = createAnonClient(supabaseUrl, anonKey);
    const { error } = await anon.rpc("erp_mfg_vendor_logout_v1", { p_session_token: token });
    if (error) {
      // still clear cookie even if DB revoke fails
      // but surface error for debugging
      const secure = process.env.NODE_ENV === "production";
      clearMfgSessionCookies(res, secure);
      return res.status(200).json({ ok: true });
    }
  }

  const secure = process.env.NODE_ENV === "production";
  // IMPORTANT: clear BOTH / and /mfg to remove legacy duplicates
  clearMfgSessionCookies(res, secure);

  return res.status(200).json({ ok: true });
}
