// pages/api/mfg/admin/vendor-portal-enable.ts

import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; data: any };
type ApiResponse = ErrorResponse | SuccessResponse;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || (missing?.length ?? 0) > 0) {
    console.error("[mfg/admin/vendor-portal-enable] Missing Supabase env vars", { missing });
    return res.status(500).json({
      ok: false,
      error:
        "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY",
      details: (missing || []).join(", "),
    });
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return res
      .status(401)
      .json({ ok: false, error: "Missing Authorization: Bearer token" });
  }

  // User-scoped supabase client (uses Bearer token like existing HR/Finance APIs)
  const userClient = createUserClient(supabaseUrl, anonKey, accessToken);

  const { data: userData, error: userError } = await userClient.auth.getUser();
  const user = userData?.user ?? null;
  if (userError || !user) {
    console.error("[mfg/admin/vendor-portal-enable] getUser failed", userError);
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  const { vendor_id } = (req.body ?? {}) as Record<string, unknown>;
  const vendorId = typeof vendor_id === "string" ? vendor_id : "";
  if (!vendorId) {
    return res.status(400).json({ ok: false, error: "vendor_id is required" });
  }

  // Resolve company_id from canonical RPC
  const { data: companyId, error: companyError } = await userClient.rpc(
    "erp_current_company_id",
  );
  if (companyError || !companyId) {
    console.error("[mfg/admin/vendor-portal-enable] erp_current_company_id failed", companyError);
    return res.status(400).json({
      ok: false,
      error: companyError?.message || "Failed to determine company",
      details: companyError?.details || companyError?.hint || companyError?.code || null,
    });
  }

  // Owner/Admin only
  const { data: membership, error: membershipError } = await userClient
    .from("erp_company_users")
    .select("role_key, is_active")
    .eq("user_id", user.id)
    .eq("company_id", companyId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    console.error("[mfg/admin/vendor-portal-enable] membership lookup failed", membershipError);
    return res.status(500).json({
      ok: false,
      error: membershipError.message || "Authorization check failed",
      details: membershipError.details || membershipError.hint || membershipError.code || null,
    });
  }

  const roleKey = (membership?.role_key ?? "").toLowerCase();
  if (!membership || !["owner", "admin"].includes(roleKey)) {
    return res.status(403).json({ ok: false, error: "Not authorized" });
  }

  // Call vendor portal enable RPC
  const { data, error } = await userClient.rpc("erp_vendor_portal_enable", {
    p_vendor_id: vendorId,
    p_company_id: companyId,
  });

  if (error) {
    console.error("[mfg/admin/vendor-portal-enable] RPC failed", error);
    return res.status(400).json({
      ok: false,
      error: error.message || "Failed to enable vendor portal",
      details: error.details || error.hint || error.code || null,
    });
  }

  // Supabase RPC returns rows for returns table; use first row.
  return res.status(200).json({ ok: true, data: Array.isArray(data) ? data[0] ?? null : data });
}
