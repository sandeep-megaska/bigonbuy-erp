import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../../lib/serverSupabase";

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

  const client = createUserClient(supabaseUrl, anonKey, token);
  const from = typeof req.query.from === "string" ? req.query.from : null;
  const to = typeof req.query.to === "string" ? req.query.to : null;
  const limit = Number(typeof req.query.limit === "string" ? req.query.limit : 50);
  const offset = Number(typeof req.query.offset === "string" ? req.query.offset : 0);

  const { data, error } = await client.rpc("erp_loan_repayment_suggest_from_bank", {
    p_from: from,
    p_to: to,
    p_limit: Number.isFinite(limit) ? limit : 50,
    p_offset: Number.isFinite(offset) ? offset : 0,
  });

  if (error) return res.status(400).json({ ok: false, error: error.message, details: error.details || error.hint || error.code });
  return res.status(200).json({ ok: true, data: (data as any[]) || [] });
}
