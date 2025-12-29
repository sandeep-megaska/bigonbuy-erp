import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; employee: Record<string, unknown> };
type ApiResponse = ErrorResponse | SuccessResponse;

function normalizeLifecycle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (["preboarding", "active", "on_notice", "on notice", "onnotice"].includes(trimmed)) {
    return trimmed.startsWith("on") && trimmed.includes("notice") ? "on_notice" : trimmed;
  }
  if (trimmed === "exited") return "exited";
  return null;
}

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

  const body = (req.body ?? {}) as Record<string, unknown>;
  const employeeId = typeof body.employee_id === "string" ? body.employee_id : null;
  if (!employeeId) {
    return res.status(400).json({ ok: false, error: "employee_id is required" });
  }

  const lifecycle = normalizeLifecycle(body.lifecycle_status) ?? "preboarding";

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const { data, error } = await userClient.rpc("erp_employee_update_job", {
      p_employee_id: employeeId,
      p_department_id: (body.department_id as string) ?? null,
      p_job_title_id: (body.job_title_id as string) ?? null,
      p_location_id: (body.location_id as string) ?? null,
      p_employment_type_id: (body.employment_type_id as string) ?? null,
      p_manager_employee_id: (body.manager_employee_id as string) ?? null,
      p_lifecycle_status: lifecycle,
      p_exit_date: (body.exit_date as string) ?? null,
    });

    if (error) {
      return res.status(400).json({
        ok: false,
        error: error.message || "Failed to update employee job info",
        details: error.details || error.hint || error.code,
      });
    }

    return res.status(200).json({ ok: true, employee: data as Record<string, unknown> });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
