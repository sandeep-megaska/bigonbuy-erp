import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../lib/serverSupabase";

type ApiResponse = { ok: true; data: any[] } | { ok: false; error: string; details?: string | null };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey) return res.status(500).json({ ok: false, error: "Missing Supabase env" });
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token" });

  const companyId = typeof req.query.company_id === "string" ? req.query.company_id : null;
  const from = typeof req.query.from === "string" ? req.query.from : null;
  const to = typeof req.query.to === "string" ? req.query.to : null;
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const loanId = typeof req.query.loan_id === "string" ? req.query.loan_id : null;

  if (!companyId) return res.status(400).json({ ok: false, error: "company_id is required" });

  const client = createUserClient(supabaseUrl, anonKey, token);
  const { data, error } = await client.rpc("erp_loans_payment_events_list", {
    p_company_id: companyId,
    p_from: from,
    p_to: to,
    p_status: status,
    p_loan_id: loanId,
  });

  if (error) return res.status(400).json({ ok: false, error: error.message, details: error.details || error.hint || error.code });
  return res.status(200).json({ ok: true, data: (data as any[]) || [] });
}
