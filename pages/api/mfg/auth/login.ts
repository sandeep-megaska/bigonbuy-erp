import type { NextApiRequest, NextApiResponse } from "next";
import { createAnonClient, getSupabaseEnv } from "../../../../lib/serverSupabase";

type ApiResponse =
  | { ok: true; vendor_code: string; must_reset_password: boolean }
  | { ok: false; error: string; details?: string | null };

function getCookie(req: NextApiRequest, name: string): string | null {
  const raw = req.headers.cookie || "";
  const parts = raw.split(";").map((p) => p.trim());
  for (const p of parts) {
    if (p.startsWith(name + "=")) return decodeURIComponent(p.slice(name.length + 1));
  }
  return null;
}

function setCookie(res: NextApiResponse, cookie: string) {
  const prev = res.getHeader("Set-Cookie");
  const next = typeof prev === "string" ? [prev, cookie] : Array.isArray(prev) ? [...prev, cookie] : [cookie];
  res.setHeader("Set-Cookie", next);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || missing.includes("NEXT_PUBLIC_SUPABASE_URL") || missing.includes("NEXT_PUBLIC_SUPABASE_ANON_KEY")) {
    return res.status(500).json({ ok: false, error: "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY" });
  }

  const { vendor_code, password } = (req.body ?? {}) as Record<string, unknown>;
  const code = typeof vendor_code === "string" ? vendor_code.trim() : "";
  const pwd = typeof password === "string" ? password : "";

  if (!code || !pwd) {
    return res.status(400).json({ ok: false, error: "vendor_code and password are required" });
  }

  const anon = createAnonClient(supabaseUrl, anonKey);

  const { data, error } = await anon.rpc("erp_mfg_vendor_login_v2", {
    p_vendor_code: code,
    p_password: pwd,
  });

  if (error) {
    return res.status(500).json({ ok: false, error: error.message || "Login failed", details: error.details || error.hint || error.code });
  }

  const payload = (data ?? {}) as any;
  if (!payload.ok) {
    return res.status(401).json({ ok: false, error: payload.error || "Invalid credentials" });
  }

  const sessionToken = String(payload.session_token || "");
  const expiresAt = payload.expires_at ? new Date(payload.expires_at) : null;
  const maxAge = expiresAt ? Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)) : 60 * 60 * 24 * 30;

  const secure = process.env.NODE_ENV === "production";
  const cookie = [
    `mfg_session=${encodeURIComponent(sessionToken)}`,
    "Path=/mfg",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");

  setCookie(res, cookie);

  return res.status(200).json({
    ok: true,
    vendor_code: String(payload.vendor_code || code),
    must_reset_password: Boolean(payload.must_reset_password),
  });
}
