import type { NextApiRequest, NextApiResponse } from "next";
import { createServiceRoleClient, getSupabaseEnv } from "../../../../lib/serverSupabase";
import { clearVendorSessionCookie, parseVendorSessionCookie } from "../../../../lib/mfg/vendorAuth";

export default async function handler(req: NextApiRequest, res: NextApiResponse<{ ok: boolean; error?: string }>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const claims = parseVendorSessionCookie(req);
  clearVendorSessionCookie(res);
  if (!claims) return res.status(200).json({ ok: true });

  const { supabaseUrl, serviceRoleKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !serviceRoleKey || missing.length > 0) return res.status(200).json({ ok: true });

  const adminClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);
  await adminClient.rpc("erp_vendor_auth_logout", { p_session_token: claims.token });
  return res.status(200).json({ ok: true });
}
