import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; lines: unknown[] };
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

  const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
  const { data: userData, error: sessionError } = await userClient.auth.getUser();
  if (sessionError || !userData?.user) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  const payrollItemId = req.body?.payrollItemId ?? req.body?.p_payroll_item_id;
  if (!payrollItemId) {
    return res.status(400).json({ ok: false, error: "payrollItemId is required" });
  }

  const { data, error } = await userClient.rpc("erp_payroll_item_lines_list", {
    p_payroll_item_id: payrollItemId,
  });

  if (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to list payroll item lines",
      details: error.details || error.hint || error.code,
    });
  }

  return res.status(200).json({ ok: true, lines: Array.isArray(data) ? data : [] });
}
