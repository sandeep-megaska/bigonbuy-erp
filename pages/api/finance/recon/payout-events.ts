import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "lib/serverSupabase";

type ApiResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string; details?: string | null };

const asDate = (value: unknown) => (typeof value === "string" && value ? value : null);

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  const { supabaseUrl, anonKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || missing.length > 0) {
    return res.status(500).json({ ok: false, error: `Missing Supabase env vars: ${missing.join(", ")}` });
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token" });
  }

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const { data: membership } = await userClient
      .from("erp_company_users")
      .select("company_id")
      .eq("user_id", userData.user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    const companyId = membership?.company_id;
    if (!companyId) return res.status(400).json({ ok: false, error: "No active company membership found." });

    if (req.method === "GET") {
      const from = asDate(req.query.from);
      const to = asDate(req.query.to);
      const channelCode = typeof req.query.channel_code === "string" ? req.query.channel_code : null;
      const status = typeof req.query.status === "string" ? req.query.status : null;

      const { data, error } = await userClient.rpc("erp_marketplace_payout_events_list", {
        p_company_id: companyId,
        p_from: from,
        p_to: to,
        p_channel_code: channelCode,
        p_status: status,
      });

      if (error) return res.status(400).json({ ok: false, error: error.message, details: error.details || error.hint || error.code });
      return res.status(200).json({ ok: true, data: data || [] });
    }

    if (req.method === "POST") {
      const payload = (req.body || {}) as { action?: string; from?: string; to?: string; event_id?: string; bank_transaction_id?: string; score?: number };
      const from = asDate(payload.from);
      const to = asDate(payload.to);

      if (payload.action === "import_amazon") {
        const { data, error } = await userClient.rpc("erp_marketplace_payout_events_import_amazon", {
          p_company_id: companyId,
          p_from: from,
          p_to: to,
        });
        if (error) return res.status(400).json({ ok: false, error: error.message, details: error.details || error.hint || error.code });
        return res.status(200).json({ ok: true, data: { imported: Number(data || 0) } });
      }

      if (payload.action === "import_razorpay") {
        const { data, error } = await userClient.rpc("erp_marketplace_payout_events_import_razorpay", {
          p_company_id: companyId,
          p_from: from,
          p_to: to,
        });
        if (error) return res.status(400).json({ ok: false, error: error.message, details: error.details || error.hint || error.code });
        return res.status(200).json({ ok: true, data: { imported: Number(data || 0) } });
      }

      if (payload.action === "suggest") {
        const { data, error } = await userClient.rpc("erp_marketplace_payout_events_suggest_matches", {
          p_company_id: companyId,
          p_from: from,
          p_to: to,
        });
        if (error) return res.status(400).json({ ok: false, error: error.message, details: error.details || error.hint || error.code });
        return res.status(200).json({ ok: true, data: data || [] });
      }

      if (payload.action === "link") {
        if (!payload.event_id || !payload.bank_transaction_id) {
          return res.status(400).json({ ok: false, error: "event_id and bank_transaction_id are required for link" });
        }
        const { data, error } = await userClient.rpc("erp_marketplace_payout_events_link_bank_txn", {
          p_company_id: companyId,
          p_event_id: payload.event_id,
          p_bank_transaction_id: payload.bank_transaction_id,
          p_score: payload.score ?? null,
        });
        if (error) return res.status(400).json({ ok: false, error: error.message, details: error.details || error.hint || error.code });
        return res.status(200).json({ ok: true, data: { link_id: data } });
      }

      return res.status(400).json({ ok: false, error: "Unsupported action" });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
