import type { NextApiRequest, NextApiResponse } from "next";
import { randomBytes, createHash } from "crypto";
import bcrypt from "bcryptjs";
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

  const { data: authRows, error: authError } = await adminClient.rpc("erp_employee_auth_user_get", {
    p_employee_code: employeeCode,
  });

  if (authError) {
    return res.status(500).json({ ok: false, error: authError.message });
  }

  const authRow = Array.isArray(authRows) ? authRows[0] : authRows;
  if (!authRow || !authRow.password_hash) {
    return res.status(401).json({ ok: false, error: "Invalid credentials" });
  }

  if (!authRow.is_active) {
    return res.status(403).json({ ok: false, error: "Employee login is disabled" });
  }

  const matches = await bcrypt.compare(passwordRaw, authRow.password_hash);
  if (!matches) {
    return res.status(401).json({ ok: false, error: "Invalid credentials" });
  }

  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);

  const { data: sessionRows, error: sessionError } = await adminClient.rpc(
    "erp_employee_session_create",
    {
      p_company_id: authRow.company_id,
      p_employee_code: employeeCode,
      p_token_hash: tokenHash,
      p_expires_at: expiresAt.toISOString(),
      p_ip: req.headers["x-forwarded-for"]?.toString() || req.socket.remoteAddress || null,
      p_user_agent: req.headers["user-agent"] || null,
    }
  );

  if (sessionError) {
    return res.status(500).json({ ok: false, error: sessionError.message });
  }

  const sessionRow = Array.isArray(sessionRows) ? sessionRows[0] : sessionRows;
  if (!sessionRow?.session_id) {
    return res.status(500).json({ ok: false, error: "Unable to create session" });
  }

  const cookieValue = buildEmployeeSessionCookieValue(
    authRow.company_id,
    sessionRow.session_id,
    token
  );

  setEmployeeSessionCookies(res, cookieValue, 60 * 60 * 24 * 30);

  return res.status(200).json({
    ok: true,
    session: {
      employee_id: sessionRow.employee_id,
      company_id: authRow.company_id,
      employee_code: authRow.employee_code,
    },
  });
}
