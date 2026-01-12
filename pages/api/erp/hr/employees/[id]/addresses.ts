import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../../lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = {
  ok: true;
  addresses?: Record<string, unknown>[];
  address?: Record<string, unknown> | null;
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
      const { data, error } = await userClient
        .from("erp_employee_addresses")
        .select(
          "id, employee_id, address_type, line1, line2, city, state, postal_code, country, is_primary, created_at, updated_at"
        )
        .eq("employee_id", employeeId)
        .order("created_at", { ascending: true });

      if (error) {
        return res.status(400).json({
          ok: false,
          error: error.message || "Failed to load addresses",
          details: error.details || error.hint || error.code,
        });
      }

      return res.status(200).json({ ok: true, addresses: (data as Record<string, unknown>[]) || [] });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const addressType = typeof body.address_type === "string" ? body.address_type : null;
    if (!addressType) {
      return res.status(400).json({ ok: false, error: "address_type is required" });
    }

    const { data, error } = await userClient.rpc("erp_hr_employee_address_upsert", {
      p_employee_id: employeeId,
      p_address_type: addressType,
      p_line1: (body.line1 as string) ?? null,
      p_line2: (body.line2 as string) ?? null,
      p_city: (body.city as string) ?? null,
      p_state: (body.state as string) ?? null,
      p_postal_code: (body.postal_code as string) ?? null,
      p_country: (body.country as string) ?? null,
      p_is_primary: typeof body.is_primary === "boolean" ? body.is_primary : null,
    });

    if (error) {
      return res.status(400).json({
        ok: false,
        error: error.message || "Failed to save address",
        details: error.details || error.hint || error.code,
      });
    }

    return res.status(200).json({ ok: true, address: (data as Record<string, unknown>) ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
