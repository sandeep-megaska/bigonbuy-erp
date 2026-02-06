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

function isAuthorizeFailure(
  x: unknown
): x is { status: number; error: string } {
  return (
    typeof x === "object" &&
    x !== null &&
    "status" in x &&
    (x as any).status !== 200 &&
    "error" in x &&
    typeof (x as any).error === "string"
  );
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  const hrDesignationId = resolveDesignationId(req.query.designation_id);
  if (!hrDesignationId) {
    return res.status(400).json({ ok: false, error: "designation_id is required" });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey, serviceKey, missing } = getSupabaseEnv();
  if (missing.length > 0) {
    return res
      .status(500)
      .json({ ok: false, error: `Missing Supabase env vars: ${missing.join(", ")}` });
  }

  const supabaseUrlValue = (supabaseUrl || "").trim();
  const anonKeyValue = (anonKey || "").trim();
  const serviceKeyValue = (serviceKey || "").trim();
  if (!supabaseUrlValue || !anonKeyValue || !serviceKeyValue) {
    return res.status(500).json({
      ok: false,
      error:
        "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const accessToken = (getAccessToken(req) || "").trim();
  if (!accessToken) {
    return res.status(401).json({ ok: false, error: "Authorization token is required" });
  }

  const authz = await authorizeHrAccess({
    supabaseUrl: supabaseUrlValue,
    anonKey: anonKeyValue,
    accessToken,
  });

  if (isAuthorizeFailure(authz)) {
    return res.status(authz.status).json({ ok: false, error: authz.error });
  }

  const adminClient = createServiceClient(supabaseUrlValue, serviceKeyValue);

  if (req.method === "GET") {
    const { data, error } = await adminClient.rpc("erp_rbac_hr_designation_permissions_get", {
      p_company_id: authz.companyId,
      p_hr_designation_id: hrDesignationId,
    });

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    return res.status(200).json({ ok: true, permissions: ((data as any) ?? []) as PermissionRow[] });
  }

  // POST: set a single permission (the UI can call repeatedly or you can batch later)
  const { perm_key: permKey, allowed } = req.body || {};
  const permKeyValue = typeof permKey === "string" ? permKey.trim() : "";
  if (!permKeyValue) {
    return res.status(400).json({ ok: false, error: "perm_key is required" });
  }
  if (typeof allowed !== "boolean") {
    return res.status(400).json({ ok: false, error: "allowed must be boolean" });
  }

  const { error } = await adminClient.rpc("erp_rbac_hr_designation_permissions_set", {
    p_company_id: authz.companyId,
    p_hr_designation_id: hrDesignationId,
    p_perm_key: permKeyValue,
    p_allowed: allowed,
  });

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  // return latest
  const { data, error: fetchErr } = await adminClient.rpc("erp_rbac_hr_designation_permissions_get", {
    p_company_id: authz.companyId,
    p_hr_designation_id: hrDesignationId,
  });

  if (fetchErr) {
    return res.status(200).json({ ok: true, permissions: [] });
  }

  return res.status(200).json({ ok: true, permissions: ((data as any) ?? []) as PermissionRow[] });
}
