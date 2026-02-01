import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "lib/serverSupabase";

/**
 * Dependency map:
 * UI: /erp/finance/ap/vendor-ledger -> GET /api/finance/ap/vendor-ledger
 * API: vendor-ledger -> RPC: erp_ap_vendor_ledger
 * RPC tables: erp_gst_purchase_invoices, erp_ap_vendor_advances, erp_ap_vendor_payments,
 *             erp_ap_vendor_payment_allocations, erp_ap_vendor_bill_advance_allocations,
 *             erp_fin_journals
 */

type ErrorResponse = { ok: false; error: string; details?: string | null };

type SuccessResponse = { ok: true; data: unknown };

type ApiResponse = ErrorResponse | SuccessResponse;

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || missing.length > 0) {
    return res.status(500).json({
      ok: false,
      error:
        "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token" });
  }

  const vendorId = typeof req.query.vendorId === "string" ? req.query.vendorId : null;
  const from = typeof req.query.from === "string" ? req.query.from : null;
  const to = typeof req.query.to === "string" ? req.query.to : null;

  if (!vendorId) {
    return res.status(400).json({ ok: false, error: "vendorId is required" });
  }

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const { data, error } = await userClient.rpc("erp_ap_vendor_ledger", {
      p_vendor_id: vendorId,
      p_from: from ?? null,
      p_to: to ?? null,
    });

    if (error) {
      return res.status(400).json({
        ok: false,
        error: error.message || "Failed to load vendor ledger",
        details: error.details || error.hint || error.code,
      });
    }

    return res.status(200).json({ ok: true, data: data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
