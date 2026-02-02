import type { NextApiRequest, NextApiResponse } from "next";
import { canBypassMakerChecker } from "lib/erp/featureFlags";
import { createUserClient, getBearerToken, getSupabaseEnv, getUserRoleKey } from "lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; data: unknown };
type ApiResponse = ErrorResponse | SuccessResponse;

type PostPayload = {
  billId?: string | null;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || missing.length > 0) {
    return res.status(500).json({
      ok: false,
      error:
        "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token" });
  }

  const payload = (req.body ?? {}) as PostPayload;
  if (!payload.billId) {
    return res.status(400).json({ ok: false, error: "billId is required" });
  }

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const roleKey = await getUserRoleKey(userClient, userData.user.id);
    const rpcPayload: Record<string, unknown> = { p_bill_id: payload.billId };
    if (canBypassMakerChecker(roleKey)) {
      rpcPayload.p_use_maker_checker = false;
    }

    const { data, error } = await userClient.rpc("erp_ap_vendor_bill_post", rpcPayload);

    if (error) {
      return res.status(400).json({
        ok: false,
        error: error.message || "Failed to post vendor bill",
        details: error.details || error.hint || error.code,
      });
    }

    return res.status(200).json({ ok: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
