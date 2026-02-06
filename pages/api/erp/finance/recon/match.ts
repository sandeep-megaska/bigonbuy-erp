import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "lib/serverSupabase";

type ApiResponse =
  | { ok: true; data: Record<string, unknown> | null }
  | { ok: false; error: string; details?: string | null };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || missing.length > 0) {
    return res.status(500).json({ ok: false, error: `Missing Supabase env vars: ${missing.join(", ")}` });
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token" });
  }

  const payload = (req.body ?? {}) as {
    bank_txn_id?: string;
    entity_type?: string;
    entity_id?: string;
    confidence?: string | null;
    notes?: string | null;
  };

  if (!payload.bank_txn_id || !payload.entity_type || !payload.entity_id) {
    return res.status(400).json({ ok: false, error: "bank_txn_id, entity_type and entity_id are required" });
  }

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const { data, error } = await userClient.rpc("erp_bank_recon_match", {
      p_bank_txn_id: payload.bank_txn_id,
      p_entity_type: payload.entity_type,
      p_entity_id: payload.entity_id,
      p_confidence: payload.confidence ?? "manual",
      p_notes: payload.notes ?? null,
    });

    if (error) {
      return res.status(400).json({ ok: false, error: error.message, details: error.details || error.hint || error.code });
    }

    return res.status(200).json({ ok: true, data: (data as Record<string, unknown>) ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
