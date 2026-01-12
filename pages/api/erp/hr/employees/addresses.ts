import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; addresses: Record<string, unknown>[] };
type ApiResponse = ErrorResponse | SuccessResponse;

type AddressPayload = {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
};

function buildPayload(employeeId: string, addressType: string, input: AddressPayload) {
  return {
    employee_id: employeeId,
    address_type: addressType,
    line1: input.line1 ?? null,
    line2: input.line2 ?? null,
    city: input.city ?? null,
    state: input.state ?? null,
    postal_code: input.postal_code ?? null,
    country: input.country ?? null,
  };
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

    const currentPayload = buildPayload(employeeId, "current", (body.current as AddressPayload) ?? {});
    const permanentPayload = buildPayload(employeeId, "permanent", (body.permanent as AddressPayload) ?? {});

    const { error: currentError } = await userClient
      .from("erp_employee_addresses")
      .upsert(currentPayload, { onConflict: "employee_id, address_type" });

    if (currentError) {
      return res.status(400).json({
        ok: false,
        error: currentError.message || "Failed to update address",
        details: currentError.details || currentError.hint || currentError.code,
      });
    }

    const { error: permanentError } = await userClient
      .from("erp_employee_addresses")
      .upsert(permanentPayload, { onConflict: "employee_id, address_type" });

    if (permanentError) {
      return res.status(400).json({
        ok: false,
        error: permanentError.message || "Failed to update address",
        details: permanentError.details || permanentError.hint || permanentError.code,
      });
    }

    const { data: addresses } = await userClient
      .from("erp_employee_addresses")
      .select("id, address_type, line1, line2, city, state, postal_code, country")
      .eq("employee_id", employeeId);

    return res.status(200).json({ ok: true, addresses: (addresses ?? []) as Record<string, unknown>[] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
