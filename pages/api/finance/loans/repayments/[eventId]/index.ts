import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../../lib/serverSupabase";

type ApiResponse = { ok: true; data: any } | { ok: false; error: string; details?: string | null };
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "PATCH") {
    res.setHeader("Allow", "PATCH");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const eventId = first(req.query.eventId);
  if (!eventId) return res.status(400).json({ ok: false, error: "eventId is required" });

  const { supabaseUrl, anonKey } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey) return res.status(500).json({ ok: false, error: "Missing Supabase env" });
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token" });

  const payload = (req.body ?? {}) as { principal_amount?: number | null; interest_amount?: number | null };
  const client = createUserClient(supabaseUrl, anonKey, token);
  const { data: userData } = await client.auth.getUser();

  const { data, error } = await client
    .from("erp_loan_payment_events")
    .update({
      principal_amount: payload.principal_amount ?? null,
      interest_amount: payload.interest_amount ?? null,
      updated_by: userData?.user?.id ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", eventId)
    .eq("is_void", false)
    .select("*")
    .single();

  if (error) return res.status(400).json({ ok: false, error: error.message, details: error.details || error.hint || error.code });
  return res.status(200).json({ ok: true, data });
}
