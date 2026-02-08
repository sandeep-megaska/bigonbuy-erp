import type { NextApiRequest } from "next";
import { createUserClient, getBearerToken, getCookieAccessToken, getSupabaseEnv } from "../serverSupabase";

export type InternalApiAuthResult =
  | {
      ok: true;
      userId: string;
      companyId: string;
      token: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

export async function resolveInternalApiAuth(req: NextApiRequest): Promise<InternalApiAuthResult> {
  const { supabaseUrl, anonKey } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey) {
    return { ok: false, status: 500, error: "Server misconfigured" };
  }

  const token = getBearerToken(req) || getCookieAccessToken(req);
  if (!token) {
    return { ok: false, status: 401, error: "Missing authorization token" };
  }

  const userClient = createUserClient(supabaseUrl, anonKey, token);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user?.id) {
    return { ok: false, status: 401, error: "Not authenticated" };
  }

  const { data: companyId, error: companyError } = await userClient.rpc("erp_current_company_id");
  if (companyError || !companyId) {
    return { ok: false, status: 400, error: companyError?.message || "Failed to resolve company" };
  }

  return {
    ok: true,
    userId: userData.user.id,
    companyId: String(companyId),
    token,
  };
}
