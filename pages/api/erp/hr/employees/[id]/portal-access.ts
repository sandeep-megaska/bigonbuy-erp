import type { NextApiRequest, NextApiResponse } from "next";
import bcrypt from "bcryptjs";
import { requireManager } from "../../../../../../lib/erpAuth";
import { getBearerToken, getSupabaseEnv } from "../../../../../../lib/serverSupabase";

type PortalAccessRow = {
  employee_id: string;
  employee_code: string | null;
  is_active: boolean | null;
  must_reset_password: boolean | null;
  last_login_at: string | null;
};

type ErrorResponse = { ok: false; error: string };

type GetResponse = { ok: true; portal: PortalAccessRow } | ErrorResponse;

type PostResponse = { ok: true; portal: PortalAccessRow } | ErrorResponse;

type Action = "enable" | "reset" | "disable";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<GetResponse | PostResponse>,
) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const auth = await requireManager(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, error: auth.error });
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

  const { data: companyId, error: companyError } = await auth.userClient.rpc("erp_current_company_id");

  if (companyError || !companyId) {
    return res.status(400).json({
      ok: false,
      error: companyError?.message || "Failed to determine company",
    });
  }

  if (req.method === "GET") {
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

    return res.status(200).json({ ok: true, portal: row as PortalAccessRow });
  }

  const { action, temp_password: tempPassword } = (req.body ?? {}) as Record<string, unknown>;
  const actionValue = typeof action === "string" ? (action as Action) : null;

  if (!actionValue || !["enable", "reset", "disable"].includes(actionValue)) {
    return res.status(400).json({ ok: false, error: "Invalid action" });
  }

  if ((actionValue === "enable" || actionValue === "reset") && typeof tempPassword !== "string") {
    return res.status(400).json({ ok: false, error: "temp_password is required" });
  }

  if (actionValue === "enable" || actionValue === "reset") {
    const passwordHash = await bcrypt.hash(String(tempPassword), 10);
    const { error: upsertError } = await auth.userClient.rpc("erp_employee_auth_user_upsert", {
      p_company_id: companyId,
      p_employee_id: employeeId,
      p_password_hash: passwordHash,
      p_actor_user_id: auth.user.id,
    });

    if (upsertError) {
      return res.status(400).json({ ok: false, error: upsertError.message || "Failed to save" });
    }

    const { error: activeError } = await auth.userClient.rpc("erp_employee_auth_user_set_active", {
      p_company_id: companyId,
      p_employee_id: employeeId,
      p_is_active: true,
      p_actor_user_id: auth.user.id,
    });

    if (activeError) {
      return res.status(400).json({ ok: false, error: activeError.message || "Failed to enable access" });
    }
  }

  if (actionValue === "disable") {
    const { error: activeError } = await auth.userClient.rpc("erp_employee_auth_user_set_active", {
      p_company_id: companyId,
      p_employee_id: employeeId,
      p_is_active: false,
      p_actor_user_id: auth.user.id,
    });

    if (activeError) {
      return res.status(400).json({ ok: false, error: activeError.message || "Failed to disable access" });
    }
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

  return res.status(200).json({ ok: true, portal: row as PortalAccessRow });
}
