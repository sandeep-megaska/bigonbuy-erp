import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../../lib/serverSupabase";

type ApiResponse = { ok: true; data: { inserted_count: number; skipped_count: number } } | { ok: false; error: string; details?: string | null };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  const loanId = first(req.query.loanId);
  if (!loanId) return res.status(400).json({ ok: false, error: "loanId is required" });
  const { supabaseUrl, anonKey } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey) return res.status(500).json({ ok: false, error: "Missing Supabase env" });
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token" });
  const client = createUserClient(supabaseUrl, anonKey, token);

  const { start_date, months, emi_amount, principal_total } = req.body ?? {};
  const { data, error } = await client.rpc("erp_loan_schedule_generate_simple", {
    p_loan_id: loanId,
    p_start_date: start_date,
    p_months: Number(months),
    p_emi_amount: Number(emi_amount || 0),
    p_principal_total: principal_total == null || principal_total === "" ? null : Number(principal_total),
    p_actor_user_id: null,
  });
  if (error) return res.status(400).json({ ok: false, error: error.message, details: error.details || error.hint || error.code });
  return res.status(200).json({ ok: true, data: { inserted_count: Number(data?.inserted_count || 0), skipped_count: Number(data?.skipped_count || 0) } });
}
