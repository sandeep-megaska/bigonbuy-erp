import {
  authorizeHrAccess,
  createServiceClient,
  getRoleUsageCount,
  getSupabaseEnv,
} from "../../../../lib/hrRoleApi";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, serviceKey, anonKey, missing } = getSupabaseEnv();
  if (missing.length) {
    return res
      .status(500)
      .json({ ok: false, error: `Missing Supabase env vars: ${missing.join(", ")}` });
  }

  const authHeader = req.headers.authorization || "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  const authz = await authorizeHrAccess({ supabaseUrl, anonKey, accessToken });
  if (authz.status !== 200) {
    return res.status(authz.status).json({ ok: false, error: authz.error });
  }

  const adminClient = createServiceClient(supabaseUrl, serviceKey);

  const { data: roles, error } = await adminClient
    .from("erp_roles")
    .select("key, name")
    .order("key");

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  const rolesWithUsage = [];
  for (const role of roles || []) {
    const { count, error: countErr } = await getRoleUsageCount(adminClient, role.key);
    if (countErr) {
      return res.status(500).json({ ok: false, error: countErr });
    }
    rolesWithUsage.push({ ...role, usageCount: count });
  }

  return res.status(200).json({ ok: true, roles: rolesWithUsage });
}
