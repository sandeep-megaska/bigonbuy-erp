import crypto from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { createServiceRoleClient, getSupabaseEnv } from "../serverSupabase";

export const EMPLOYEE_SESSION_COOKIE = "erp_emp_session";
const COOKIE_PATHS = ["/erp/employee", "/api/erp/employee"];

export type EmployeeSessionClaims = {
  companyId: string;
  token: string;
};

export type EmployeeSession = {
  employee_id: string;
  company_id: string;
  employee_code: string;
  display_name: string;
  roles: string[];
  permissions: string[];
};

export function buildEmployeeSessionCookieValue(
  companyId: string,
  token: string
): string {
  return `${companyId}:${token}`;
}

export function parseEmployeeSessionCookie(req: NextApiRequest): EmployeeSessionClaims | null {
  const cookieValue = req.cookies?.[EMPLOYEE_SESSION_COOKIE] || getCookieValue(req);
  if (!cookieValue) return null;
  const parts = cookieValue.split(":");
  if (parts.length === 2) {
    const [companyId, token] = parts;
    if (!companyId || !token) return null;
    return { companyId, token };
  }
  if (parts.length === 3) {
    const [companyId, , token] = parts;
    if (!companyId || !token) return null;
    return { companyId, token };
  }
  return null;
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

export function hashEmployeeSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function setEmployeeSessionCookies(
  res: NextApiResponse,
  value: string,
  maxAgeSeconds: number
) {
  const secure = process.env.NODE_ENV === "production";
  const base = `${EMPLOYEE_SESSION_COOKIE}=${encodeURIComponent(
    value
  )}; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
  const cookieHeaders = COOKIE_PATHS.map(
    (path) => `${base}; Path=${path};${secure ? " Secure;" : ""}`
  );
  res.setHeader("Set-Cookie", cookieHeaders);
}

export function clearEmployeeSessionCookies(res: NextApiResponse) {
  const secure = process.env.NODE_ENV === "production";
  const expires = "Thu, 01 Jan 1970 00:00:00 GMT";
  const base = `${EMPLOYEE_SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Expires=${expires}; Max-Age=0`;
  const cookieHeaders = COOKIE_PATHS.map(
    (path) => `${base}; Path=${path};${secure ? " Secure;" : ""}`
  );
  res.setHeader("Set-Cookie", cookieHeaders);
}

export async function getEmployeeSession(req: NextApiRequest): Promise<EmployeeSession | null> {
  const claims = parseEmployeeSessionCookie(req);
  if (!claims) return null;

  const { supabaseUrl, serviceRoleKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !serviceRoleKey || missing.length > 0) {
    return null;
  }

  const tokenHash = hashEmployeeSessionToken(claims.token);
  const adminClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await adminClient.rpc("erp_employee_session_get", {
    p_company_id: claims.companyId,
    p_session_token_hash: tokenHash,
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
