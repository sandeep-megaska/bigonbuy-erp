import type { NextApiRequest, NextApiResponse } from "next";
import { createServiceRoleClient, getSupabaseEnv } from "../../../../../lib/serverSupabase";
import { getVendorSessionFromRequest } from "../../../../../lib/mfg/vendorSession";

type Resp = { ok: boolean; data?: any; error?: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const auth = await getVendorSessionFromRequest(req);
  if (!auth.session) return res.status(auth.status).json({ ok: false, error: auth.error || "Not authenticated" });

  const { supabaseUrl, serviceRoleKey } = getSupabaseEnv();
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ ok: false, error: "Server misconfigured" });

  const status = typeof req.query.status === "string" ? req.query.status : null;
  const from = typeof req.query.from === "string" ? req.query.from : null;
  const to = typeof req.query.to === "string" ? req.query.to : null;

  const admin = createServiceRoleClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await admin.rpc("erp_mfg_po_lines_for_production_list_v1", {
    p_company_id: auth.session.company_id,
    p_vendor_id: auth.session.vendor_id,
    p_status: status,
    p_from: from,
    p_to: to,
  });

  if (error) return res.status(400).json({ ok: false, error: error.message || "Failed to load PO lines" });
  return res.status(200).json({ ok: true, data: { items: data ?? [] } });
}
