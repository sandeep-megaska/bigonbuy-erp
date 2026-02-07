import type { NextApiRequest, NextApiResponse } from "next";
import { getCookieLast } from "../../../../lib/mfgCookies";
import {
  createAnonClient,
  createServiceRoleClient,
  getSupabaseEnv,
} from "../../../../lib/serverSupabase";

type Resp = { ok: boolean; data?: any; error?: string; details?: string | null };

const BUCKET = "erp-assets";
const EXPIRES = 60 * 60; // 1 hour

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Resp>,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const vendorCodeParam = req.query.vendor_code;
  const vendorCode = (Array.isArray(vendorCodeParam)
    ? vendorCodeParam[0]
    : vendorCodeParam || ""
  )
    .toString()
    .trim()
    .toUpperCase();

  if (!vendorCode) {
    return res.status(400).json({ ok: false, error: "vendor_code is required" });
  }

  const { supabaseUrl, anonKey, serviceRoleKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || !serviceRoleKey || missing.length > 0) {
    return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });
  }

  const token = (getCookieLast(req, "mfg_session") || "").trim();
  if (!token) return res.status(401).json({ ok: false, error: "Not authenticated" });

  // Validate vendor session using the locked RPC
  const anon = createAnonClient(supabaseUrl, anonKey);
  const { data: meData, error: meError } = await anon.rpc("erp_mfg_vendor_me_v1", {
    p_session_token: token,
  });

  if (meError) {
    return res.status(401).json({ ok: false, error: meError.message || "Not authenticated" });
  }

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

  // Load vendor (scoped)
  const { data: vendor, error: vendorError } = await adminClient
    .from("erp_vendors")
    .select("id, company_id, legal_name, vendor_code, portal_logo_path")
    .eq("vendor_code", vendorCode)
    .eq("company_id", sessionCompanyId)
    .maybeSingle();

  if (vendorError || !vendor) {
    return res.status(404).json({ ok: false, error: "Vendor not found" });
  }

  // IMPORTANT: company logos live in erp_company_settings (canonical)
  const { data: companySettings, error: settingsError } = await adminClient
    .from("erp_company_settings")
    .select("company_id, megaska_logo_path, bigonbuy_logo_path, legal_name, website, contact_email, contact_phone")
    .eq("company_id", sessionCompanyId)
    .maybeSingle();

  if (settingsError) {
    // Settings row might not exist in some environments; don't fail the dashboard
    // but return with branding urls as null.
  }

  // Signed URLs (bucket is private)
  const safeSign = async (path?: string | null) => {
    if (!path) return null;
    const { data, error } = await adminClient.storage.from(BUCKET).createSignedUrl(path, EXPIRES);
    if (error) return null;
    return data?.signedUrl ?? null;
  };

  const vendorLogoUrl = await safeSign(vendor.portal_logo_path || null);
  const companyMegaskaLogoUrl = await safeSign(companySettings?.megaska_logo_path || null);

  // If you ever want Bigonbuy too:
  const companyBigonbuyLogoUrl = await safeSign(companySettings?.bigonbuy_logo_path || null);

  return res.status(200).json({
    ok: true,
    data: {
      vendor,
      company_settings: companySettings ?? null,
      branding: {
        vendor_logo_url: vendorLogoUrl,
        company_megaska_logo_url: companyMegaskaLogoUrl,
        company_bigonbuy_logo_url: companyBigonbuyLogoUrl,
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
