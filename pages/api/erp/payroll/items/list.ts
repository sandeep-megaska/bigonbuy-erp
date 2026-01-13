import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../lib/serverSupabase";

type PayrollItem = {
  id: string;
  employee_id: string;
  employee_name?: string | null;
  employee_code?: string | null;
  ot_amount?: number | null;
  gross: number | null;
  deductions: number | null;
  net_pay: number | null;
  notes: string | null;
  payslip_no: string | null;
  salary_basic?: number | null;
  salary_hra?: number | null;
  salary_allowances?: number | null;
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
        "id, employee_id, gross, deductions, net_pay, notes, payslip_no, salary_basic, salary_hra, salary_allowances"
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

    const items = (data as PayrollItem[]) || [];
    const employeeIds = Array.from(new Set(items.map((item) => item.employee_id).filter(Boolean)));
    const itemIds = items.map((item) => item.id).filter(Boolean);

    let employeesById = new Map<string, { full_name: string | null; employee_code: string | null }>();
    if (employeeIds.length > 0) {
      const { data: employeeData, error: employeeError } = await userClient
        .from("erp_employees")
        .select("id, full_name, employee_code")
        .in("id", employeeIds);

      if (employeeError) {
        return res.status(400).json({
          ok: false,
          error: employeeError.message || "Failed to load employees",
          details: employeeError.details || employeeError.hint || employeeError.code,
        });
      }

      employeesById = new Map(
        (employeeData || []).map((employee) => [
          employee.id,
          {
            full_name: employee.full_name ?? null,
            employee_code: employee.employee_code ?? null,
          },
        ])
      );
    }

    let otTotalsByItemId = new Map<string, number>();
    if (itemIds.length > 0) {
      const { data: lineData, error: lineError } = await userClient
        .from("erp_payroll_item_lines")
        .select("payroll_item_id, amount, code")
        .in("payroll_item_id", itemIds)
        .eq("code", "OT");

      if (lineError) {
        return res.status(400).json({
          ok: false,
          error: lineError.message || "Failed to load payroll item lines",
          details: lineError.details || lineError.hint || lineError.code,
        });
      }

      otTotalsByItemId = new Map();
      (lineData || []).forEach((line) => {
        const current = otTotalsByItemId.get(line.payroll_item_id) ?? 0;
        otTotalsByItemId.set(line.payroll_item_id, current + (Number(line.amount) || 0));
      });
    }

    const enrichedItems = items.map((item) => {
      const employee = employeesById.get(item.employee_id);
      return {
        ...item,
        employee_name: employee?.full_name ?? null,
        employee_code: employee?.employee_code ?? null,
        ot_amount: otTotalsByItemId.get(item.id) ?? 0,
      };
    });

    return res.status(200).json({ ok: true, items: enrichedItems });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
