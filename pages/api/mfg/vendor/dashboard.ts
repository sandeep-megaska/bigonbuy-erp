import type { NextApiRequest, NextApiResponse } from "next";
import { getInternalManagerSession } from "../../../../lib/mfg/internalAuth";
import { getVendorSession } from "../../../../lib/mfg/vendorAuth";
import { createServiceRoleClient, getSupabaseEnv } from "../../../../lib/serverSupabase";

export default async function handler(req: NextApiRequest, res: NextApiResponse<{ ok: boolean; data?: any; error?: string }>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const vendorCodeParam = req.query.vendor_code;
  const vendorCode = (Array.isArray(vendorCodeParam) ? vendorCodeParam[0] : vendorCodeParam || "").toString().trim().toUpperCase();
  if (!vendorCode) return res.status(400).json({ ok: false, error: "vendor_code is required" });

  const vendorSession = await getVendorSession(req);
  const internalManager = await getInternalManagerSession(req);
  if (!vendorSession && !internalManager) return res.status(401).json({ ok: false, error: "Not authenticated" });
  if (vendorSession && vendorSession.vendor_code !== vendorCode) {
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }

  const { supabaseUrl, serviceRoleKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !serviceRoleKey || missing.length > 0) return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });
  const adminClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);

  const { data: vendor, error } = await adminClient
    .from("erp_vendors")
    .select("id, company_id, legal_name, vendor_code")
    .eq("vendor_code", vendorCode)
    .maybeSingle();

  if (error || !vendor) return res.status(404).json({ ok: false, error: "Vendor not found" });

  return res.status(200).json({
    ok: true,
    data: {
      vendor,
      tiles: {
        open_pos: 12,
        pending_deliveries: 5,
        quality_issues: 1,
      },
      recent_activity: [
        { id: "a1", label: "PO #PO-102 acknowledged", at: "Today" },
        { id: "a2", label: "ASN pending for GRN-778", at: "Yesterday" },
      ],
    },
  });
}
