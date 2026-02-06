import type { NextApiRequest, NextApiResponse } from "next";
import { requireManager } from "../../../../../lib/erpAuth";

type PortalAccessRow = {
  employee_id: string;
  employee_code: string | null;
  is_active: boolean | null;
  must_reset_password: boolean | null;
  last_login_at: string | null;
};

type ResetResponse =
  | { ok: true; portal: PortalAccessRow; temp_password: string }
  | { ok: false; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResetResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const auth = await requireManager(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, error: auth.error });
  }

  const employeeIdParam = req.query.id;
  const employeeId = Array.isArray(employeeIdParam) ? employeeIdParam[0] : employeeIdParam;
  if (!employeeId) {
    return res.status(400).json({ ok: false, error: "employee id is required" });
  }

  const { data: companyId, error: companyError } = await auth.userClient.rpc("erp_current_company_id");

  if (companyError || !companyId) {
    return res.status(400).json({
      ok: false,
      error: companyError?.message || "Failed to determine company",
    });
  }

  const { data: resetRows, error: resetError } = await auth.userClient.rpc(
    "erp_employee_auth_admin_reset_password",
    {
      p_company_id: companyId,
      p_employee_id: employeeId,
    }
  );

  if (resetError) {
    return res.status(400).json({ ok: false, error: resetError.message || "Failed to reset password" });
  }

  const resetRow = Array.isArray(resetRows) ? resetRows[0] : resetRows;
  if (!resetRow?.temp_password) {
    return res.status(500).json({ ok: false, error: "Temporary password not generated" });
  }

  const { data, error } = await auth.userClient.rpc("erp_employee_auth_user_get_by_employee_id", {
    p_company_id: companyId,
    p_employee_id: employeeId,
  });

  if (error) {
    return res.status(400).json({ ok: false, error: error.message || "Failed to load portal access" });
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return res.status(404).json({ ok: false, error: "Employee not found" });
  }

  return res.status(200).json({
    ok: true,
    portal: row as PortalAccessRow,
    temp_password: resetRow.temp_password,
  });
}
