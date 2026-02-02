import type { NextApiRequest, NextApiResponse } from "next";
import {
  buildEmployeeSessionCookieValue,
  setEmployeeSessionCookies,
} from "../../../../../lib/erp/employeeAuth";
import { createServiceRoleClient, getSupabaseEnv } from "../../../../../lib/serverSupabase";

type LoginResponse =
  | { ok: true; session: { employee_id: string; company_id: string; employee_code: string } }
  | { ok: false; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<LoginResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, serviceRoleKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !serviceRoleKey || missing.length > 0) {
    return res.status(500).json({
      ok: false,
      error:
        "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const { employee_code, password } = (req.body ?? {}) as Record<string, unknown>;
  const employeeCode = typeof employee_code === "string" ? employee_code.trim() : "";
  const passwordRaw = typeof password === "string" ? password : "";

  if (!employeeCode || !passwordRaw) {
    return res.status(400).json({ ok: false, error: "employee_code and password are required" });
  }

  const adminClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);

  const forwardedFor = req.headers["x-forwarded-for"];
  const forwardedValue = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const ipValue = forwardedValue?.split(",")[0].trim() || req.socket.remoteAddress || null;

  const { data: loginRows, error: loginError } = await adminClient.rpc("erp_employee_auth_login", {
    p_employee_code: employeeCode,
    p_password: passwordRaw,
    p_ip: ipValue,
    p_user_agent: req.headers["user-agent"] || null,
  });

  if (loginError) {
    const message = loginError.message || "Unable to sign in";
    if (message === "Invalid employee credentials") {
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }
    if (message === "Employee login is disabled") {
      return res.status(403).json({ ok: false, error: message });
    }
    return res.status(500).json({ ok: false, error: message });
  }

  const loginRow = Array.isArray(loginRows) ? loginRows[0] : loginRows;
  if (!loginRow?.session_token) {
    return res.status(500).json({ ok: false, error: "Unable to create session" });
  }

  const expiresAt = loginRow.expires_at ? new Date(loginRow.expires_at) : null;
  const maxAgeSeconds = expiresAt
    ? Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
    : 60 * 60 * 24 * 30;

  const cookieValue = buildEmployeeSessionCookieValue(loginRow.company_id, loginRow.session_token);

  setEmployeeSessionCookies(res, cookieValue, maxAgeSeconds);

  return res.status(200).json({
    ok: true,
    session: {
      employee_id: loginRow.employee_id,
      company_id: loginRow.company_id,
      employee_code: loginRow.employee_code,
    },
  });
}
