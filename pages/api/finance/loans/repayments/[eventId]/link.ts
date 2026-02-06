import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../../lib/serverSupabase";

type ApiResponse = { ok: true; data: any } | { ok: false; error: string; details?: string | null };
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const eventId = first(req.query.eventId);
  if (!eventId) return res.status(400).json({ ok: false, error: "eventId is required" });

  const { supabaseUrl, anonKey } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey) return res.status(500).json({ ok: false, error: "Missing Supabase env" });
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token" });

  const payload = (req.body ?? {}) as { company_id?: string; bank_transaction_id?: string; score?: number };
  if (!payload.company_id || !payload.bank_transaction_id) {
    return res.status(400).json({ ok: false, error: "company_id and bank_transaction_id are required" });
  }

  const client = createUserClient(supabaseUrl, anonKey, token);
  const { data, error } = await client.rpc("erp_loans_payment_events_link_bank_txn", {
    p_company_id: payload.company_id,
    p_event_id: eventId,
    p_bank_transaction_id: payload.bank_transaction_id,
    p_score: Number.isFinite(payload.score) ? Number(payload.score) : 0,
  });

  if (error) return res.status(400).json({ ok: false, error: error.message, details: error.details || error.hint || error.code });
  return res.status(200).json({ ok: true, data });
}
