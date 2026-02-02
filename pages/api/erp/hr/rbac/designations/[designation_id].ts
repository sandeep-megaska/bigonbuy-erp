import type { NextApiRequest, NextApiResponse } from "next";
import { authorizeHrAccess, createServiceClient, getSupabaseEnv } from "lib/hrRoleApi";

type PermissionRow = {
  perm_key: string;
  label: string;
  module_key: string;
  allowed: boolean;
};

type ApiResponse =
  | { ok: true; permissions: PermissionRow[] }
  | { ok: false; error: string };

function getAccessToken(req: NextApiRequest): string | null {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  return token ? token : null;
}

function resolveDesignationId(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  const designationId = resolveDesignationId(req.query.designation_id);
  if (!designationId) {
    return res.status(400).json({ ok: false, error: "designation_id is required" });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey, serviceKey, missing } = getSupabaseEnv();

  const supabaseUrlValue = typeof supabaseUrl === "string" ? supabaseUrl.trim() : "";
  const anonKeyValue = typeof anonKey === "string" ? anonKey.trim() : "";
  const serviceKeyValue = typeof serviceKey === "string" ? serviceKey.trim() : "";

  if (!supabaseUrlValue || !anonKeyValue || !serviceKeyValue || (missing?.length ?? 0) > 0) {
    return res.status(500).json({
      ok: false,
      error: `Missing Supabase env vars: ${(missing && missing.length ? missing.join(", ") : "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY")}`,
    });
  }

  const accessToken = getAccessToken(req);
  if (!accessToken) {
    return res.status(401).json({ ok: false, error: "Authorization token is required" });
  }

  // ✅ IMPORTANT: use the *Value vars* (guaranteed strings)
  const authz = await authorizeHrAccess({
    supabaseUrl: supabaseUrlValue,
    anonKey: anonKeyValue,
    accessToken,
  });

  if (authz.status !== 200) {
    return res.status(authz.status).json({ ok: false, error: authz.error });
  }

  // ✅ IMPORTANT: use the *Value vars* (guaranteed strings)
  const adminClient = createServiceClient(supabaseUrlValue, serviceKeyValue);

  if (req.method === "GET") {
    const { data, error } = await adminClient.rpc("erp_rbac_designation_permissions_get", {
      p_company_id: authz.companyId,
      p_designation_id: designationId,
    });

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    return res.status(200).json({ ok: true, permissions: (data as PermissionRow[]) ?? [] });
  }

  const { perm_key: permKey, allowed } = req.body || {};
  const permKeyValue = typeof permKey === "string" ? permKey.trim() : "";
  if (!permKeyValue) {
    return res.status(400).json({ ok: false, error: "perm_key is required" });
  }

  if (typeof allowed !== "boolean") {
    return res.status(400).json({ ok: false, error: "allowed must be boolean" });
  }

  const { error } = await adminClient.rpc("erp_rbac_designation_permissions_set", {
    p_company_id: authz.companyId,
    p_designation_id: designationId,
    p_perm_key: permKeyValue,
    p_allowed: allowed,
  });

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.status(200).json({ ok: true, permissions: [] });
}
