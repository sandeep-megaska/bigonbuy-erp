import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../lib/serverSupabase";

type CompanyUserRow = {
  user_id: string;
  email: string | null;
  role_key: string;
  created_at: string | null;
  updated_at: string | null;
};

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; users: CompanyUserRow[] };
type ApiResponse = ErrorResponse | SuccessResponse;

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey) {
    return res.status(500).json({
      ok: false,
      error: "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY",
    });
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token" });
  }

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const { data: isManager, error: managerError } = await userClient.rpc("is_erp_manager", {
      uid: userData.user.id,
    });
    if (managerError || !isManager) {
      return res
        .status(managerError ? 500 : 403)
        .json({ ok: false, error: managerError?.message || "Not authorized" });
    }

    const { data: users, error: listError } = await userClient.rpc("erp_list_company_users");
    if (listError) {
      return res.status(500).json({
        ok: false,
        error: listError.message || "Failed to fetch company users",
        details: listError.details || listError.hint || listError.code,
      });
    }

    return res.status(200).json({ ok: true, users: users || [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
