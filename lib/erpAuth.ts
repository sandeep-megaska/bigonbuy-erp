import type { NextApiRequest } from "next";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createUserClient, getBearerToken, getSupabaseEnv } from "./serverSupabase";

type ManagerAuthSuccess = {
  ok: true;
  userClient: SupabaseClient;
  user: User;
};

type ManagerAuthFailure = {
  ok: false;
  status: number;
  error: string;
};

export function isManagerRole(roleKey?: string | null): boolean {
  return roleKey === "owner" || roleKey === "admin" || roleKey === "hr";
}

export async function requireManager(
  req: NextApiRequest,
): Promise<ManagerAuthSuccess | ManagerAuthFailure> {
  const { supabaseUrl, anonKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || missing.length > 0) {
    return {
      ok: false,
      status: 500,
      error:
        "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
    };
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return { ok: false, status: 401, error: "Missing Authorization: Bearer token" };
  }

  const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
  const { data: userData, error: sessionError } = await userClient.auth.getUser();
  if (sessionError || !userData?.user) {
    return { ok: false, status: 401, error: "Not authenticated" };
  }

  const { data: isManager, error: managerError } = await userClient.rpc("is_erp_manager", {
    uid: userData.user.id,
  });

  if (managerError) {
    return {
      ok: false,
      status: 500,
      error: managerError.message || "Authorization check failed",
    };
  }

  if (!isManager) {
    return { ok: false, status: 403, error: "Not authorized" };
  }

  return { ok: true, userClient, user: userData.user };
}
