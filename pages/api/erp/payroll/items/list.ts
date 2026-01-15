import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../lib/serverSupabase";

type PayrollItem = {
  id: string;
  employee_id: string;
  gross: number | null;
  deductions: number | null;
  net_pay: number | null;
  notes: string | null;
  payslip_no: string | null;
  payable_days?: number | null;
  lop_days?: number | null;
  payable_days_override?: number | null;
  lop_days_override?: number | null;
  salary_basic?: number | null;
  salary_hra?: number | null;
  salary_allowances?: number | null;
  basic?: number | null;
  hra?: number | null;
  allowances?: number | null;
};

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; items: PayrollItem[] };
type ApiResponse = ErrorResponse | SuccessResponse;

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
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

  const payload = (req.body ?? {}) as { payrollRunId?: string };
  const payrollRunId = payload.payrollRunId;
  if (!payrollRunId) {
    return res.status(400).json({ ok: false, error: "payrollRunId is required" });
  }

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const { data, error } = await userClient
      .from("erp_payroll_items")
      .select(
        "id, employee_id, gross, deductions, net_pay, notes, payslip_no, payable_days, lop_days, payable_days_override, lop_days_override, salary_basic, salary_hra, salary_allowances, basic, hra, allowances"
      )
      .eq("payroll_run_id", payrollRunId)
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(400).json({
        ok: false,
        error: error.message || "Failed to load payroll items",
        details: error.details || error.hint || error.code,
      });
    }

    return res.status(200).json({ ok: true, items: (data as PayrollItem[]) || [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
