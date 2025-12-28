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

  const { key, name } = req.body || {};
  const keyTrimmed = typeof key === "string" ? key.trim() : "";
  const nameTrimmed = typeof name === "string" ? name.trim() : "";

  if (!keyTrimmed || !nameTrimmed) {
    return res.status(400).json({ ok: false, error: "key and name are required" });
  }

  if (!/^[a-z0-9_]+$/.test(keyTrimmed)) {
    return res
      .status(400)
      .json({ ok: false, error: "Key must be lowercase and use a-z, 0-9, underscore only" });
  }

  const adminClient = createServiceClient(supabaseUrl, serviceKey);

  const { error } = await adminClient.from("erp_roles").insert({
    key: keyTrimmed,
    name: nameTrimmed,
  });

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  // return usage count (should be 0 on creation) for consistency
  const { count, error: countErr } = await getRoleUsageCount(adminClient, keyTrimmed);
  if (countErr) {
    return res.status(500).json({ ok: false, error: countErr });
  }

  return res.status(200).json({ ok: true, role: { key: keyTrimmed, name: nameTrimmed, usageCount: count } });
}
