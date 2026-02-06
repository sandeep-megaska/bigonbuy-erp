import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; lineId: string | null };
type ApiResponse = ErrorResponse | SuccessResponse;

type Payload = {
  payrollItemId?: string;
  code?: string;
  units?: number | string | null;
  rate?: number | string | null;
  amount?: number | string | null;
  notes?: string | null;
};

function parseOptionalNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

  const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
  const { data: userData, error: sessionError } = await userClient.auth.getUser();
  if (sessionError || !userData?.user) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  const body: Payload = req.body ?? {};
  const payrollItemId = body.payrollItemId;
  const code = body.code;
  if (!payrollItemId || !code) {
    return res.status(400).json({ ok: false, error: "payrollItemId and code are required" });
  }

  const payload = {
    p_payroll_item_id: payrollItemId,
    p_code: code,
    p_units: parseOptionalNumber(body.units),
    p_rate: parseOptionalNumber(body.rate),
    p_amount: parseOptionalNumber(body.amount),
    p_notes: body.notes?.toString().trim() || null,
  };

  const { data, error } = await userClient.rpc("erp_payroll_item_line_upsert", payload);
  if (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to upsert payroll item line",
      details: error.details || error.hint || error.code,
    });
  }

  return res.status(200).json({ ok: true, lineId: data ?? null });
}
