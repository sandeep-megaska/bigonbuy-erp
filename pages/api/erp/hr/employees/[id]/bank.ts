import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../../lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = {
  ok: true;
  bank?: Record<string, unknown> | null;
};
type ApiResponse = ErrorResponse | SuccessResponse;

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (!req.method || !["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
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

  const employeeIdParam = req.query.id;
  const employeeId = Array.isArray(employeeIdParam) ? employeeIdParam[0] : employeeIdParam;
  if (!employeeId) {
    return res.status(400).json({ ok: false, error: "employee id is required" });
  }

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    if (req.method === "GET") {
      const { data, error } = await userClient.rpc("erp_hr_employee_bank_get", {
        p_employee_id: employeeId,
      });

      if (error) {
        return res.status(400).json({
          ok: false,
          error: error.message || "Failed to load bank details",
          details: error.details || error.hint || error.code,
        });
      }

      return res.status(200).json({ ok: true, bank: (data as Record<string, unknown>) ?? null });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const bankName = typeof body.bank_name === "string" ? body.bank_name.trim() : "";
    const accountNumber = typeof body.account_number === "string" ? body.account_number.trim() : "";

    if (!bankName) {
      return res.status(400).json({ ok: false, error: "bank_name is required" });
    }
    if (!accountNumber) {
      return res.status(400).json({ ok: false, error: "account_number is required" });
    }

    const payload = {
      p_employee_id: employeeId,
      p_bank_name: bankName,
      p_branch_name:
        typeof body.branch_name === "string" && body.branch_name.trim() ? body.branch_name.trim() : null,
      p_account_holder_name:
        typeof body.account_holder_name === "string" && body.account_holder_name.trim()
          ? body.account_holder_name.trim()
          : null,
      p_account_number: accountNumber,
      p_ifsc_code: typeof body.ifsc_code === "string" && body.ifsc_code.trim() ? body.ifsc_code.trim() : null,
      p_account_type:
        typeof body.account_type === "string" && body.account_type.trim() ? body.account_type.trim() : null,
      p_is_primary: typeof body.is_primary === "boolean" ? body.is_primary : true,
    };

    const { data, error } = await userClient.rpc("erp_hr_employee_bank_upsert", payload);

    if (error) {
      return res.status(400).json({
        ok: false,
        error: error.message || "Failed to save bank details",
        details: error.details || error.hint || error.code,
      });
    }

    return res.status(200).json({ ok: true, bank: { id: data } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
