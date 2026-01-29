import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../../lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = {
  ok: true;
  statutory?: Record<string, unknown> | null;
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
      const { data, error } = await userClient.rpc("erp_hr_employee_statutory_get", {
        p_employee_id: employeeId,
      });

      if (error) {
        return res.status(400).json({
          ok: false,
          error: error.message || "Failed to load statutory details",
          details: error.details || error.hint || error.code,
        });
      }

      return res.status(200).json({ ok: true, statutory: (data as Record<string, unknown>) ?? null });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const payload = {
      p_employee_id: employeeId,
      p_pan: typeof body.pan === "string" && body.pan.trim() ? body.pan.trim() : null,
      p_uan: typeof body.uan === "string" && body.uan.trim() ? body.uan.trim() : null,
      p_pf_number: typeof body.pf_number === "string" && body.pf_number.trim() ? body.pf_number.trim() : null,
      p_esic_number:
        typeof body.esic_number === "string" && body.esic_number.trim() ? body.esic_number.trim() : null,
      p_professional_tax_number:
        typeof body.professional_tax_number === "string" && body.professional_tax_number.trim()
          ? body.professional_tax_number.trim()
          : null,
    };

    const { data, error } = await userClient.rpc("erp_hr_employee_statutory_upsert", payload);

    if (error) {
      return res.status(400).json({
        ok: false,
        error: error.message || "Failed to save statutory details",
        details: error.details || error.hint || error.code,
      });
    }

    return res.status(200).json({ ok: true, statutory: { id: data } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
