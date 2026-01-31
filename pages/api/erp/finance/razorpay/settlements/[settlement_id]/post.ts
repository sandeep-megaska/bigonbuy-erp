import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../../../lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; data: { journal_id: string | null } };
type ApiResponse = ErrorResponse | SuccessResponse;

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

  const settlementId = Array.isArray(req.query.settlement_id)
    ? req.query.settlement_id[0]
    : req.query.settlement_id;
  if (!settlementId) {
    return res.status(400).json({ ok: false, error: "Settlement id is required" });
  }

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const payload = (req.body ?? {}) as { idempotency_key?: string | null };
    const { data: journalId, error } = await userClient.rpc("erp_razorpay_settlement_post", {
      p_razorpay_settlement_id: settlementId,
      p_idempotency_key: payload.idempotency_key ?? null,
    });

    if (error) {
      return res.status(400).json({
        ok: false,
        error: error.message || "Failed to post settlement",
        details: error.details || error.hint || error.code,
      });
    }

    return res.status(200).json({ ok: true, data: { journal_id: journalId ?? null } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
