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
type DebugInfo = {
  raw_payload_type: string;
  raw_payload_keys: string[];
  html_len: number;
  extracted_body_len: number;
  extracted_body_preview: string;
  has_table: boolean;
  table_count: number;
  parsed_meta: {
    batchRef: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    currency: string | null;
  };
  parsed_row_count: number;
};
type ApiResponse = ErrorResponse | (SuccessResponse & Partial<DebugInfo>);

const stripHtmlForDebug = (value: string) =>
  value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();

const looksLikeHtml = (value: string) => /<\s*(html|table|body|div|span|tr|td|th)\b/i.test(value);

const getRawPayloadHtml = (payload: unknown): string | null => {
  if (!payload) return null;
  if (typeof payload === "string") return payload;
  if (typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const body = typeof record.body === "string" ? record.body : null;
    const bodyHtml = typeof record.body_html === "string" ? record.body_html : null;
    if (body && looksLikeHtml(body)) return body;
    if (bodyHtml) return bodyHtml;
    if (body) return body;
    if (typeof record.html === "string") return record.html;
    if (typeof record.raw_html === "string") return record.raw_html;
  }
  return null;
};

const getEventIdParam = (value: string | string[] | undefined): string | null => {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
};
export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const debugEnabled = req.query.debug === "1";

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

    const raw = event.raw_payload as any;
const html =
  typeof raw === "string" ? raw :
  typeof raw === "object" && raw ? (raw.body ?? raw.html ?? raw.body_html ?? raw.raw_html ?? null) :
  null;

if (!html || typeof html !== "string") {
  return res.status(400).json({ ok: false, error: "Settlement email HTML not found in raw_payload" });
}

// IMPORTANT: parse the full HTML, do not slice to summary sections
const parsed = parseAmazonSettlementHtml(html);

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
    const debugInfo: DebugInfo | null = debugEnabled
      ? (() => {
          const rawPayloadKeys =
            event.raw_payload && typeof event.raw_payload === "object"
              ? Object.keys(event.raw_payload as Record<string, unknown>)
              : [];
          const rawPayloadHtml = getRawPayloadHtml(event.raw_payload);
          const tableMatches = body.match(/<table\b/gi) || [];
          const extractedBody = stripHtmlForDebug(body);
          return {
            raw_payload_type: typeof event.raw_payload,
            raw_payload_keys: rawPayloadKeys,
            html_len: rawPayloadHtml?.length ?? 0,
            extracted_body_len: extractedBody.length,
            extracted_body_preview: extractedBody.slice(0, 300),
            has_table: tableMatches.length > 0,
            table_count: tableMatches.length,
            parsed_meta: {
              batchRef: parsed.batchRef,
              periodStart: parsed.periodStart,
              periodEnd: parsed.periodEnd,
              currency: parsed.currency,
            },
            parsed_row_count: rows.length,
          };
        })()
      : null;

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
      ...(debugInfo ?? {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return res.status(500).json({ ok: false, error: message });
  }
}
