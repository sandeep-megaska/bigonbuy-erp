import type { NextApiRequest, NextApiResponse } from "next";
import { getAmazonAccessToken, spApiSignedFetch } from "../../../../lib/amazonSpApi";
import {
  createUserClient,
  getBearerToken,
  getSupabaseEnv,
} from "../../../../lib/serverSupabase";

type ErrorResponse = { ok: false; step?: string; error: unknown };

type SuccessResponse = {
  ok: true;
  message: string;
  marketplaces: unknown;
};

type ApiResponse = ErrorResponse | SuccessResponse;

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { supabaseUrl, anonKey, missing } = getSupabaseEnv();
    if (!supabaseUrl || !anonKey || missing.length > 0) {
      return res.status(500).json({
        ok: false,
        error:
          "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
      });
    }

    const internalToken = req.headers["x-internal-token"];
    const internalTokenValue = Array.isArray(internalToken) ? internalToken[0] : internalToken;
    const expectedToken = process.env.INTERNAL_ADMIN_TOKEN ?? null;
    const usingInternalToken = expectedToken && internalTokenValue === expectedToken;

    if (!usingInternalToken) {
      const bearerToken = getBearerToken(req);
      if (!bearerToken) {
        return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token" });
      }

      const userClient = createUserClient(supabaseUrl, anonKey, bearerToken);
      const { data: userData, error: userError } = await userClient.auth.getUser();
      if (userError || !userData?.user) {
        return res.status(401).json({ ok: false, error: "Not authenticated" });
      }

      const { data: membership, error: membershipError } = await userClient
        .from("erp_company_users")
        .select("role_key")
        .eq("user_id", userData.user.id)
        .eq("is_active", true)
        .maybeSingle();

      if (membershipError) {
        return res.status(500).json({ ok: false, error: membershipError.message });
      }

      const roleKey = membership?.role_key ?? null;
      const allowedRoles = ["owner", "admin", "inventory", "finance"];
      if (!roleKey || !allowedRoles.includes(roleKey)) {
        return res.status(403).json({ ok: false, error: "Not authorized to test connection" });
      }
    }

    const accessToken = await getAmazonAccessToken();

    const path = "/sellers/v1/marketplaceParticipations";
    const response = await spApiSignedFetch({
      method: "GET",
      path,
      accessToken,
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({
        ok: false,
        step: "sp-api-call",
        error: data,
      });
    }

    return res.json({
      ok: true,
      message: "Amazon SP-API connection successful",
      marketplaces: data.payload,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({
      ok: false,
      error: message,
    });
  }
}
