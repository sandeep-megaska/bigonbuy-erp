import type { NextApiRequest, NextApiResponse } from "next";
import jwt from "jsonwebtoken";
import { createClient } from "@supabase/supabase-js";

const COOKIE_NAME = "mfg_session";

function setCookie(res: NextApiResponse, name: string, value: string) {
  const secure = process.env.NODE_ENV === "production";
  const parts = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
    // 7 days
    `Max-Age=${7 * 24 * 60 * 60}`,
  ].filter(Boolean);
  res.setHeader("Set-Cookie", parts.join("; "));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const vendor_code = typeof req.body?.vendor_code === "string" ? req.body.vendor_code.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (!vendor_code || !password) return res.status(400).json({ ok: false, error: "vendor_code and password required" });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const mfgSecret = process.env.MFG_SESSION_SECRET!;
  if (!url || !serviceKey || !mfgSecret) {
    return res.status(500).json({ ok: false, error: "Server missing env: SUPABASE_SERVICE_ROLE_KEY / MFG_SESSION_SECRET" });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data, error } = await admin.rpc("erp_mfg_vendor_login_v1", {
    p_vendor_code: vendor_code,
    p_password: password,
  });

  if (error) return res.status(400).json({ ok: false, error: error.message });

  if (!data?.ok) return res.status(401).json({ ok: false, error: data?.error || "Invalid credentials" });

  const token = jwt.sign(
    {
      vendor_id: data.vendor_id,
      company_id: data.company_id,
      vendor_code: data.vendor_code,
      must_reset_password: data.must_reset_password,
      typ: "mfg",
    },
    mfgSecret,
    { expiresIn: "7d" }
  );

  setCookie(res, COOKIE_NAME, token);
  return res.status(200).json({ ok: true, vendor_code: data.vendor_code, must_reset_password: data.must_reset_password });
}
