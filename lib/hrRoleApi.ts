import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type SupabaseEnv = {
  supabaseUrl: string | undefined;
  anonKey: string | undefined;
  serviceKey: string | undefined;
  missing: string[];
};

type AuthorizeParams = {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string | null;
};

export type AuthorizeSuccess = {
  ok: true;
  status: 200;
  companyId: string;
  roleKey: string;
  userId: string;
};

export type AuthorizeFailure = {
  ok: false;
  status: number;
  error: string;
};

export type AuthorizeResult = AuthorizeSuccess | AuthorizeFailure;


type RoleUsageCountResult = {
  count: number;
  error: string | null;
};

const AUTHORIZED_ROLES = ["owner", "admin", "hr"] as const;

export function getSupabaseEnv(): SupabaseEnv {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const missing: string[] = [];
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

export function createAnonClient(
  supabaseUrl: string,
  anonKey: string,
  accessToken: string,
): SupabaseClient {
  return createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createServiceClient(supabaseUrl: string, serviceKey: string): SupabaseClient {
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function authorizeHrAccess({
  supabaseUrl,
  anonKey,
  accessToken,
}: AuthorizeParams): Promise<AuthorizeSuccess | AuthorizeFailure> {
  if (!accessToken) {
    return { status: 401, error: "Missing Authorization Bearer token" };
  }

  const anonClient = createAnonClient(supabaseUrl, anonKey, accessToken);

  const { data: userData, error: userErr } = await anonClient.auth.getUser();
  if (userErr || !userData?.user) {
    return { status: 401, error: "Invalid session" };
  }

  const { data: membership, error: memberErr } = await anonClient
    .from("erp_company_users")
    .select("company_id, role_key, is_active")
    .eq("user_id", userData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (memberErr) return { status: 403, error: memberErr.message };
  if (!membership) return { status: 403, error: "No active company membership found" };
  if (!AUTHORIZED_ROLES.includes(membership.role_key)) return { status: 403, error: "Not authorized" };

  return {
    status: 200,
    companyId: membership.company_id,
    roleKey: membership.role_key,
    userId: userData.user.id,
  };
}

export async function getRoleUsageCount(
  adminClient: SupabaseClient,
  roleKey: string,
): Promise<RoleUsageCountResult> {
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
