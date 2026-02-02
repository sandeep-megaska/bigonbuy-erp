import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = {
  approvals_submitted: number;
  ap_bills_draft: number;
  vendor_payments_pending: number;
  bank_txns_unreconciled: number;
  razorpay_settlements_unposted: number;
  inventory_negative: number;
  inventory_low_stock: number;
  payroll_runs_open: number;
};

type ApiResponse = ErrorResponse | SuccessResponse;

const countFrom = async (query: any): Promise<number> => {
  const { count, error } = await query.select("*", { count: "exact", head: true });
  if (error) throw error;
  return count || 0;
};

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

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const { error: permissionError } = await userClient.rpc("erp_require_finance_reader");
    if (permissionError) {
      return res.status(403).json({ ok: false, error: "Not authorized" });
    }

    const { data: companyId, error: companyError } = await userClient.rpc("erp_current_company_id");
    if (companyError || !companyId) {
      return res.status(400).json({ ok: false, error: "Invalid company context" });
    }

    const [
      approvalsSubmitted,
      apBillsDraft,
      vendorPaymentsPending,
      inventoryNegative,
      inventoryLow,
      payrollRunsOpen,
      reconSummary,
      razorpaySettlements,
    ] = await Promise.all([
      countFrom(
        userClient
          .from("erp_fin_pending_approvals_v")
          .eq("company_id", companyId)
      ),
      countFrom(
        userClient
          .from("erp_gst_purchase_invoices")
          .eq("company_id", companyId)
          .eq("status", "draft")
          .eq("is_void", false)
      ),
      countFrom(
        userClient
          .from("erp_ap_vendor_payments")
          .eq("company_id", companyId)
          .eq("is_void", false)
          .neq("status", "approved")
      ),
      countFrom(userClient.from("erp_inventory_negative_stock_v")),
      countFrom(userClient.from("erp_inventory_low_stock_v")),
      countFrom(
        userClient
          .from("erp_payroll_runs")
          .eq("company_id", companyId)
          .eq("posted_to_finance", false)
      ),
      userClient.rpc("erp_finance_recon_summary", {
        p_from: null,
        p_to: null,
        p_vendor_id: null,
        p_q: null,
        p_limit: 1,
        p_offset: 0,
      }),
      userClient.rpc("erp_razorpay_settlements_list", {
        p_from: null,
        p_to: null,
        p_query: null,
        p_posted_only: false,
      }),
    ]);

    if (reconSummary.error) throw reconSummary.error;
    if (razorpaySettlements.error) throw razorpaySettlements.error;

    const bankUnreconciled =
      (reconSummary.data as { counters?: { bank_unmatched_count?: number } } | null)?.counters
        ?.bank_unmatched_count ?? 0;

    const unpostedRazorpay = Array.isArray(razorpaySettlements.data)
      ? razorpaySettlements.data.filter((row) => row?.status === "imported").length
      : 0;

    return res.status(200).json({
      approvals_submitted: approvalsSubmitted,
      ap_bills_draft: apBillsDraft,
      vendor_payments_pending: vendorPaymentsPending,
      bank_txns_unreconciled: bankUnreconciled,
      razorpay_settlements_unposted: unpostedRazorpay,
      inventory_negative: inventoryNegative,
      inventory_low_stock: inventoryLow,
      payroll_runs_open: payrollRunsOpen,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
