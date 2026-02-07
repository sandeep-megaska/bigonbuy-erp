import type { NextApiRequest, NextApiResponse } from "next";
import { createServiceRoleClient, getSupabaseEnv } from "../../../../lib/serverSupabase";
import { getVendorSessionFromRequest } from "../../../../lib/mfg/vendorSession";

type Resp = { ok: boolean; data?: any; error?: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const auth = await getVendorSessionFromRequest(req);
  if (!auth.session) {
    return res.status(auth.status).json({ ok: false, error: auth.error || "Not authenticated" });
  }

  const bomId = String(Array.isArray(req.query.bom_id) ? req.query.bom_id[0] : req.query.bom_id || "").trim();
  if (!bomId) {
    return res.status(400).json({ ok: false, error: "bom_id is required" });
  }

  const { supabaseUrl, serviceRoleKey } = getSupabaseEnv();
  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ ok: false, error: "Server misconfigured" });
  }

  const admin = createServiceRoleClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await admin.rpc("erp_mfg_bom_get_v1", {
    p_company_id: auth.session.company_id,
    p_vendor_id: auth.session.vendor_id,
    p_bom_id: bomId,
  });

  if (error) {
    return res.status(400).json({ ok: false, error: error.message || "Failed to load BOM" });
  }

  return res.status(200).json({ ok: true, data: data ?? null });
}
