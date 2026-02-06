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
    source?: string | null;
    extracted_ref?: string | null;
  };

  if (!payload.bank_txn_id || !payload.entity_type) {
    return res.status(400).json({ ok: false, error: "bank_txn_id and entity_type are required" });
  }

  if (payload.entity_type !== "payout_placeholder" && !payload.entity_id) {
    return res.status(400).json({ ok: false, error: "entity_id is required" });
  }

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }


    let entityType = payload.entity_type;
    let entityId = payload.entity_id;
    let notes = payload.notes ?? null;

    if (payload.entity_type === "payout_placeholder") {
      const source = (payload.source || "").trim().toLowerCase();
      if (!["myntra", "flipkart", "delhivery_cod", "snapdeal"].includes(source)) {
        return res.status(400).json({ ok: false, error: "source is required for payout_placeholder" });
      }

      const { data: placeholderId, error: placeholderError } = await userClient.rpc("erp_payout_placeholder_upsert_from_bank_txn", {
        p_bank_txn_id: payload.bank_txn_id,
        p_source: source,
        p_extracted_ref: payload.extracted_ref ?? null,
      });

      if (placeholderError || !placeholderId) {
        return res.status(400).json({
          ok: false,
          error: placeholderError?.message || "Failed to create payout placeholder",
          details: placeholderError?.details || placeholderError?.hint || placeholderError?.code || null,
        });
      }

      entityType = "payout_placeholder";
      entityId = String(placeholderId);
      const details = [source, payload.extracted_ref].filter(Boolean).join(" ").trim();
      notes = details || notes;
    }

    const { data, error } = await userClient.rpc("erp_bank_recon_match", {
      p_bank_txn_id: payload.bank_txn_id,
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_confidence: payload.confidence ?? "manual",
      p_notes: notes,
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
