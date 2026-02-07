import type { NextApiRequest, NextApiResponse } from "next";
import { createServiceRoleClient, getSupabaseEnv } from "../../../../lib/serverSupabase";
import { setVendorSessionCookie } from "../../../../lib/mfg/vendorAuth";

type LoginResponse =
  | { ok: true; session: { vendor_id: string; company_id: string; vendor_code: string; display_name: string; must_reset_password: boolean } }
  | { ok: false; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<LoginResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, serviceRoleKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !serviceRoleKey || missing.length > 0) {
    return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });
  }

  const { vendor_code, password } = (req.body ?? {}) as Record<string, unknown>;
  const vendorCode = typeof vendor_code === "string" ? vendor_code.trim().toUpperCase() : "";
  const passwordRaw = typeof password === "string" ? password : "";
  if (!vendorCode || !passwordRaw) {
    return res.status(400).json({ ok: false, error: "vendor_code and password are required" });
  }

  const adminClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);
  const forwardedFor = req.headers["x-forwarded-for"];
  const forwardedValue = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const ipValue = forwardedValue?.split(",")[0].trim() || req.socket.remoteAddress || null;

  const { data: loginRows, error: loginError } = await adminClient.rpc("erp_vendor_auth_login", {
    p_vendor_code: vendorCode,
    p_password: passwordRaw,
    p_ip: ipValue,
    p_user_agent: req.headers["user-agent"] || null,
  });

  if (loginError) {
    const message = loginError.message || "Unable to sign in";
    if (message === "Invalid vendor credentials") {
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }
    return res.status(400).json({ ok: false, error: message });
  }

  const loginRow = Array.isArray(loginRows) ? loginRows[0] : loginRows;
  if (!loginRow?.session_token) {
    return res.status(500).json({ ok: false, error: "Unable to create session" });
  }

  const { data: sessionRows, error: sessionError } = await adminClient.rpc("erp_vendor_auth_session_get", {
    p_session_token: loginRow.session_token,
  });

  if (sessionError) {
    return res.status(500).json({ ok: false, error: sessionError.message || "Unable to sign in" });
  }

  const sessionRow = Array.isArray(sessionRows) ? sessionRows[0] : sessionRows;
  const expiresAt = loginRow.expires_at ? new Date(loginRow.expires_at) : null;
  const maxAgeSeconds = expiresAt ? Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)) : 60 * 60 * 24 * 30;
  setVendorSessionCookie(res, loginRow.session_token, maxAgeSeconds);

  return res.status(200).json({
    ok: true,
    session: {
      vendor_id: loginRow.vendor_id,
      company_id: loginRow.company_id,
      vendor_code: loginRow.vendor_code,
      display_name: loginRow.display_name,
      must_reset_password: Boolean(sessionRow?.must_reset_password),
    },
  });
}
