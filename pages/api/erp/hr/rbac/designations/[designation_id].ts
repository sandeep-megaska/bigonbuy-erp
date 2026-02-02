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

function getAccessToken(req: NextApiRequest) {
  const authHeader = req.headers.authorization || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
}

function resolveDesignationId(value: string | string[] | undefined) {
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
  if (missing.length) {
    return res.status(500).json({ ok: false, error: `Missing Supabase env vars: ${missing.join(", ")}` });
  }

  const accessTokenRaw = getAccessToken(req);
const accessToken = typeof accessTokenRaw === "string" ? accessTokenRaw.trim() : "";

if (!accessToken) {
  return res.status(401).json({ ok: false, error: "Authorization token is required" });
}

const authz = await authorizeHrAccess({ supabaseUrl, anonKey, accessToken });
if (authz.status !== 200) {
  return res.status(authz.status).json({ ok: false, error: authz.error });
}


  const adminClient = createServiceClient(supabaseUrl, serviceKey);

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
