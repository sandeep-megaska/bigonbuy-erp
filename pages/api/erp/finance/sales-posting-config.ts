import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };

type SuccessResponse = {
  ok: true;
  data: {
    company_id?: string | null;
    id?: string | null;
    sales_revenue_account_id?: string | null;
    gst_output_account_id?: string | null;
    receivable_account_id?: string | null;
    is_active?: boolean | null;
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
      const { data, error } = await userClient.rpc("erp_sales_finance_posting_config_get");
      if (error) {
        return res.status(400).json({
          ok: false,
          error: error.message || "Failed to load sales posting config",
          details: error.details || error.hint || error.code,
        });
      }

      return res.status(200).json({ ok: true, data: data ?? null });
    }

    const payload = (req.body ?? {}) as {
      salesRevenueAccountId?: string | null;
      gstOutputAccountId?: string | null;
      receivableAccountId?: string | null;
    };

    const { error } = await userClient.rpc("erp_sales_finance_posting_config_upsert", {
      p_sales_revenue_account_id: payload.salesRevenueAccountId ?? null,
      p_gst_output_account_id: payload.gstOutputAccountId ?? null,
      p_receivable_account_id: payload.receivableAccountId ?? null,
    });

    if (error) {
      return res.status(400).json({
        ok: false,
        error: error.message || "Failed to update sales posting config",
        details: error.details || error.hint || error.code,
      });
    }

    return res.status(200).json({ ok: true, data: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
