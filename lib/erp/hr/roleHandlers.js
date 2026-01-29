import {
  authorizeHrAccess,
  createServiceClient,
  getRoleUsageCount,
  getSupabaseEnv,
} from "../../hrRoleApi";

function getAccessToken(req) {
  const authHeader = req.headers.authorization || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
}

export async function handleRoleList(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, serviceKey, anonKey, missing } = getSupabaseEnv();
  if (missing.length) {
    return res
      .status(500)
      .json({ ok: false, error: `Missing Supabase env vars: ${missing.join(", ")}` });
  }

  const accessToken = getAccessToken(req);
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

export async function handleRoleCreate(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, serviceKey, anonKey, missing } = getSupabaseEnv();
  if (missing.length) {
    return res
      .status(500)
      .json({ ok: false, error: `Missing Supabase env vars: ${missing.join(", ")}` });
  }

  const accessToken = getAccessToken(req);
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

  const { error } = await adminClient.rpc("erp_hr_role_create", {
    p_key: keyTrimmed,
    p_name: nameTrimmed,
  });

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  const { count, error: countErr } = await getRoleUsageCount(adminClient, keyTrimmed);
  if (countErr) {
    return res.status(500).json({ ok: false, error: countErr });
  }

  return res
    .status(200)
    .json({ ok: true, role: { key: keyTrimmed, name: nameTrimmed, usageCount: count } });
}

export async function handleRoleUpdate(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, serviceKey, anonKey, missing } = getSupabaseEnv();
  if (missing.length) {
    return res
      .status(500)
      .json({ ok: false, error: `Missing Supabase env vars: ${missing.join(", ")}` });
  }

  const accessToken = getAccessToken(req);
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

  const { error } = await adminClient.rpc("erp_hr_role_update", {
    p_key: keyTrimmed,
    p_name: nameTrimmed,
  });

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.status(200).json({ ok: true });
}

export async function handleRoleDelete(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, serviceKey, anonKey, missing } = getSupabaseEnv();
  if (missing.length) {
    return res
      .status(500)
      .json({ ok: false, error: `Missing Supabase env vars: ${missing.join(", ")}` });
  }

  const accessToken = getAccessToken(req);
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
