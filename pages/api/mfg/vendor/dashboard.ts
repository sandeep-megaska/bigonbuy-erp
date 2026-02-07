import type { NextApiRequest, NextApiResponse } from "next";
import { getInternalManagerSession } from "../../../../lib/mfg/internalAuth";
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
  if (!supabaseUrl || !anonKey) {
    return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });
  }

  // Internal manager session (optional path)
  const internalManager = await getInternalManagerSession(req);

  // Vendor session via mfg_session cookie + RPC (new canonical auth)
  const token = (getCookieLast(req, "mfg_session") || "").trim();
  let vendorSession: { vendor_code: string; vendor_id: string; company_id: string } | null = null;

  if (token) {
    const anon = createAnonClient(supabaseUrl, anonKey);
    const { data: meData, error: meError } = await anon.rpc("erp_mfg_vendor_me_v1", {
      p_session_token: token,
    });

    if (!meError) {
      const me = (meData ?? {}) as any;
      if (me?.ok) {
        vendorSession = {
          vendor_code: String(me.vendor_code || "").trim().toUpperCase(),
          vendor_id: String(me.vendor_id || "").trim(),
          company_id: String(me.company_id || "").trim(),
        };
      }
    }
  }

  if (!vendorSession && !internalManager) return res.status(401).json({ ok: false, error: "Not authenticated" });

  // Vendor can only access their own dashboard
  if (vendorSession && vendorSession.vendor_code !== vendorCode) {
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }

  // Keep service role read (safe for now). If you later add RLS-friendly RPC, we can remove this.
  if (!serviceRoleKey || missing.length > 0) {
    return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });
  }

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
