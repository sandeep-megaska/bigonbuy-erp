import type { NextApiRequest, NextApiResponse } from "next";
import { createServiceRoleClient, getSupabaseEnv } from "../../../../lib/serverSupabase";
import { parseVendorSessionCookie } from "../../../../lib/mfg/vendorAuth";

export default async function handler(req: NextApiRequest, res: NextApiResponse<{ ok: boolean; error?: string }>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const claims = parseVendorSessionCookie(req);
  if (!claims) return res.status(401).json({ ok: false, error: "Not authenticated" });

  const { old_password, new_password } = (req.body ?? {}) as Record<string, unknown>;
  const oldPassword = typeof old_password === "string" ? old_password : "";
  const newPassword = typeof new_password === "string" ? new_password : "";

  const { supabaseUrl, serviceRoleKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !serviceRoleKey || missing.length > 0) return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });

  const adminClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);
  const { error } = await adminClient.rpc("erp_vendor_auth_change_password", {
    p_session_token: claims.token,
    p_old_password: oldPassword,
    p_new_password: newPassword,
  });

  if (error) return res.status(400).json({ ok: false, error: error.message || "Unable to change password" });
  return res.status(200).json({ ok: true });
}
