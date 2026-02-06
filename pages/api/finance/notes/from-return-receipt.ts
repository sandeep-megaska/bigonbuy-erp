import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../lib/serverSupabase";

type ApiResponse = { ok: true; noteId: string } | { ok: false; error: string; details?: string | null };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey } = getSupabaseEnv();
  const accessToken = getBearerToken(req);
  if (!supabaseUrl || !anonKey) return res.status(500).json({ ok: false, error: "Supabase env missing" });
  if (!accessToken) return res.status(401).json({ ok: false, error: "Missing Authorization token" });

  const body = (req.body || {}) as {
    companyId?: string;
    returnReceiptId?: string;
    partyType?: string;
    noteKind?: string;
    reason?: string;
  };

  if (!body.companyId || !body.returnReceiptId || !body.partyType || !body.noteKind) {
    return res.status(400).json({ ok: false, error: "companyId, returnReceiptId, partyType, noteKind are required" });
  }

  const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return res.status(401).json({ ok: false, error: "Not authenticated" });

  const { data, error } = await userClient.rpc("erp_note_create_from_return_receipt", {
    p_company_id: body.companyId,
    p_return_receipt_id: body.returnReceiptId,
    p_party_type: body.partyType,
    p_note_kind: body.noteKind,
    p_reason: body.reason ?? null,
  });

  if (error) {
    return res.status(400).json({ ok: false, error: error.message || "Failed to create note", details: error.details || error.hint || error.code });
  }

  return res.status(200).json({ ok: true, noteId: String(data) });
}
