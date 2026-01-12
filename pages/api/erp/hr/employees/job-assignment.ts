import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; job: Record<string, unknown> };
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

  const body = (req.body ?? {}) as Record<string, unknown>;
  const employeeId = typeof body.employee_id === "string" ? body.employee_id : null;
  if (!employeeId) {
    return res.status(400).json({ ok: false, error: "employee_id is required" });
  }

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const { data: membership } = await userClient
      .from("erp_company_users")
      .select("role_key")
      .eq("user_id", userData.user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    const roleKey = membership?.role_key ?? null;
    if (!(roleKey === "owner" || roleKey === "admin" || roleKey === "hr")) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    const payload = {
      employee_id: employeeId,
      effective_from: (body.effective_from as string) ?? null,
      department_id: (body.department_id as string) ?? null,
      designation_id: (body.designation_id as string) ?? null,
      grade_id: (body.grade_id as string) ?? null,
      location_id: (body.location_id as string) ?? null,
      cost_center_id: (body.cost_center_id as string) ?? null,
      manager_employee_id: (body.manager_employee_id as string) ?? null,
    };

    const { data, error } = await userClient
      .from("erp_employee_jobs")
      .insert(payload)
      .select("id, employee_id, effective_from, department_id, designation_id, grade_id, location_id, cost_center_id, manager_employee_id")
      .single();

    if (error) {
      return res.status(400).json({
        ok: false,
        error: error.message || "Failed to create job assignment",
        details: error.details || error.hint || error.code,
      });
    }

    return res.status(200).json({ ok: true, job: data as Record<string, unknown> });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
