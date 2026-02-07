import type { NextApiRequest, NextApiResponse } from "next";
import { createServerSupabaseClient } from "@supabase/auth-helpers-nextjs";
import { getSupabaseEnv } from "../../../../lib/serverSupabase";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ ok: boolean; data?: any; error?: string }>,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || missing.length > 0) {
    console.error("[vendor-portal-enable] Missing Supabase env", { missing });
    return res.status(500).json({
      ok: false,
      error:
        "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const userClient = createServerSupabaseClient({ req, res });
  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();
  if (userError || !user) {
    console.error("[vendor-portal-enable] getUser failed", userError);
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  const { vendor_id } = (req.body ?? {}) as Record<string, unknown>;
  const vendorId = typeof vendor_id === "string" ? vendor_id : "";
  if (!vendorId) return res.status(400).json({ ok: false, error: "vendor_id is required" });

  const { data: companyId, error: companyError } = await userClient.rpc("erp_current_company_id");
  if (companyError || !companyId) {
    console.error("[vendor-portal-enable] Failed to resolve company", companyError);
    return res.status(400).json({ ok: false, error: companyError?.message || "Failed to determine company" });
  }

  const { data: membership, error: membershipError } = await userClient
    .from("erp_company_users")
    .select("role_key")
    .eq("user_id", user.id)
    .eq("company_id", companyId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    console.error("[vendor-portal-enable] Membership lookup failed", membershipError);
    return res.status(500).json({ ok: false, error: membershipError.message || "Authorization check failed" });
  }

  if (!membership || !["owner", "admin"].includes(membership.role_key ?? "")) {
    return res.status(403).json({ ok: false, error: "Not authorized" });
  }

  const { data, error } = await userClient.rpc("erp_vendor_portal_enable", {
    p_vendor_id: vendorId,
    p_company_id: companyId,
  });

  if (error) {
    console.error("[vendor-portal-enable] RPC failed", error);
    return res.status(400).json({ ok: false, error: error.message || "Failed to enable portal" });
  }

  return res.status(200).json({ ok: true, data: data?.[0] ?? null });
}
