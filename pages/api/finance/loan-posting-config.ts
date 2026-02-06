import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../lib/serverSupabase";

type ApiResponse = { ok: true; data?: any } | { ok: false; error: string; details?: string | null };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  const { supabaseUrl, anonKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || missing.length > 0) return res.status(500).json({ ok: false, error: "Missing Supabase env" });

  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token" });

  const userClient = createUserClient(supabaseUrl, anonKey, token);

  if (req.method === "GET") {
    const { data, error } = await userClient.rpc("erp_loan_finance_posting_config_get");
    if (error) return res.status(400).json({ ok: false, error: error.message, details: error.details || error.hint || error.code });
    return res.status(200).json({ ok: true, data });
  }

  const { loan_principal_account_id, interest_expense_account_id, bank_account_id, updated_by } = req.body ?? {};
  const { error } = await userClient.rpc("erp_loan_finance_posting_config_upsert", {
    p_loan_principal_account_id: loan_principal_account_id,
    p_interest_expense_account_id: interest_expense_account_id,
    p_bank_account_id: bank_account_id,
    p_updated_by: updated_by ?? null,
  });
  if (error) return res.status(400).json({ ok: false, error: error.message, details: error.details || error.hint || error.code });

  const { data } = await userClient.rpc("erp_loan_finance_posting_config_get");
  return res.status(200).json({ ok: true, data });
}
