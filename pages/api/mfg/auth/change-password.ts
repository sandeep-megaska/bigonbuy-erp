import type { NextApiRequest, NextApiResponse } from "next";
import { createAnonClient, getSupabaseEnv } from "../../../../lib/serverSupabase";

type ApiResponse = { ok: true } | { ok: false; error: string; details?: string | null };

function getCookie(req: NextApiRequest, name: string): string | null {
  const raw = req.headers.cookie || "";
  const parts = raw.split(";").map((p) => p.trim());
  for (const p of parts) {
    if (p.startsWith(name + "=")) return decodeURIComponent(p.slice(name.length + 1));
  }
  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey) return res.status(500).json({ ok: false, error: "Server misconfigured" });

  const token = getCookie(req, "mfg_session");
  if (!token) return res.status(401).json({ ok: false, error: "Not authenticated" });

  const { new_password } = (req.body ?? {}) as Record<string, unknown>;
  const pwd = typeof new_password === "string" ? new_password : "";
  if (!pwd) return res.status(400).json({ ok: false, error: "new_password is required" });

  const anon = createAnonClient(supabaseUrl, anonKey);
  const { data, error } = await anon.rpc("erp_mfg_vendor_reset_password_v1", {
    p_session_token: token,
    p_new_password: pwd,
  });

  if (error) return res.status(500).json({ ok: false, error: error.message || "Failed", details: error.details || error.hint || error.code });

  const payload = (data ?? {}) as any;
  if (!payload.ok) return res.status(400).json({ ok: false, error: payload.error || "Failed" });

  return res.status(200).json({ ok: true });
}
