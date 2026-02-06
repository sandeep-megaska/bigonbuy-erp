import type { NextApiRequest, NextApiResponse } from "next";
import { parseEmployeeSessionCookie } from "../../../../../lib/erp/employeeAuth";
import { createServiceRoleClient, getSupabaseEnv } from "../../../../../lib/serverSupabase";

type ChangePasswordResponse = { ok: true } | { ok: false; error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ChangePasswordResponse>
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const claims = parseEmployeeSessionCookie(req);
  if (!claims) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  const { supabaseUrl, serviceRoleKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !serviceRoleKey || missing.length > 0) {
    return res.status(500).json({
      ok: false,
      error:
        "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const { old_password, new_password } = (req.body ?? {}) as Record<string, unknown>;
  const oldPassword = typeof old_password === "string" ? old_password : "";
  const newPassword = typeof new_password === "string" ? new_password : "";

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ ok: false, error: "old_password and new_password are required" });
  }

  const adminClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);
  const { error } = await adminClient.rpc("erp_employee_auth_change_password", {
    p_session_token: claims.token,
    p_old_password: oldPassword,
    p_new_password: newPassword,
  });

  if (error) {
    const message = error.message || "Unable to change password";
    if (
      ["Invalid password", "Session expired", "Session revoked", "Session not found"].includes(message)
    ) {
      return res.status(401).json({ ok: false, error: message });
    }
    return res.status(400).json({ ok: false, error: message });
  }

  return res.status(200).json({ ok: true });
}
