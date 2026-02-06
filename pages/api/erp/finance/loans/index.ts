import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../lib/serverSupabase";

type ApiResponse = { ok: true; data: any } | { ok: false; error: string; details?: string | null };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  const { supabaseUrl, anonKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || missing.length) return res.status(500).json({ ok: false, error: "Missing Supabase env" });
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token" });
  const client = createUserClient(supabaseUrl, anonKey, token);

  if (req.method === "GET") {
    const { data, error } = await client
      .from("erp_loans")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) return res.status(400).json({ ok: false, error: error.message, details: error.details || error.hint || error.code });
    return res.status(200).json({ ok: true, data: data ?? [] });
  }

  const payload = req.body ?? {};
  const { data, error } = await client
    .from("erp_loans")
    .insert({
      loan_type: payload.loan_type,
      lender_name: payload.lender_name,
      loan_ref: payload.loan_ref ?? null,
      sanction_amount: payload.sanction_amount ?? null,
      disbursed_amount: payload.disbursed_amount ?? 0,
      disbursed_date: payload.disbursed_date ?? null,
      interest_rate_annual: payload.interest_rate_annual ?? null,
      tenure_months: payload.tenure_months ?? null,
      emi_amount: payload.emi_amount ?? null,
      repayment_day: payload.repayment_day ?? null,
      status: payload.status ?? "active",
      notes: payload.notes ?? null,
    })
    .select("*")
    .single();

  if (error) return res.status(400).json({ ok: false, error: error.message, details: error.details || error.hint || error.code });
  return res.status(200).json({ ok: true, data });
}
