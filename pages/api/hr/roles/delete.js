import {
  authorizeHrAccess,
  createServiceClient,
  getRoleUsageCount,
  getSupabaseEnv,
} from "../../../../lib/hrRoleApi";

export default async function handler(req, res) {
  if (req.method !== "POST") {
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

  const { key } = req.body || {};
  const keyTrimmed = typeof key === "string" ? key.trim() : "";

  if (!keyTrimmed) {
    return res.status(400).json({ ok: false, error: "key is required" });
  }

  const adminClient = createServiceClient(supabaseUrl, serviceKey);

  const { count, error: countErr } = await getRoleUsageCount(adminClient, keyTrimmed);
  if (countErr) {
    return res.status(500).json({ ok: false, error: countErr });
  }

  if (count > 0) {
    return res.status(400).json({ ok: false, error: "Cannot delete a role that is in use" });
  }

  const { error } = await adminClient.rpc("erp_hr_role_delete", {
    p_key: keyTrimmed,
  });
  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.status(200).json({ ok: true });
}
