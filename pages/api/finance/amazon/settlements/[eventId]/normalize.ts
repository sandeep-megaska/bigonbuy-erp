import type { NextApiRequest, NextApiResponse } from "next";
import { extractAmazonSettlementBody, parseAmazonSettlementHtml } from "lib/erp/amazonSettlementParser";
import { createUserClient, getBearerToken, getSupabaseEnv } from "lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = {
  ok: true;
  batch_id: string;
  attempted_rows: number;
  inserted_rows: number;
};
type ApiResponse = ErrorResponse | SuccessResponse;

const getEventIdParam = (value: string | string[] | undefined): string | null => {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
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

  const eventId = getEventIdParam(req.query.eventId) || (req.body?.eventId as string | undefined);
  if (!eventId) {
    return res.status(400).json({ ok: false, error: "eventId is required" });
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

    const { data: event, error: eventError } = await userClient
      .from("erp_settlement_events")
      .select("id, platform, event_type, currency, raw_payload, reference_no")
      .eq("id", eventId)
      .maybeSingle();

    if (eventError || !event) {
      return res.status(404).json({
        ok: false,
        error: eventError?.message || "Settlement event not found",
      });
    }

    if (event.platform !== "amazon" || event.event_type !== "AMAZON_SETTLEMENT") {
      return res.status(400).json({
        ok: false,
        error: "Event is not an Amazon settlement",
      });
    }

    const body = extractAmazonSettlementBody(event.raw_payload);
    if (!body) {
      return res.status(400).json({
        ok: false,
        error: "Settlement email body not found in raw_payload",
      });
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
        p_event_id: eventId,
        p_batch_ref: parsed.batchRef ?? event.reference_no ?? null,
        p_period_start: parsed.periodStart,
        p_period_end: parsed.periodEnd,
        p_currency: parsed.currency ?? event.currency ?? null,
        p_rows: rows,
        p_actor_user_id: userData.user.id,
      }
    );

    if (upsertError || !upsertResult) {
      return res.status(400).json({
        ok: false,
        error: upsertError?.message || "Unable to normalize settlement event",
        details: upsertError?.details || upsertError?.hint || upsertError?.code,
      });
    }

    return res.status(200).json({
      ok: true,
      batch_id: upsertResult.batch_id as string,
      attempted_rows: upsertResult.attempted_rows as number,
      inserted_rows: upsertResult.inserted_rows as number,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return res.status(500).json({ ok: false, error: message });
  }
}
