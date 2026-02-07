import type { NextApiRequest, NextApiResponse } from "next";
import {
  createUserClient,
  getCookieAccessToken,
  getSupabaseEnv,
} from "../../../../lib/serverSupabase";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ ok: boolean; error?: string }>,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || missing.length > 0) {
    console.error("[vendor-portal-disable] Missing Supabase env", { missing });
    return res.status(500).json({
      ok: false,
      error:
        "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const accessToken = getCookieAccessToken(req);
  if (!accessToken) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) {
    console.error("[vendor-portal-disable] getUser failed", userError);
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  const { vendor_id, reason } = (req.body ?? {}) as Record<string, unknown>;
  const vendorId = typeof vendor_id === "string" ? vendor_id : "";
  if (!vendorId) return res.status(400).json({ ok: false, error: "vendor_id is required" });

  const { data: companyId, error: companyError } = await userClient.rpc("erp_current_company_id");
  if (companyError || !companyId) {
    console.error("[vendor-portal-disable] Failed to resolve company", companyError);
    return res.status(400).json({ ok: false, error: companyError?.message || "Failed to determine company" });
  }

  const { data: membership, error: membershipError } = await userClient
    .from("erp_company_users")
    .select("role_key")
    .eq("user_id", userData.user.id)
    .eq("company_id", companyId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    console.error("[vendor-portal-disable] Membership lookup failed", membershipError);
    return res.status(500).json({ ok: false, error: membershipError.message || "Authorization check failed" });
  }

  if (!membership || !["owner", "admin"].includes(membership.role_key ?? "")) {
    return res.status(403).json({ ok: false, error: "Not authorized" });
  }

  const { error } = await userClient.rpc("erp_vendor_portal_disable", {
    p_vendor_id: vendorId,
    p_company_id: companyId,
    p_reason: typeof reason === "string" ? reason : null,
  });

  if (error) {
    console.error("[vendor-portal-disable] RPC failed", error);
    return res.status(400).json({ ok: false, error: error.message || "Failed to disable portal" });
  }

  return res.status(200).json({ ok: true });
}
