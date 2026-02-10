import type { NextApiRequest } from "next";
import { createServiceRoleClient, createUserClient, getSupabaseEnv } from "../../serverSupabase";
import { resolveInternalApiAuth } from "../../erp/internalApiAuth";

export const OWNER_ADMIN_ROLE_KEYS = new Set(["owner", "admin"]);

export const parseDateParam = (value: string | string[] | undefined) => {
  if (!value) return null;
  const raw = Array.isArray(value) ? value[0] : value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return raw;
};

export const parseLimitParam = (value: string | string[] | undefined, fallback = 100) => {
  if (!value) return fallback;
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 500);
};

export async function resolveMarketingApiContext(req: NextApiRequest) {
  const auth = await resolveInternalApiAuth(req);
  if (!auth.ok) return auth;

  const { supabaseUrl, anonKey, serviceRoleKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || !serviceRoleKey || missing.length > 0) {
    return {
      ok: false as const,
      status: 500,
      error:
        "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
    };
  }

  const userClient = createUserClient(supabaseUrl, anonKey, auth.token);
  const serviceClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);

  const { data: membership, error: membershipError } = await serviceClient
    .from("erp_company_users")
    .select("role_key")
    .eq("company_id", auth.companyId)
    .eq("user_id", auth.userId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (membershipError || !membership?.role_key) {
    return {
      ok: false as const,
      status: 403,
      error: "Company membership not found",
    };
  }

  return {
    ok: true as const,
    userId: auth.userId,
    companyId: auth.companyId,
    roleKey: membership.role_key,
    userClient,
    serviceClient,
  };
}
