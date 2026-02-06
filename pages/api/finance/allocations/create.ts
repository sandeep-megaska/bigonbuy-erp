import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../lib/serverSupabase";

type ApiResponse = { ok: true; allocationId: string } | { ok: false; error: string; details?: string | null };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  const { supabaseUrl, anonKey } = getSupabaseEnv();
  const accessToken = getBearerToken(req);
  if (!supabaseUrl || !anonKey) return res.status(500).json({ ok: false, error: "Supabase env missing" });
  if (!accessToken) return res.status(401).json({ ok: false, error: "Missing Authorization token" });

  const body = (req.body || {}) as Record<string, unknown>;
  const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return res.status(401).json({ ok: false, error: "Not authenticated" });

  const { data, error } = await userClient.rpc("erp_fin_allocations_create", {
    p_company_id: body.companyId,
    p_from_entity_type: body.fromEntityType,
    p_from_entity_id: body.fromEntityId,
    p_to_entity_type: body.toEntityType,
    p_to_entity_id: body.toEntityId,
    p_amount: body.amount,
    p_comment: body.comment ?? null,
  });
  if (error) return res.status(400).json({ ok: false, error: error.message || "Failed", details: error.details || error.hint || error.code });
  return res.status(200).json({ ok: true, allocationId: String(data) });
}
