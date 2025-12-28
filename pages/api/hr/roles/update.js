import { authorizeHrAccess, createServiceClient, getSupabaseEnv } from "../../../../lib/hrRoleApi";

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

  const adminClient = createServiceClient(supabaseUrl, serviceKey);

  const { data, error } = await adminClient
    .from("erp_roles")
    .update({ name: nameTrimmed })
    .eq("key", keyTrimmed)
    .select("key")
    .maybeSingle();

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  if (!data) {
    return res.status(404).json({ ok: false, error: "Role not found" });
  }

  return res.status(200).json({ ok: true });
}
