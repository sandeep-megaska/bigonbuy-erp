import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };

type SuccessResponse = {
  ok: true;
  data: {
    company_id?: string | null;
    id?: string | null;
    is_active?: boolean | null;
    razorpay_clearing_account_id?: string | null;
    bank_account_id?: string | null;
    gateway_fees_account_id?: string | null;
    gst_input_on_fees_account_id?: string | null;
    razorpay_key_id?: string | null;
    has_key_secret?: boolean;
    updated_at?: string | null;
  } | null;
};

type ApiResponse = ErrorResponse | SuccessResponse;

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
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

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    if (req.method === "GET") {
      const { data, error } = await userClient.rpc("erp_razorpay_settlement_config_get");
      if (error) {
        return res.status(400).json({
          ok: false,
          error: error.message || "Failed to load Razorpay settlement config",
          details: error.details || error.hint || error.code,
        });
      }

      if (!data) {
        return res.status(200).json({ ok: true, data: null });
      }

      return res.status(200).json({
        ok: true,
        data: {
          company_id: data.company_id ?? null,
          id: data.id ?? null,
          is_active: data.is_active ?? null,
          razorpay_clearing_account_id: data.razorpay_clearing_account_id ?? null,
          bank_account_id: data.bank_account_id ?? null,
          gateway_fees_account_id: data.gateway_fees_account_id ?? null,
          gst_input_on_fees_account_id: data.gst_input_on_fees_account_id ?? null,
          razorpay_key_id: data.razorpay_key_id ?? null,
          has_key_secret: Boolean(data.razorpay_key_secret),
          updated_at: data.updated_at ?? null,
        },
      });
    }

    const payload = (req.body ?? {}) as {
      razorpayKeyId?: string | null;
      razorpayKeySecret?: string | null;
      razorpayClearingAccountId?: string | null;
      bankAccountId?: string | null;
      gatewayFeesAccountId?: string | null;
      gstInputOnFeesAccountId?: string | null;
    };

    let keySecret = payload.razorpayKeySecret?.trim() || null;
    if (!keySecret) {
      const { data: existingConfig } = await userClient.rpc("erp_razorpay_settlement_config_get");
      keySecret = existingConfig?.razorpay_key_secret ?? null;
    }

    const keyId = payload.razorpayKeyId?.trim() || null;
    if (!keyId) {
      return res.status(400).json({ ok: false, error: "Razorpay key id is required" });
    }

    if (!keySecret) {
      return res.status(400).json({ ok: false, error: "Razorpay key secret is required" });
    }

    const { data: configId, error } = await userClient.rpc("erp_razorpay_settlement_config_upsert", {
      p_razorpay_key_id: keyId,
      p_razorpay_key_secret: keySecret,
      p_razorpay_clearing_account_id: payload.razorpayClearingAccountId ?? null,
      p_bank_account_id: payload.bankAccountId ?? null,
      p_gateway_fees_account_id: payload.gatewayFeesAccountId ?? null,
      p_gst_input_on_fees_account_id: payload.gstInputOnFeesAccountId ?? null,
    });

    if (error) {
      return res.status(400).json({
        ok: false,
        error: error.message || "Failed to update Razorpay settlement config",
        details: error.details || error.hint || error.code,
      });
    }

    return res.status(200).json({ ok: true, data: { id: configId ?? null } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
