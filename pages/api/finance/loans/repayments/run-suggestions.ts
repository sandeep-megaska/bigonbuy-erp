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

  const payload = (req.body ?? {}) as { company_id?: string; from?: string | null; to?: string | null };
  if (!payload.company_id) return res.status(400).json({ ok: false, error: "company_id is required" });

  const client = createUserClient(supabaseUrl, anonKey, token);
  const { data, error } = await client.rpc("erp_loans_payment_events_suggest_matches", {
    p_company_id: payload.company_id,
    p_from: payload.from ?? null,
    p_to: payload.to ?? null,
  });

  if (error) return res.status(400).json({ ok: false, error: error.message, details: error.details || error.hint || error.code });
  return res.status(200).json({ ok: true, data });
}
