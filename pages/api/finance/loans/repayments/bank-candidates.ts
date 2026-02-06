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
  if (!companyId) return res.status(400).json({ ok: false, error: "company_id is required" });

  const client = createUserClient(supabaseUrl, anonKey, token);
  let query = client
    .from("erp_bank_transactions")
    .select("id,txn_date,value_date,description,reference_no,debit,credit")
    .eq("company_id", companyId)
    .eq("is_void", false)
    .eq("is_matched", false)
    .gt("debit", 0)
    .order("txn_date", { ascending: false })
    .limit(200);

  if (from) query = query.gte("txn_date", from);
  if (to) query = query.lte("txn_date", to);

  const { data, error } = await query;
  if (error) return res.status(400).json({ ok: false, error: error.message, details: error.details || error.hint || error.code });
  return res.status(200).json({ ok: true, data: data || [] });
}
