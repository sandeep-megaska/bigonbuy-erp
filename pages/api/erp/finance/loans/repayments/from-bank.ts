import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../../lib/serverSupabase";

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

  const payload = (req.body ?? {}) as { bank_txn_id?: string; loan_id?: string };
  if (!payload.bank_txn_id || !payload.loan_id) {
    return res.status(400).json({ ok: false, error: "bank_txn_id and loan_id are required" });
  }

  const client = createUserClient(supabaseUrl, anonKey, token);
  const { data: userData } = await client.auth.getUser();
  const { data, error } = await client.rpc("erp_loan_repayment_event_create_from_bank_txn", {
    p_actor_user_id: userData?.user?.id ?? null,
    p_bank_txn_id: payload.bank_txn_id,
    p_loan_id: payload.loan_id,
  });

  if (error) return res.status(400).json({ ok: false, error: error.message, details: error.details || error.hint || error.code });
  return res.status(200).json({ ok: true, data });
}
