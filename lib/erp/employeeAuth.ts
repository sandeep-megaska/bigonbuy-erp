import type { NextApiRequest, NextApiResponse } from "next";
import { createServiceRoleClient, getSupabaseEnv } from "../serverSupabase";

export const EMPLOYEE_SESSION_COOKIE = "erp_employee_session";

export type EmployeeSessionClaims = {
  token: string;
};

export type EmployeeSession = {
  employee_id: string;
  company_id: string;
  employee_code: string;
  display_name: string;
  must_reset_password: boolean;
  role_keys: string[];
};

export function buildEmployeeSessionCookieValue(token: string): string {
  return token;
}

export function parseEmployeeSessionCookie(req: NextApiRequest): EmployeeSessionClaims | null {
  const cookieValue = req.cookies?.[EMPLOYEE_SESSION_COOKIE] || getCookieValue(req);
  if (!cookieValue) return null;
  const token = cookieValue.trim();
  if (!token) return null;
  return { token };
}

function getCookieValue(req: NextApiRequest): string | null {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";").map((part) => part.trim());
  const tokenPart = parts.find((part) => part.startsWith(`${EMPLOYEE_SESSION_COOKIE}=`));
  if (!tokenPart) return null;
  const value = tokenPart.slice(`${EMPLOYEE_SESSION_COOKIE}=`.length);
  return value ? decodeURIComponent(value) : null;
}

export function setEmployeeSessionCookies(
  res: NextApiResponse,
  value: string,
  maxAgeSeconds: number
) {
  const secure = process.env.NODE_ENV === "production";
  const base = `${EMPLOYEE_SESSION_COOKIE}=${encodeURIComponent(
    value
  )}; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}; Path=/;${secure ? " Secure;" : ""}`;
  res.setHeader("Set-Cookie", base);
}

export function clearEmployeeSessionCookies(res: NextApiResponse) {
  const secure = process.env.NODE_ENV === "production";
  const expires = "Thu, 01 Jan 1970 00:00:00 GMT";
  const base = `${EMPLOYEE_SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Expires=${expires}; Max-Age=0; Path=/;${
    secure ? " Secure;" : ""
  }`;
  res.setHeader("Set-Cookie", base);
}

export async function getEmployeeSession(req: NextApiRequest): Promise<EmployeeSession | null> {
  const claims = parseEmployeeSessionCookie(req);
  if (!claims) return null;

  const { supabaseUrl, serviceRoleKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !serviceRoleKey || missing.length > 0) {
    return null;
  }

  const adminClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await adminClient.rpc("erp_employee_auth_session_get", {
    p_session_token: claims.token,
  });

  if (error || !data) {
    return null;
  }

  const session = Array.isArray(data) ? data[0] : data;
  if (!session) return null;
  return session as EmployeeSession;
}

export async function requireEmployeeSession(req: NextApiRequest, res: NextApiResponse) {
  const session = await getEmployeeSession(req);
  if (!session) {
    res.status(401).json({ ok: false, error: "Not authenticated" });
    return null;
  }
  return session;
}
