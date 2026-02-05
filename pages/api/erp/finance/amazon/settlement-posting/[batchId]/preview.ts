import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../../../lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; data: unknown };
type ApiResponse = ErrorResponse | SuccessResponse;

const getPathParam = (value: string | string[] | undefined): string | null => {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
   if (req.query.debug === "1") {
    return res.status(200).json({
      ok: true,
      data: {
        hit: "api/erp/finance/amazon/settlement-posting/[batchId]/preview.ts",
        method: req.method,
        batchId: req.query.batchId,
        hasAuthHeader: Boolean(req.headers.authorization),
        cookieKeys: Object.keys(req.cookies ?? {}).slice(0, 20),
      },
    });
  }
  
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || missing.length > 0) {
    return res.status(500).json({
      ok: false,
      error: "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token" });
  }

  // supports both query.batchId and legacy query.eventId
  const batchId = getPathParam(req.query.batchId) ?? getPathParam(req.query.eventId);
  if (!batchId) {
    return res.status(400).json({ ok: false, error: "batchId is required" });
  }

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);

    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const { error: permissionError } = await userClient.rpc("erp_require_finance_reader");
    if (permissionError) {
      return res.status(403).json({ ok: false, error: permissionError.message || "Finance access required" });
    }

    const { data, error } = await userClient.rpc("erp_amazon_settlement_journal_preview", {
      p_batch_id: batchId,
    });

    if (error) {
      return res.status(400).json({
        ok: false,
        error: error.message || "Failed to load Amazon settlement preview",
        details: error.details || error.hint || error.code,
      });
    }

    return res.status(200).json({ ok: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
