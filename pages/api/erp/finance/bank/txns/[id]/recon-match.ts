import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; data: Record<string, unknown> | null };
type ApiResponse = ErrorResponse | SuccessResponse;

type MatchPayload = {
  entityType?: string | null;
  entityId?: string | null;
  confidence?: string | null;
  notes?: string | null;
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

  const bankTxnId = typeof req.query.id === "string" ? req.query.id : "";
  if (!bankTxnId) {
    return res.status(400).json({ ok: false, error: "Bank transaction id is required" });
  }

  const payload = (req.body ?? {}) as MatchPayload;
  const entityType = payload.entityType ? String(payload.entityType).trim() : "";
  const entityId = payload.entityId ? String(payload.entityId).trim() : "";

  if (!entityType) {
    return res.status(400).json({ ok: false, error: "entityType is required" });
  }

  if (!entityId) {
    return res.status(400).json({ ok: false, error: "entityId is required" });
  }

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const { data, error } = await userClient.rpc("erp_bank_recon_match", {
      p_bank_txn_id: bankTxnId,
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_confidence: payload.confidence ?? "manual",
      p_notes: payload.notes ?? null,
    });

    if (error) {
      return res.status(400).json({
        ok: false,
        error: error.message || "Failed to match bank transaction",
        details: error.details || error.hint || error.code,
      });
    }

    return res.status(200).json({ ok: true, data: (data as Record<string, unknown>) ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
