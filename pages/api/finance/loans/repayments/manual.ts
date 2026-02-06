import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../lib/serverSupabase";

type ApiResponse = { ok: true; data: any } | { ok: false; error: string; details?: string | null };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey) return res.status(500).json({ ok: false, error: "Missing Supabase env" });
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token" });

  const payload = (req.body ?? {}) as {
    company_id?: string;
    loan_id?: string;
    event_date?: string;
    amount?: number;
    notes?: string | null;
  };
  if (!payload.company_id || !payload.loan_id || !payload.event_date || payload.amount == null) {
    return res.status(400).json({ ok: false, error: "company_id, loan_id, event_date and amount are required" });
  }

  const client = createUserClient(supabaseUrl, anonKey, token);
  const { data, error } = await client.rpc("erp_loans_payment_events_mark_manual", {
    p_company_id: payload.company_id,
    p_loan_id: payload.loan_id,
    p_event_date: payload.event_date,
    p_amount: payload.amount,
    p_notes: payload.notes ?? null,
  });

  if (error) return res.status(400).json({ ok: false, error: error.message, details: error.details || error.hint || error.code });
  return res.status(200).json({ ok: true, data });
}
