import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../lib/serverSupabase";

type ApiResponse = { ok: true; data: unknown } | { ok: false; error: string; details?: string | null };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  const { supabaseUrl, anonKey } = getSupabaseEnv();
  const accessToken = getBearerToken(req);
  if (!supabaseUrl || !anonKey) return res.status(500).json({ ok: false, error: "Supabase env missing" });
  if (!accessToken) return res.status(401).json({ ok: false, error: "Missing Authorization token" });

  const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return res.status(401).json({ ok: false, error: "Not authenticated" });

  const q = req.query;
  const { data, error } = await userClient.rpc("erp_fin_allocations_list", {
    p_company_id: typeof q.companyId === "string" ? q.companyId : null,
    p_to_entity_type: typeof q.toEntityType === "string" ? q.toEntityType : null,
    p_to_entity_id: typeof q.toEntityId === "string" ? q.toEntityId : null,
    p_from_entity_type: typeof q.fromEntityType === "string" ? q.fromEntityType : null,
    p_from_entity_id: typeof q.fromEntityId === "string" ? q.fromEntityId : null,
  });
  if (error) return res.status(400).json({ ok: false, error: error.message || "Failed", details: error.details || error.hint || error.code });
  return res.status(200).json({ ok: true, data: data ?? [] });
}
