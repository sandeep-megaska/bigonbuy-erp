import type { NextApiRequest, NextApiResponse } from "next";
import {
  parseAmazonSettlementAmount,
  parseAmazonSettlementReportText,
} from "lib/erp/amazonSettlementReport";
import {
  amazonDownloadReportDocument,
  amazonGetReport,
  amazonGetReportDocument,
} from "lib/oms/adapters/amazonSpApi";
import { createUserClient, getBearerToken, getSupabaseEnv } from "lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = {
  ok: true;
  batch_id: string;
  attempted_rows: number;
  inserted_rows: number;
};
type ApiResponse = ErrorResponse | SuccessResponse;

type SettlementSummary = {
  settlement_id: string | null;
  period_start: string | null;
  period_end: string | null;
  deposit_date: string | null;
  total_amount: number | null;
  currency: string | null;
};

const normalizeDate = (value: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length >= 10 ? trimmed.slice(0, 10) : trimmed;
};

const normalizeValue = (value: string | null) =>
  (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

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

  const reportId = getEventIdParam(req.query.eventId) || (req.body?.eventId as string | undefined);
  if (!reportId) {
    return res.status(400).json({ ok: false, error: "reportId is required" });
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

    const report = await amazonGetReport({ reportId });
    const processingStatus = report.processingStatus ?? "UNKNOWN";

    if (processingStatus !== "DONE") {
      return res
        .status(400)
        .json({ ok: false, error: `Report status is ${processingStatus}. Try again later.` });
    }

    if (!report.reportDocumentId) {
      return res.status(400).json({ ok: false, error: "Missing reportDocumentId." });
    }

    const reportDocument = await amazonGetReportDocument({
      reportDocumentId: report.reportDocumentId,
    });
    const text = await amazonDownloadReportDocument({ reportDocument });

    const parsed = parseAmazonSettlementReportText(text);
    if (parsed.columns.length === 0 || parsed.rows.length === 0) {
      return res.status(400).json({ ok: false, error: "Settlement report has no rows." });
    }

    const findColumnName = (candidates: string[]) => {
      const normalized = parsed.columns.map((column) => normalizeValue(column));
      for (const candidate of candidates) {
        const matchIndex = normalized.indexOf(normalizeValue(candidate));
        if (matchIndex >= 0) return parsed.columns[matchIndex];
      }
      return null;
    };

    const transactionTypeColumn = findColumnName(["transaction-type"]);
    const amountTypeColumn = findColumnName(["amount-type"]);
    const amountDescriptionColumn = findColumnName(["amount-description"]);
    const amountColumn = findColumnName(["amount"]);
    const orderIdColumn = findColumnName(["order-id"]);
    const merchantOrderIdColumn = findColumnName(["merchant-order-id"]);
    const shipmentIdColumn = findColumnName(["shipment-id"]);
    const adjustmentIdColumn = findColumnName(["adjustment-id"]);
    const skuColumn = findColumnName(["sku"]);
    const orderItemCodeColumn = findColumnName(["order-item-code"]);
    const quantityColumn = findColumnName(["quantity-purchased", "quantity"]);
    const postedDateColumn = findColumnName(["posted-date"]);
    const postedDateTimeColumn = findColumnName(["posted-date-time"]);
    const settlementIdColumn = findColumnName(["settlement-id"]);
    const settlementStartColumn = findColumnName(["settlement-start-date"]);
    const settlementEndColumn = findColumnName(["settlement-end-date"]);
    const depositDateColumn = findColumnName(["deposit-date"]);
    const totalAmountColumn = findColumnName(["total-amount"]);
    const currencyColumn = findColumnName(["currency", "amount-currency", "currency-code"]);

    const getValue = (row: Record<string, string>, column: string | null) =>
      column ? row[column]?.trim() || "" : "";

    const summaryRow = transactionTypeColumn
      ? parsed.rows.find((row) => getValue(row, transactionTypeColumn) === "")
      : null;

    if (!summaryRow) {
      return res.status(400).json({ ok: false, error: "Settlement summary row not found." });
    }

    const summary: SettlementSummary = {
      settlement_id: getValue(summaryRow, settlementIdColumn) || reportId,
      period_start: normalizeDate(getValue(summaryRow, settlementStartColumn)),
      period_end: normalizeDate(getValue(summaryRow, settlementEndColumn)),
      deposit_date: normalizeDate(getValue(summaryRow, depositDateColumn)),
      total_amount: null,
      currency: null,
    };

    const totalAmountRaw = getValue(summaryRow, totalAmountColumn);
    summary.total_amount = totalAmountRaw ? parseAmazonSettlementAmount(totalAmountRaw) : null;
    summary.currency = getValue(summaryRow, currencyColumn) || null;

    const normalizedRows = parsed.rows
      .filter((row) => row !== summaryRow)
      .map((row) => {
        const transactionType = getValue(row, transactionTypeColumn);
        const amountType = getValue(row, amountTypeColumn);
        const amountDescription = getValue(row, amountDescriptionColumn);
        const normalizedAmountType = normalizeValue(amountType || amountDescription);
        const normalizedTransactionType = normalizeValue(transactionType);
        const amountRaw = getValue(row, amountColumn);
        const amount = amountRaw ? parseAmazonSettlementAmount(amountRaw) : null;
        const qtyRaw = getValue(row, quantityColumn);
        const qty = qtyRaw ? Number.parseInt(qtyRaw, 10) : null;
        const postedDate = normalizeDate(
          getValue(row, postedDateColumn) || getValue(row, postedDateTimeColumn) || summary.deposit_date || ""
        );

        const settlementTypeParts = [transactionType, amountType, amountDescription]
          .map((value) => value?.trim())
          .filter(Boolean);

        const rowPayload = {
          txn_date: postedDate,
          order_id: getValue(row, orderIdColumn) || null,
          sub_order_id:
            getValue(row, merchantOrderIdColumn) ||
            getValue(row, shipmentIdColumn) ||
            getValue(row, adjustmentIdColumn) ||
            null,
          sku: getValue(row, skuColumn) || getValue(row, orderItemCodeColumn) || null,
          qty,
          gross_sales:
            amount !== null &&
            (normalizedAmountType.includes("principal") || normalizedAmountType.includes("itemprice"))
              ? amount
              : null,
          net_payout: amount,
          total_fees:
            amount !== null &&
            (normalizedAmountType.includes("fee") ||
              normalizedAmountType.includes("commission") ||
              normalizedAmountType.includes("shipping") ||
              normalizedAmountType.includes("fulfillment"))
              ? amount
              : null,
          shipping_fee: normalizedAmountType.includes("shipping") ? amount : null,
          commission_fee: normalizedAmountType.includes("commission") ? amount : null,
          fixed_fee: normalizedAmountType.includes("fixed") ? amount : null,
          closing_fee: normalizedAmountType.includes("closing") ? amount : null,
          refund_amount: normalizedTransactionType.includes("refund") ? amount : null,
          other_charges:
            amount !== null && normalizedAmountType.includes("other") ? amount : null,
          settlement_type: settlementTypeParts.length > 0 ? settlementTypeParts.join(" / ") : null,
          raw: row,
        };

        return rowPayload;
      });

    const { error: payloadError } = await userClient
      .from("erp_marketplace_settlement_report_payloads")
      .upsert(
        {
          report_id: reportId,
          payload: {
            summary,
            rows: normalizedRows,
          },
        },
        { onConflict: "company_id,report_id" }
      );

    if (payloadError) {
      return res.status(400).json({
        ok: false,
        error: payloadError.message || "Unable to stage settlement report rows",
        details: payloadError.details || payloadError.hint || payloadError.code,
      });
    }

    const { data: upsertResult, error: upsertError } = await userClient.rpc(
      "erp_marketplace_settlement_batch_upsert_from_amazon_report",
      {
        p_report_id: reportId,
        p_actor_user_id: userData.user.id,
      }
    );

    if (upsertError || !upsertResult) {
      return res.status(400).json({
        ok: false,
        error: upsertError?.message || "Unable to normalize settlement report",
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
