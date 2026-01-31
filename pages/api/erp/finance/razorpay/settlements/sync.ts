import type { NextApiRequest, NextApiResponse } from "next";
import {
  fetchRazorpayReconCombined,
  getMonthBuckets,
  listRazorpaySettlements,
  summarizeRecon,
  toUnixSeconds,
} from "lib/razorpay";
import { createUserClient, getBearerToken, getSupabaseEnv } from "lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = {
  ok: true;
  data: {
    ingested: number;
    start_date: string;
    end_date: string;
  };
};

type ApiResponse = ErrorResponse | SuccessResponse;

const parseDate = (value: unknown): Date | null => {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || missing.length > 0) {
    return res.status(500).json({
      ok: false,
      error:
        "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
    });
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

    const payload = (req.body ?? {}) as { start_date?: string; end_date?: string };
    const startDate = parseDate(payload.start_date) ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const endDate = parseDate(payload.end_date) ?? new Date();

    const { data: config, error: configError } = await userClient.rpc("erp_razorpay_settlement_config_get");
    if (configError) {
      return res.status(400).json({
        ok: false,
        error: configError.message || "Failed to load Razorpay settlement config",
        details: configError.details || configError.hint || configError.code,
      });
    }

    if (!config?.razorpay_key_id || !config?.razorpay_key_secret) {
      return res.status(400).json({ ok: false, error: "Razorpay credentials are missing" });
    }

    const settlements = await listRazorpaySettlements(config.razorpay_key_id, config.razorpay_key_secret, {
      from: toUnixSeconds(startDate),
      to: toUnixSeconds(endDate),
      count: 100,
    });

    const buckets = getMonthBuckets(startDate, endDate);
    const reconItems = (
      await Promise.all(
        buckets.map((bucket) => fetchRazorpayReconCombined(config.razorpay_key_id, config.razorpay_key_secret, bucket.year, bucket.month))
      )
    ).flat();
    const reconSummary = summarizeRecon(reconItems);

    let ingested = 0;
    for (const settlement of settlements) {
      if (!settlement?.id) continue;
      const summary = reconSummary[settlement.id];
      const raw = summary
        ? { ...settlement, recon_summary: summary }
        : { ...settlement };

      const { error } = await userClient.rpc("erp_razorpay_settlements_upsert", {
        p_razorpay_settlement_id: settlement.id,
        p_settlement_utr: settlement.utr ?? null,
        p_amount: settlement.amount ?? null,
        p_currency: settlement.currency ?? null,
        p_status: settlement.status ?? null,
        p_settled_at: settlement.settled_at ? new Date(settlement.settled_at * 1000).toISOString() : null,
        p_raw: raw,
      });

      if (error) {
        return res.status(400).json({
          ok: false,
          error: error.message || "Failed to store settlements",
          details: error.details || error.hint || error.code,
        });
      }

      ingested += 1;
    }

    return res.status(200).json({
      ok: true,
      data: {
        ingested,
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
