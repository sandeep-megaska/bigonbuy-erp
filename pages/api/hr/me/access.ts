import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../lib/serverSupabase";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
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

  const bearerToken = getBearerToken(req);
  if (!bearerToken) {
    return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token" });
  }

  const userClient = createUserClient(supabaseUrl, anonKey, bearerToken);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  const userId = userData.user.id;

  const [{ data: rpcIsManager, error: rpcError }, { data: membership, error: membershipError }] =
    await Promise.all([
      userClient.rpc("is_erp_manager", { uid: userId }),
      userClient
        .from("erp_company_users")
        .select("role_key, is_active")
        .eq("user_id", userId)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle(),
    ]);

  if (rpcError) {
    return res
      .status(500)
      .json({ ok: false, error: rpcError.message || "Authorization check failed" });
  }

  if (membershipError) {
    return res.status(500).json({ ok: false, error: membershipError.message });
  }

  return res.status(200).json({
    ok: true,
    isManager: Boolean(rpcIsManager),
    roleKey: membership?.role_key ?? null,
  });
}
