import type { NextApiRequest, NextApiResponse } from "next";
import { createServiceRoleClient, getSupabaseEnv } from "../../../../lib/serverSupabase";
import { getVendorSessionFromRequest } from "../../../../lib/mfg/vendorSession";

type Resp = { ok: boolean; data?: any; error?: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const auth = await getVendorSessionFromRequest(req);
  if (!auth.session) {
    return res.status(auth.status).json({ ok: false, error: auth.error || "Not authenticated" });
  }

  const { name, category, default_uom, reorder_point, lead_time_days } = req.body ?? {};

  const { supabaseUrl, serviceRoleKey } = getSupabaseEnv();
  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ ok: false, error: "Server misconfigured" });
  }

  const admin = createServiceRoleClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await admin.rpc("erp_mfg_material_create_v1", {
    p_company_id: auth.session.company_id,
    p_vendor_id: auth.session.vendor_id,
    p_name: name,
    p_category: category,
    p_default_uom: default_uom,
    p_reorder_point: reorder_point,
    p_lead_time_days: lead_time_days,
  });

  if (error) {
    return res.status(400).json({ ok: false, error: error.message || "Failed to create material" });
  }

  return res.status(200).json({ ok: true, data: data ?? null });
}
