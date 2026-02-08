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
  if (!auth.session) return res.status(auth.status).json({ ok: false, error: auth.error || "Not authenticated" });

  const vendorCodeParam = String(Array.isArray(req.query.vendor_code) ? req.query.vendor_code[0] : req.query.vendor_code || "").trim().toUpperCase();
  if (vendorCodeParam && vendorCodeParam !== auth.session.vendor_code.toUpperCase()) {
    return res.status(403).json({ ok: false, error: "Vendor scope mismatch" });
  }

  const statusParam = String(Array.isArray(req.query.status) ? req.query.status[0] : req.query.status || "").trim() || null;
  const fromParam = String(Array.isArray(req.query.from) ? req.query.from[0] : req.query.from || "").trim() || null;
  const toParam = String(Array.isArray(req.query.to) ? req.query.to[0] : req.query.to || "").trim() || null;

  const { supabaseUrl, serviceRoleKey } = getSupabaseEnv();
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ ok: false, error: "Server misconfigured" });

  const admin = createServiceRoleClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await admin.rpc("erp_mfg_po_lines_for_production_list_v1", {
    p_company_id: auth.session.company_id,
    p_vendor_id: auth.session.vendor_id,
    p_status: statusParam,
    p_from: fromParam,
    p_to: toParam,
  });

  if (error) return res.status(400).json({ ok: false, error: error.message || "Failed to load PO lines" });
  return res.status(200).json({ ok: true, data: { items: data ?? [] } });
}
