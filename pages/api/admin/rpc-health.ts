import type { NextApiRequest, NextApiResponse } from "next";
import {
  createUserClient,
  getBearerToken,
  getSupabaseEnv,
} from "../../../lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; manager: boolean; employee_count: number };
type ApiResponse = ErrorResponse | SuccessResponse;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>,
) {
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
    return res
      .status(401)
      .json({ ok: false, error: "Missing Authorization: Bearer token" });
  }

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } =
      await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const userId = userData.user.id;
    const { data: isManager, error: managerError } = await userClient.rpc(
      "is_erp_manager",
      {
        uid: userId,
      },
    );

    if (managerError) {
      return res.status(500).json({
        ok: false,
        error: managerError.message || "is_erp_manager failed",
        details: managerError.details || managerError.hint || managerError.code,
      });
    }

    if (!isManager) {
      return res
        .status(403)
        .json({ ok: false, error: "Not authorized: owner/admin/hr only" });
    }

    const { data: employees, error: employeesError } = await userClient.rpc(
      "erp_list_employees",
      {},
    );
    if (employeesError) {
      return res.status(500).json({
        ok: false,
        error: employeesError.message || "erp_list_employees (no args) failed",
        details:
          employeesError.details || employeesError.hint || employeesError.code,
      });
    }

    const employeeCount = Array.isArray(employees) ? employees.length : 0;
    return res
      .status(200)
      .json({ ok: true, manager: !!isManager, employee_count: employeeCount });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
