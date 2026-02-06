import type { NextApiRequest, NextApiResponse } from "next";
import {
  clearEmployeeSessionCookies,
  parseEmployeeSessionCookie,
} from "../../../../../lib/erp/employeeAuth";
import { createServiceRoleClient, getSupabaseEnv } from "../../../../../lib/serverSupabase";

type LogoutResponse = { ok: true } | { ok: false; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<LogoutResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const claims = parseEmployeeSessionCookie(req);
  if (!claims) {
    clearEmployeeSessionCookies(res);
    return res.status(200).json({ ok: true });
  }

  const { supabaseUrl, serviceRoleKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !serviceRoleKey || missing.length > 0) {
    return res.status(500).json({
      ok: false,
      error:
        "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const adminClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);

  const { error } = await adminClient.rpc("erp_employee_auth_logout", {
    p_session_token: claims.token,
  });

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  clearEmployeeSessionCookies(res);
  return res.status(200).json({ ok: true });
}
