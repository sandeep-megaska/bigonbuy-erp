import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; compensation: Record<string, unknown> };
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
    if (!(roleKey === "owner" || roleKey === "admin" || roleKey === "payroll")) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    const payload = {
      employee_id: employeeId,
      salary_structure_id: (body.salary_structure_id as string) ?? null,
      effective_from: (body.effective_from as string) ?? null,
      currency: (body.currency as string) ?? "INR",
      gross_annual: (body.gross_annual as number) ?? null,
      notes: (body.notes as string) ?? null,
    };

    const { data, error } = await userClient
      .from("erp_employee_compensations")
      .insert(payload)
      .select("id, employee_id, salary_structure_id, effective_from, currency, gross_annual")
      .single();

    if (error) {
      return res.status(400).json({
        ok: false,
        error: error.message || "Failed to assign compensation",
        details: error.details || error.hint || error.code,
      });
    }

    return res.status(200).json({ ok: true, compensation: data as Record<string, unknown> });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
