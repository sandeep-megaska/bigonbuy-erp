import type { NextApiRequest, NextApiResponse } from "next";
import { createServiceRoleClient, getSupabaseEnv } from "../../../../lib/serverSupabase";
import { getVendorSessionFromRequest } from "../../../../lib/mfg/vendorSession";

type CoverageRow = {
  material_id: string;
  material_name: string;
  uom: string;
  on_hand_qty: number;
  demand_qty_next: number;
  projected_balance: number;
  shortage_flag: boolean;
  days_cover_estimate: number | null;
  reorder_point: number;
  lead_time_days: number;
  total_materials: number;
  shortage_count: number;
};

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

  const { supabaseUrl, serviceRoleKey } = getSupabaseEnv();
  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ ok: false, error: "Server misconfigured" });
  }

  const admin = createServiceRoleClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await admin.rpc("erp_mfg_material_coverage_v1", {
    p_company_id: auth.session.company_id,
    p_vendor_id: auth.session.vendor_id,
  });

  if (error) {
    return res.status(400).json({ ok: false, error: error.message || "Failed to load material coverage" });
  }

  const rows = (Array.isArray(data) ? data : []) as CoverageRow[];
  const first = rows[0];

  return res.status(200).json({
    ok: true,
    data: {
      items: rows,
      summary: {
        total_materials: Number(first?.total_materials || 0),
        shortage_count: Number(first?.shortage_count || 0),
      },
    },
  });
}
