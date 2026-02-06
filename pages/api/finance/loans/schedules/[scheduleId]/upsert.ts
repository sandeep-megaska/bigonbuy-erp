import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../../lib/serverSupabase";

type ApiResponse = { ok: true } | { ok: false; error: string; details?: string | null };
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const scheduleId = first(req.query.scheduleId);
  if (!scheduleId) return res.status(400).json({ ok: false, error: "scheduleId is required" });

  const { supabaseUrl, anonKey } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey) return res.status(500).json({ ok: false, error: "Missing Supabase env" });
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token" });

  const client = createUserClient(supabaseUrl, anonKey, token);
  const { data: userData } = await client.auth.getUser();

  const { due_date, emi_amount, principal_component, interest_component, notes } = req.body ?? {};

  const { error } = await client.rpc("erp_loan_schedule_line_upsert", {
    p_schedule_id: scheduleId,
    p_due_date: due_date,
    p_emi_amount: Number(emi_amount || 0),
    p_principal_component: Number(principal_component || 0),
    p_interest_component: Number(interest_component || 0),
    p_notes: notes ?? null,
    p_actor_user_id: userData?.user?.id ?? null,
  });

  if (error) return res.status(400).json({ ok: false, error: error.message, details: error.details || error.hint || error.code });
  return res.status(200).json({ ok: true });
}
