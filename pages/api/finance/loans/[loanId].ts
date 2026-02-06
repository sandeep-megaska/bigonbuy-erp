import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../lib/serverSupabase";

type ApiResponse = { ok: true; data: any } | { ok: false; error: string; details?: string | null };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (!["GET", "PATCH"].includes(req.method || "")) {
    res.setHeader("Allow", "GET, PATCH");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  const loanId = first(req.query.loanId);
  if (!loanId) return res.status(400).json({ ok: false, error: "loanId is required" });
  const { supabaseUrl, anonKey } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey) return res.status(500).json({ ok: false, error: "Missing Supabase env" });
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token" });
  const client = createUserClient(supabaseUrl, anonKey, token);

  if (req.method === "GET") {
    const { data: loan, error } = await client.from("erp_loans").select("*").eq("id", loanId).single();
    if (error) return res.status(400).json({ ok: false, error: error.message, details: error.details || error.hint || error.code });
    const { data: schedules } = await client
      .from("erp_loan_schedules")
      .select("*, erp_loan_finance_posts(journal_id, erp_fin_journals(doc_no))")
      .eq("loan_id", loanId)
      .order("due_date", { ascending: true });
    return res.status(200).json({ ok: true, data: { loan, schedules: schedules ?? [] } });
  }

  const payload = req.body ?? {};
  const { data, error } = await client
    .from("erp_loans")
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq("id", loanId)
    .select("*")
    .single();
  if (error) return res.status(400).json({ ok: false, error: error.message, details: error.details || error.hint || error.code });
  return res.status(200).json({ ok: true, data });
}
