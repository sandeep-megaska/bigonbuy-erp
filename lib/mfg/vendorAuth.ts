import type { NextApiRequest, NextApiResponse } from "next";
import { createServiceRoleClient, getSupabaseEnv } from "../serverSupabase";

export const VENDOR_SESSION_COOKIE = "mfg_vendor_session";

export type VendorSession = {
  company_id: string;
  vendor_id: string;
  vendor_code: string;
  display_name: string;
  must_reset_password: boolean;
  role_keys: string[];
};

export function parseVendorSessionCookie(req: NextApiRequest): { token: string } | null {
  const token = req.cookies?.[VENDOR_SESSION_COOKIE]?.trim();
  if (!token) return null;
  return { token };
}

export function setVendorSessionCookie(res: NextApiResponse, value: string, maxAgeSeconds: number) {
  const secure = process.env.NODE_ENV === "production";
  const cookie = `${VENDOR_SESSION_COOKIE}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}; Path=/;${secure ? " Secure;" : ""}`;
  res.setHeader("Set-Cookie", cookie);
}

export function clearVendorSessionCookie(res: NextApiResponse) {
  const secure = process.env.NODE_ENV === "production";
  const expires = "Thu, 01 Jan 1970 00:00:00 GMT";
  const cookie = `${VENDOR_SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Expires=${expires}; Max-Age=0; Path=/;${secure ? " Secure;" : ""}`;
  res.setHeader("Set-Cookie", cookie);
}

export async function getVendorSession(req: NextApiRequest): Promise<VendorSession | null> {
  const claims = parseVendorSessionCookie(req);
  if (!claims) return null;

  const { supabaseUrl, serviceRoleKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !serviceRoleKey || missing.length > 0) return null;

  const adminClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await adminClient.rpc("erp_vendor_auth_session_get", {
    p_session_token: claims.token,
  });

  if (error || !data) return null;
  const session = Array.isArray(data) ? data[0] : data;
  return (session as VendorSession) ?? null;
}
