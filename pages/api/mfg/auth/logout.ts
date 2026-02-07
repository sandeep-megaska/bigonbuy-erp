import type { NextApiRequest, NextApiResponse } from "next";
import { createAnonClient, getSupabaseEnv } from "../../../../lib/serverSupabase";

function getCookie(req: NextApiRequest, name: string): string | null {
  const raw = req.headers.cookie || "";
  const parts = raw.split(";").map((p) => p.trim());
  for (const p of parts) {
    if (p.startsWith(name + "=")) return decodeURIComponent(p.slice(name.length + 1));
  }
  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey) return res.status(500).json({ ok: false, error: "Server misconfigured" });

  const token = getCookie(req, "mfg_session");
  if (token) {
    const anon = createAnonClient(supabaseUrl, anonKey);
    await anon.rpc("erp_mfg_vendor_logout_v1", { p_session_token: token });
  }

  const secure = process.env.NODE_ENV === "production";
  res.setHeader("Set-Cookie", [
    [`mfg_session=`, "Path=/mfg", "HttpOnly", "SameSite=Lax", "Max-Age=0", secure ? "Secure" : ""].filter(Boolean).join("; "),
  ]);

  return res.status(200).json({ ok: true });
}
