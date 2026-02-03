import type { NextApiRequest, NextApiResponse } from "next";
import { extractAmazonSettlementBody, parseAmazonSettlementHtml } from "lib/erp/amazonSettlementParser";
import { createUserClient, getBearerToken, getSupabaseEnv } from "lib/serverSupabase";

type RunResult = {
  event_id: string;
  batch_id: string | null;
  attempted_rows: number;
  inserted_rows: number;
  error: string | null;
};

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; results: RunResult[] };
type ApiResponse = ErrorResponse | SuccessResponse;

const normalizeDateParam = (value: string | string[] | undefined): string | null => {
  if (!value) return null;
  const raw = Array.isArray(value) ? value[0] : value;
  return raw ? raw.trim().slice(0, 10) : null;
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

  const fromDate = normalizeDateParam(req.query.from) || normalizeDateParam(req.body?.from);
  const toDate = normalizeDateParam(req.query.to) || normalizeDateParam(req.body?.to);
  if (!fromDate || !toDate) {
    return res.status(400).json({ ok: false, error: "from and to date parameters are required" });
  }

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const { error: permissionError } = await userClient.rpc("erp_require_marketplace_writer");
    if (permissionError) {
      return res
        .status(403)
        .json({ ok: false, error: permissionError.message || "Marketplace write access required" });
    }

    const { data: events, error: eventsError } = await userClient
      .from("erp_settlement_events")
      .select("id, currency, raw_payload, reference_no")
      .eq("platform", "amazon")
      .eq("event_type", "AMAZON_SETTLEMENT")
      .gte("event_date", fromDate)
      .lte("event_date", toDate)
      .order("event_date", { ascending: true });

    if (eventsError) {
      return res.status(400).json({
        ok: false,
        error: eventsError.message || "Unable to load settlement events",
        details: eventsError.details || eventsError.hint || eventsError.code,
      });
    }

    const results: RunResult[] = [];
    for (const event of events || []) {
      const body = extractAmazonSettlementBody(event.raw_payload);
      if (!body) {
        results.push({
          event_id: event.id,
          batch_id: null,
          attempted_rows: 0,
          inserted_rows: 0,
          error: "Settlement email body not found in raw_payload",
        });
        continue;
      }

      const parsed = parseAmazonSettlementHtml(body);
      const rows = parsed.rows.map((row) => ({
        txn_date: row.txn_date,
        order_id: row.order_id,
        sub_order_id: row.sub_order_id,
        sku: row.sku,
        qty: row.qty,
        gross_sales: row.gross_sales,
        net_payout: row.net_payout,
        total_fees: row.total_fees,
        shipping_fee: row.shipping_fee,
        commission_fee: row.commission_fee,
        fixed_fee: row.fixed_fee,
        closing_fee: row.closing_fee,
        refund_amount: row.refund_amount,
        other_charges: row.other_charges,
        settlement_type: row.settlement_type,
        raw: row.raw,
      }));

      const { data: upsertResult, error: upsertError } = await userClient.rpc(
        "erp_marketplace_settlement_batch_upsert_from_rows",
        {
          p_event_id: event.id,
          p_batch_ref: parsed.batchRef ?? event.reference_no ?? null,
          p_period_start: parsed.periodStart,
          p_period_end: parsed.periodEnd,
          p_currency: parsed.currency ?? event.currency ?? null,
          p_rows: rows,
          p_actor_user_id: userData.user.id,
        }
      );

      if (upsertError || !upsertResult) {
        results.push({
          event_id: event.id,
          batch_id: null,
          attempted_rows: 0,
          inserted_rows: 0,
          error: upsertError?.message || "Unable to normalize event",
        });
        continue;
      }

      results.push({
        event_id: event.id,
        batch_id: upsertResult.batch_id as string,
        attempted_rows: upsertResult.attempted_rows as number,
        inserted_rows: upsertResult.inserted_rows as number,
        error: null,
      });
    }

    return res.status(200).json({ ok: true, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return res.status(500).json({ ok: false, error: message });
  }
}
