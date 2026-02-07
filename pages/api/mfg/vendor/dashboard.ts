import type { NextApiRequest, NextApiResponse } from "next";
import { getCookieLast } from "../../../../lib/mfgCookies";
import { createAnonClient, createServiceRoleClient, getSupabaseEnv } from "../../../../lib/serverSupabase";

type Resp = { ok: boolean; data?: any; error?: string; details?: string | null };

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const vendorCodeParam = req.query.vendor_code;
  const vendorCode = (Array.isArray(vendorCodeParam) ? vendorCodeParam[0] : vendorCodeParam || "")
    .toString()
    .trim()
    .toUpperCase();

  if (!vendorCode) return res.status(400).json({ ok: false, error: "vendor_code is required" });

  const { supabaseUrl, anonKey, serviceRoleKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || !serviceRoleKey || missing.length > 0) {
    return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });
  }

  const token = (getCookieLast(req, "mfg_session") || "").trim();
  if (!token) return res.status(401).json({ ok: false, error: "Not authenticated" });

  const anon = createAnonClient(supabaseUrl, anonKey);
  const { data: meData, error: meError } = await anon.rpc("erp_mfg_vendor_me_v1", {
    p_session_token: token,
  });

  if (meError) return res.status(401).json({ ok: false, error: meError.message || "Not authenticated" });

  const me = (meData ?? {}) as any;
  if (!me?.ok) return res.status(401).json({ ok: false, error: "Not authenticated" });

  const sessionVendorCode = String(me.vendor_code || "").trim().toUpperCase();
  const sessionCompanyId = String(me.company_id || "").trim();
  if (!sessionVendorCode || !sessionCompanyId) {
    return res.status(401).json({ ok: false, error: "Invalid session" });
  }

  if (sessionVendorCode !== vendorCode) {
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }

  const adminClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);

  const { data: vendor, error } = await adminClient
    .from("erp_vendors")
    .select("id, company_id, legal_name, vendor_code, portal_logo_path")
    .eq("vendor_code", vendorCode)
    .eq("company_id", sessionCompanyId)
    .maybeSingle();

  if (error || !vendor) return res.status(404).json({ ok: false, error: "Vendor not found" });

  const { data: company } = await adminClient
    .from("erp_companies")
    .select("id, legal_name, brand_name, secondary_logo_path")
    .eq("id", sessionCompanyId)
    .maybeSingle();

  const { data: vendorLogoPublic } = adminClient.storage
    .from("erp-assets")
    .getPublicUrl(vendor.portal_logo_path || "");
  const { data: companySecondaryLogoPublic } = adminClient.storage
    .from("erp-assets")
    .getPublicUrl(company?.secondary_logo_path || "");

  return res.status(200).json({
    ok: true,
    data: {
      vendor,
      company,
      branding: {
        vendor_logo_url: vendor.portal_logo_path ? vendorLogoPublic?.publicUrl ?? null : null,
        company_secondary_logo_url: company?.secondary_logo_path
          ? companySecondaryLogoPublic?.publicUrl ?? null
          : null,
      },
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
