import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; contacts: Record<string, unknown>[] };
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

    const primaryPayload = {
      employee_id: employeeId,
      contact_type: "primary",
      phone: (body.primary_phone as string) ?? null,
      email: (body.email as string) ?? null,
      is_primary: true,
    };

    const alternatePayload = {
      employee_id: employeeId,
      contact_type: "personal",
      phone: (body.alternate_phone as string) ?? null,
      email: null,
      is_primary: false,
    };

    const { error: primaryError } = await userClient
      .from("erp_employee_contacts")
      .upsert(primaryPayload, { onConflict: "employee_id, contact_type" });

    if (primaryError) {
      return res.status(400).json({
        ok: false,
        error: primaryError.message || "Failed to update contacts",
        details: primaryError.details || primaryError.hint || primaryError.code,
      });
    }

    const { error: alternateError } = await userClient
      .from("erp_employee_contacts")
      .upsert(alternatePayload, { onConflict: "employee_id, contact_type" });

    if (alternateError) {
      return res.status(400).json({
        ok: false,
        error: alternateError.message || "Failed to update contacts",
        details: alternateError.details || alternateError.hint || alternateError.code,
      });
    }

    const { data: contacts } = await userClient
      .from("erp_employee_contacts")
      .select("id, contact_type, email, phone")
      .eq("employee_id", employeeId);

    return res.status(200).json({ ok: true, contacts: (contacts ?? []) as Record<string, unknown>[] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
