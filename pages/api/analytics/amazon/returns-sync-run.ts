import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  amazonCreateReport,
  amazonDownloadReportDocument,
  amazonGetReport,
  amazonGetReportDocument,
} from "../../../../lib/oms/adapters/amazonSpApi";
import { parseDelimited } from "../../../../lib/erp/parseCsv";
import {
  createServiceRoleClient,
  createUserClient,
  getBearerToken,
  getSupabaseEnv,
} from "../../../../lib/serverSupabase";

const requestSchema = z.object({
  marketplaceId: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  mode: z.enum(["all", "mfn", "fba"]).optional(),
});

const DEFAULT_MARKETPLACE_ID = "A21TJRUUN4KGV";
const CHANNEL_KEY = "amazon";
const MFN_REPORT_TYPE = "GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE";
const FBA_REPORT_TYPE = "GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA";
const MAX_POLL_ATTEMPTS = 12;
const INITIAL_BACKOFF_MS = 2500;
const MAX_BACKOFF_MS = 20000;

const ALLOWED_ROLE_KEYS = ["owner", "admin", "inventory", "finance"] as const;

type SyncResponse =
  | {
      ok: true;
      runs: Array<{
        run_id: string;
        report_id: string;
        report_type: string;
        row_count: number;
        facts_upserted: number;
        inserted_rows: number;
        skipped_rows: number;
      }>;
      row_count: number;
      facts_upserted: number;
      inserted_rows: number;
      skipped_rows: number;
    }
  | { ok: false; error: string; details?: string };

type ParsedReturn = {
  amazon_order_id: string | null;
  return_date: string | null;
  asin: string | null;
  sku: string | null;
  quantity: number;
  reason: string | null;
  rma_id: string | null;
  status: string | null;
  disposition: string | null;
  currency: string | null;
  amount_reported: number | null;
  raw: Record<string, string | null>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

function parseReportText(text: string): string[][] {
  const sample = text.split(/\r?\n/)[0] ?? "";
  const delimiter = sample.includes("\t") ? "\t" : ",";
  return parseDelimited(text, delimiter);
}

function parseDateValue(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  const normalized = trimmed.replace(/\s*UTC$/i, "Z");
  const parsedNormalized = new Date(normalized);
  if (!Number.isNaN(parsedNormalized.getTime())) return parsedNormalized.toISOString();
  const isoDateMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateMatch) {
    const [, year, month, day] = isoDateMatch;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).toISOString();
  }
  return null;
}

function parseIntValue(value: string | null): number {
  if (!value) return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseNumber(value: string | null): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[^0-9.-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildReturnKey(parts: Array<string | number | null>): string {
  const joined = parts.map((part) => (part === null || part === undefined ? "" : String(part))).join("|");
  return crypto.createHash("md5").update(joined).digest("hex");
}

function getValue(row: string[], headerIndex: Map<string, number>, keys: string[]): string | null {
  for (const key of keys) {
    const index = headerIndex.get(key);
    if (index === undefined) continue;
    const value = row[index];
    if (value !== undefined && value !== null && value.trim() !== "") {
      return value.trim();
    }
  }
  return null;
}

async function ensureAuthorizedClient(
  req: NextApiRequest,
  supabaseUrl: string,
  anonKey: string,
  serviceRoleKey: string
): Promise<{ companyId: string; dataClient: SupabaseClient; serviceClient: SupabaseClient } | null> {
  const bearerToken = getBearerToken(req);
  if (!bearerToken) {
    return null;
  }

  const dataClient = createUserClient(supabaseUrl, anonKey, bearerToken);
  const { data: userData, error: userError } = await dataClient.auth.getUser();
  if (userError || !userData?.user) {
    return null;
  }

  const { data: membership, error: membershipError } = await dataClient
    .from("erp_company_users")
    .select("company_id, role_key")
    .eq("user_id", userData.user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (membershipError || !membership?.company_id) {
    return null;
  }

  if (!ALLOWED_ROLE_KEYS.includes(membership.role_key as (typeof ALLOWED_ROLE_KEYS)[number])) {
    return null;
  }

  return {
    companyId: membership.company_id,
    dataClient,
    serviceClient: createServiceRoleClient(supabaseUrl, serviceRoleKey),
  };
}

function parseReturnsReport(rows: string[][]): { records: ParsedReturn[]; skippedRows: number } {
  if (rows.length <= 1) {
    return { records: [], skippedRows: 0 };
  }

  const headers = rows[0].map((header) => header.trim());
  const headerIndex = new Map<string, number>();
  headers.forEach((header, idx) => {
    headerIndex.set(normalizeHeader(header), idx);
  });

  const orderIdKeys = ["order-id", "amazon-order-id", "orderid", "amazonorderid"];
  const returnDateKeys = ["return-date", "return-date-utc", "return-request-date", "return-date-time", "return date"];
  const skuKeys = ["sku", "merchant-sku", "seller-sku", "seller-sku-id", "merchant-sku-id"];
  const asinKeys = ["asin", "asin-1", "asin1"];
  const qtyKeys = ["quantity", "qty", "return-quantity", "return-qty", "quantity-returned"];
  const reasonKeys = ["reason", "return-reason", "return reason", "customer-return-reason"];
  const rmaKeys = ["rma-id", "rma id", "return-merchandise-authorization-id"];
  const statusKeys = ["status", "return-status", "return status"];
  const dispositionKeys = ["disposition", "return-disposition", "return disposition"];
  const currencyKeys = ["currency", "currency-code", "currencycode"];
  const amountKeys = ["amount", "amount-reported", "refund-amount", "return-amount", "return-credit"];

  const records: ParsedReturn[] = [];
  let skippedRows = 0;

  rows.slice(1).forEach((row) => {
    if (!row.some((cell) => cell.trim() !== "")) {
      return;
    }

    const orderId = getValue(row, headerIndex, orderIdKeys);
    const returnDate = parseDateValue(getValue(row, headerIndex, returnDateKeys));
    const sku = getValue(row, headerIndex, skuKeys);
    const asin = getValue(row, headerIndex, asinKeys);
    const qty = parseIntValue(getValue(row, headerIndex, qtyKeys));
    const reason = getValue(row, headerIndex, reasonKeys);
    const rmaId = getValue(row, headerIndex, rmaKeys);
    const status = getValue(row, headerIndex, statusKeys);
    const disposition = getValue(row, headerIndex, dispositionKeys);
    const currency = getValue(row, headerIndex, currencyKeys);
    const amountReported = parseNumber(getValue(row, headerIndex, amountKeys));

    if (!orderId && !sku && !asin && !returnDate) {
      skippedRows += 1;
      return;
    }

    const raw: Record<string, string | null> = {};
    headers.forEach((header, index) => {
      raw[header] = row[index] ?? null;
    });

    records.push({
      amazon_order_id: orderId,
      return_date: returnDate,
      asin,
      sku,
      quantity: qty,
      reason,
      rma_id: rmaId,
      status,
      disposition,
      currency,
      amount_reported: amountReported,
      raw,
    });
  });

  return { records, skippedRows };
}

async function runReportSync(options: {
  auth: { companyId: string; serviceClient: SupabaseClient };
  marketplaceId: string;
  reportType: string;
  source: "mfn" | "fba";
  dataStartTime: string;
  dataEndTime: string;
}): Promise<{
  runId: string;
  reportId: string;
  rowCount: number;
  factsUpserted: number;
  insertedRows: number;
  skippedRows: number;
}> {
  const { auth, marketplaceId, reportType, source, dataStartTime, dataEndTime } = options;

  const runInsert = await auth.serviceClient
    .from("erp_channel_report_runs")
    .insert({
      company_id: auth.companyId,
      channel_key: CHANNEL_KEY,
      marketplace_id: marketplaceId,
      report_type: reportType,
      status: "requested",
      report_request: {
        reportType,
        marketplaceIds: [marketplaceId],
        dataStartTime,
        dataEndTime,
      },
    })
    .select("id")
    .single();

  if (runInsert.error || !runInsert.data?.id) {
    throw new Error(runInsert.error?.message || "Failed to create report run");
  }

  const runId = runInsert.data.id;

  const createResult = await amazonCreateReport({
    reportType,
    marketplaceIds: [marketplaceId],
    dataStartTime,
    dataEndTime,
  });

  const reportId = createResult.reportId;

  await auth.serviceClient
    .from("erp_channel_report_runs")
    .update({
      status: "processing",
      report_id: reportId,
      report_request: createResult.request,
      report_response: createResult.response,
    })
    .eq("id", runId);

  let reportStatus = await amazonGetReport({ reportId });
  let normalizedStatus = (reportStatus.processingStatus ?? "").toUpperCase();
  let attempt = 0;
  let delayMs = INITIAL_BACKOFF_MS;

  while (
    normalizedStatus &&
    !["DONE", "DONE_NO_DATA"].includes(normalizedStatus) &&
    !["FATAL", "CANCELLED", "ERROR"].includes(normalizedStatus)
  ) {
    attempt += 1;
    if (attempt >= MAX_POLL_ATTEMPTS) {
      throw new Error(`Report not ready after ${MAX_POLL_ATTEMPTS} attempts (status ${normalizedStatus}).`);
    }

    await sleep(delayMs);
    delayMs = Math.min(Math.round(delayMs * 1.6), MAX_BACKOFF_MS);

    reportStatus = await amazonGetReport({ reportId });
    normalizedStatus = (reportStatus.processingStatus ?? "").toUpperCase();
  }

  if (["FATAL", "CANCELLED", "ERROR"].includes(normalizedStatus)) {
    await auth.serviceClient
      .from("erp_channel_report_runs")
      .update({
        status: "failed",
        error: `Report status ${normalizedStatus}`,
        report_response: { reportStatus },
      })
      .eq("id", runId);
    throw new Error(`Report failed (${normalizedStatus}).`);
  }

  if (normalizedStatus === "DONE_NO_DATA") {
    await auth.serviceClient
      .from("erp_channel_report_runs")
      .update({
        status: "done",
        completed_at: new Date().toISOString(),
        row_count: 0,
        report_response: { reportStatus },
      })
      .eq("id", runId);

    return {
      runId,
      reportId,
      rowCount: 0,
      factsUpserted: 0,
      insertedRows: 0,
      skippedRows: 0,
    };
  }

  const reportDocumentId = reportStatus.reportDocumentId;
  if (!reportDocumentId) {
    throw new Error("Missing reportDocumentId in report status.");
  }

  const reportDocument = await amazonGetReportDocument({ reportDocumentId });
  const reportText = await amazonDownloadReportDocument({ reportDocument });

  await auth.serviceClient
    .from("erp_channel_report_runs")
    .update({
      report_document_id: reportDocumentId,
      report_response: { reportStatus, reportDocument, raw_report: reportText },
    })
    .eq("id", runId);

  const rows = parseReportText(reportText);
  const { records, skippedRows } = parseReturnsReport(rows);
  const rowCount = records.length;

  if (rowCount === 0) {
    await auth.serviceClient
      .from("erp_channel_report_runs")
      .update({
        status: "done",
        completed_at: new Date().toISOString(),
        row_count: 0,
        report_response: { reportStatus, reportDocument, parsed_rows: 0, skippedRows },
      })
      .eq("id", runId);

    return {
      runId,
      reportId,
      rowCount: 0,
      factsUpserted: 0,
      insertedRows: 0,
      skippedRows,
    };
  }

  const upsertPayload = records.map((record) => {
    const returnKey = buildReturnKey([
      auth.companyId,
      source,
      record.amazon_order_id,
      record.rma_id,
      record.asin,
      record.sku,
      record.return_date,
      record.quantity,
    ]);

    return {
      company_id: auth.companyId,
      marketplace_id: marketplaceId,
      amazon_order_id: record.amazon_order_id,
      return_date: record.return_date,
      asin: record.asin,
      sku: record.sku,
      external_sku: record.sku,
      quantity: record.quantity,
      reason: record.reason,
      rma_id: record.rma_id,
      status: record.status,
      disposition: record.disposition,
      currency: record.currency,
      amount_reported: record.amount_reported,
      refund_amount: record.amount_reported,
      source,
      source_run_id: runId,
      return_key: returnKey,
      payload: record.raw,
    };
  });

  const upsertResponse = await auth.serviceClient
    .from("erp_amazon_return_facts")
    .upsert(upsertPayload, {
      onConflict: "company_id,return_key",
    })
    .select("id");

  if (upsertResponse.error) {
    await auth.serviceClient
      .from("erp_channel_report_runs")
      .update({
        status: "failed",
        error: upsertResponse.error.message,
        report_response: { reportStatus, reportDocument, parsed_rows: rowCount },
      })
      .eq("id", runId);
    throw new Error(upsertResponse.error.message);
  }

  const factsUpserted = upsertResponse.data?.length ?? 0;

  await auth.serviceClient
    .from("erp_channel_report_runs")
    .update({
      status: "done",
      completed_at: new Date().toISOString(),
      row_count: rowCount,
      report_response: { reportStatus, reportDocument, parsed_rows: rowCount, skippedRows },
    })
    .eq("id", runId);

  return {
    runId,
    reportId,
    rowCount,
    factsUpserted,
    insertedRows: rowCount,
    skippedRows,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<SyncResponse>): Promise<void> {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const { supabaseUrl, anonKey, serviceRoleKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || !serviceRoleKey || missing.length > 0) {
    res.status(500).json({
      ok: false,
      error:
        "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
    });
    return;
  }

  const parseResult = requestSchema.safeParse(req.body ?? req.query ?? {});
  if (!parseResult.success) {
    res.status(400).json({ ok: false, error: "Invalid request body" });
    return;
  }

  const auth = await ensureAuthorizedClient(req, supabaseUrl, anonKey, serviceRoleKey);
  if (!auth) {
    res.status(401).json({ ok: false, error: "Not authorized to sync returns reports" });
    return;
  }

  const marketplaceId = parseResult.data.marketplaceId ?? DEFAULT_MARKETPLACE_ID;
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const startValue = parseResult.data.start ?? parseResult.data.from;
  const endValue = parseResult.data.end ?? parseResult.data.to;
  const fromDate = startValue ? new Date(startValue) : defaultFrom;
  const toDate = endValue ? new Date(endValue) : now;

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    res.status(400).json({ ok: false, error: "Invalid start/end date" });
    return;
  }

  const dataStartTime = fromDate.toISOString();
  const dataEndTime = toDate.toISOString();
  const mode = parseResult.data.mode ?? "all";

  const reportQueue: Array<{ reportType: string; source: "mfn" | "fba" }> = [];
  if (mode === "all" || mode === "mfn") {
    reportQueue.push({ reportType: MFN_REPORT_TYPE, source: "mfn" });
  }
  if (mode === "all" || mode === "fba") {
    reportQueue.push({ reportType: FBA_REPORT_TYPE, source: "fba" });
  }

  try {
    const runResults: Array<{
      run_id: string;
      report_id: string;
      report_type: string;
      row_count: number;
      facts_upserted: number;
      inserted_rows: number;
      skipped_rows: number;
    }> = [];

    for (const report of reportQueue) {
      const result = await runReportSync({
        auth,
        marketplaceId,
        reportType: report.reportType,
        source: report.source,
        dataStartTime,
        dataEndTime,
      });

      runResults.push({
        run_id: result.runId,
        report_id: result.reportId,
        report_type: report.reportType,
        row_count: result.rowCount,
        facts_upserted: result.factsUpserted,
        inserted_rows: result.insertedRows,
        skipped_rows: result.skippedRows,
      });
    }

    const totals = runResults.reduce(
      (acc, row) => {
        acc.row_count += row.row_count;
        acc.facts_upserted += row.facts_upserted;
        acc.inserted_rows += row.inserted_rows;
        acc.skipped_rows += row.skipped_rows;
        return acc;
      },
      { row_count: 0, facts_upserted: 0, inserted_rows: 0, skipped_rows: 0 }
    );

    res.status(200).json({
      ok: true,
      runs: runResults,
      row_count: totals.row_count,
      facts_upserted: totals.facts_upserted,
      inserted_rows: totals.inserted_rows,
      skipped_rows: totals.skipped_rows,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to sync returns reports.",
    });
  }
}
