import { createClient } from "@supabase/supabase-js";

const AUTHORIZED_ROLES = ["owner", "admin", "hr"];

export function getSupabaseEnv() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const missing = [];
  if (!supabaseUrl) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!anonKey) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!serviceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");

  return {
    supabaseUrl,
    anonKey,
    serviceKey,
    missing,
  };
}

export function createAnonClient(supabaseUrl, anonKey, accessToken) {
  return createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createServiceClient(supabaseUrl, serviceKey) {
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type AuthorizeSuccess = {
  ok: true;
  status: 200;
  companyId: string;
  roleKey: string;
  userId: string;
};

type AuthorizeFailure = {
  ok: false;
  status: number; // 401/403/etc
  error: string;
};

type AuthorizeResult = AuthorizeSuccess | AuthorizeFailure;

export async function authorizeHrAccess({
  supabaseUrl,
  anonKey,
  accessToken,
}: {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
}): Promise<AuthorizeResult> {
  if (!accessToken) {
    return { ok: false, status: 401, error: "Missing Authorization Bearer token" };
  }

  const anonClient = createAnonClient(supabaseUrl, anonKey, accessToken);

  const { data: userData, error: userErr } = await anonClient.auth.getUser();
  if (userErr || !userData?.user) {
    return { ok: false, status: 401, error: "Invalid session" };
  }

  const { data: membership, error: memberErr } = await anonClient
    .from("erp_company_users")
    .select("company_id, role_key, is_active")
    .eq("user_id", userData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (memberErr) return { ok: false, status: 403, error: memberErr.message };
  if (!membership) return { ok: false, status: 403, error: "No active company membership found" };
  if (!AUTHORIZED_ROLES.includes(membership.role_key)) return { ok: false, status: 403, error: "Not authorized" };

  return {
    ok: true,
    status: 200,
    companyId: membership.company_id,
    roleKey: membership.role_key,
    userId: userData.user.id,
  };
}


export async function getRoleUsageCount(adminClient, roleKey) {
  const [companyUsers, userRoles] = await Promise.all([
    adminClient
      .from("erp_company_users")
      .select("role_key", { count: "exact", head: true })
      .eq("role_key", roleKey),
    adminClient
      .from("erp_user_roles")
      .select("role_key", { count: "exact", head: true })
      .eq("role_key", roleKey),
  ]);

  if (companyUsers.error) return { error: companyUsers.error.message, count: 0 };
  if (userRoles.error) return { error: userRoles.error.message, count: 0 };

  return {
    count: (companyUsers.count || 0) + (userRoles.count || 0),
    error: null,
  };
}
