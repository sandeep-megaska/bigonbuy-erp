import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { gunzipSync } from "zlib";
import { getAmazonAccessToken, spApiSignedFetch } from "../../../../lib/amazonSpApi";
import { parseDelimited } from "../../../../lib/erp/parseCsv";
import {
  createServiceRoleClient,
  createUserClient,
  getBearerToken,
  getSupabaseEnv,
} from "../../../../lib/serverSupabase";

type ApiResponse =
  | {
      ok: true;
      status: "requested" | "processing" | "completed" | "failed";
      message?: string;
      rowsInserted?: number;
      matched?: number;
      unmatched?: number;
    }
  | { ok: false; error: string; details?: string };

type VariantRow = {
  id: string;
  sku: string;
  size: string | null;
  color: string | null;
};

type ExternalRowInsert = {
  batch_id: string;
  channel_key: string;
  marketplace_id: string | null;
  external_sku: string;
  external_sku_norm: string;
  asin: string | null;
  fnsku: string | null;
  condition: string | null;
  qty_available: number;
  qty_reserved: number;
  qty_inbound_working: number;
  qty_inbound_shipped: number;
  qty_inbound_receiving: number;
  available_qty: number;
  reserved_qty: number;
  inbound_qty: number;
  location: string | null;
  external_location_code: string | null;
  erp_variant_id: string | null;
  matched_variant_id: string | null;
  erp_warehouse_id: string | null;
  match_status: "matched" | "unmatched" | "ambiguous";
  raw: unknown;
};

const querySchema = z.object({
  batchId: z.string().uuid(),
});

const reportStatusSchema = z
  .object({
    processingStatus: z.string().optional(),
    reportDocumentId: z.string().optional(),
  })
  .passthrough();

const reportDocumentSchema = z
  .object({
    url: z.string().url(),
    compressionAlgorithm: z.string().optional(),
  })
  .passthrough();

const ALLOWED_ROLE_KEYS = ["owner", "admin", "inventory", "finance"] as const;

function toInt(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function normalizeSku(value: string): string {
  return value.trim().toUpperCase();
}

function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&").replace(/,/g, "\\,");
}

function extractReportErrorMessage(status: string, payload: unknown): string {
  const errors = (payload as { errors?: Array<{ code?: string; message?: string; details?: string }> })
    ?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const error = errors[0] ?? {};
    const details = [error.code, error.message, error.details].filter(Boolean).join(" — ");
    if (details) {
      return `Report status: ${status}. ${details}`;
    }
  }
  return `Report status: ${status}`;
}

async function resolveCompanyClient(
  req: NextApiRequest,
  supabaseUrl: string,
  anonKey: string,
  serviceRoleKey: string
): Promise<{ companyId: string; client: SupabaseClient }> {
  const internalToken = req.headers["x-internal-token"];
  const internalTokenValue = Array.isArray(internalToken) ? internalToken[0] : internalToken;
  const expectedToken = process.env.INTERNAL_ADMIN_TOKEN ?? null;
  const usingInternalToken = expectedToken && internalTokenValue === expectedToken;

  let companyId: string | null = null;
  let dataClient: SupabaseClient = createUserClient(supabaseUrl, anonKey, "");

  if (usingInternalToken) {
    const queryParse = querySchema.safeParse(req.query ?? {});
    const companyIdValue =
      (typeof req.query?.companyId === "string" ? req.query.companyId : null) ??
      (typeof req.query?.company_id === "string" ? req.query.company_id : null);

    if (!queryParse.success || !companyIdValue) {
      throw new Error("companyId is required when using internal token");
    }

    companyId = companyIdValue;
    dataClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);
  } else {
    const bearerToken = getBearerToken(req);
    if (!bearerToken) {
      throw new Error("Missing Authorization: Bearer token");
    }

    dataClient = createUserClient(supabaseUrl, anonKey, bearerToken);
    const { data: userData, error: userError } = await dataClient.auth.getUser();
    if (userError || !userData?.user) {
      throw new Error("Not authenticated");
    }

    const { data: membership, error: membershipError } = await dataClient
      .from("erp_company_users")
      .select("company_id, role_key")
      .eq("user_id", userData.user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (membershipError) {
      throw new Error(membershipError.message);
    }

    if (!membership?.company_id) {
      throw new Error("No active company membership");
    }

    if (!ALLOWED_ROLE_KEYS.includes(membership.role_key as (typeof ALLOWED_ROLE_KEYS)[number])) {
      throw new Error("Not authorized to pull inventory");
    }

    companyId = membership.company_id;
  }

  if (!companyId) {
    throw new Error("Missing companyId");
  }

  return { companyId, client: dataClient };
}

async function fetchBatchSummary(
  client: SupabaseClient,
  batchId: string
): Promise<{
  row_count: number;
  matched_count: number;
  unmatched_count: number;
}> {
  const { count: rowCount, error: rowCountError } = await client
    .from("erp_external_inventory_rows")
    .select("id", { count: "exact", head: true })
    .eq("batch_id", batchId);

  if (rowCountError) {
    throw new Error(rowCountError.message || "Failed to count inventory rows");
  }

  const { count: matchedCount, error: matchedCountError } = await client
    .from("erp_external_inventory_rows")
    .select("id", { count: "exact", head: true })
    .eq("batch_id", batchId)
    .eq("match_status", "matched");

  if (matchedCountError) {
    throw new Error(matchedCountError.message || "Failed to count matched inventory rows");
  }

  const { count: unmatchedCount, error: unmatchedCountError } = await client
    .from("erp_external_inventory_rows")
    .select("id", { count: "exact", head: true })
    .eq("batch_id", batchId)
    .in("match_status", ["unmatched", "ambiguous"]);

  if (unmatchedCountError) {
    throw new Error(unmatchedCountError.message || "Failed to count unmatched inventory rows");
  }

  return {
    row_count: rowCount ?? 0,
    matched_count: matchedCount ?? 0,
    unmatched_count: unmatchedCount ?? 0,
  };
}

function buildRawRecord(headers: string[], row: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((header, index) => {
    record[header] = row[index] ?? "";
  });
  return record;
}

function detectDelimiter(sampleLines: string[]): string {
  const candidates = [",", "\t", "|"];
  const scores = new Map<string, number>(candidates.map((candidate) => [candidate, 0]));

  sampleLines.forEach((line) => {
    candidates.forEach((delimiter) => {
      const count = line.split(delimiter).length - 1;
      scores.set(delimiter, (scores.get(delimiter) ?? 0) + count);
    });
  });

  let bestDelimiter = ",";
  let bestScore = -1;
  scores.forEach((score, delimiter) => {
    if (score > bestScore) {
      bestDelimiter = delimiter;
      bestScore = score;
    }
  });

  return bestDelimiter;
}

function parseReportText(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const delimiter = detectDelimiter(lines.slice(0, 10));
  return parseDelimited(text, delimiter);
}

function normalizeHeaderName(header: string): string {
  return header.replace(/\uFEFF/g, "").trim().toLowerCase();
}

function isSkippableRow(row: string[]): boolean {
  if (row.every((cell) => cell.trim().length === 0)) return true;
  if (row.length === 1 && row[0]?.trim().startsWith("#")) return true;
  return false;
}

function pickHeader(headers: Map<string, number>, candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (headers.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function fetchVariantMatches(
  client: SupabaseClient,
  companyId: string,
  skus: string[]
): Promise<Map<string, VariantRow[]>> {
  const matches = new Map<string, VariantRow[]>();
  const uniqueSkus = Array.from(new Set(skus));
  const chunkSize = 50;

  for (let i = 0; i < uniqueSkus.length; i += chunkSize) {
    const chunk = uniqueSkus.slice(i, i + chunkSize);
    const orFilter = chunk.map((sku) => `sku.ilike.${escapeIlike(sku)}`).join(",");

    const { data, error } = await client
      .from("erp_variants")
      .select("id, sku, size, color")
      .eq("company_id", companyId)
      .or(orFilter);

    if (error) {
      throw new Error(error.message || "Failed to match ERP SKUs");
    }

    (data || []).forEach((row: VariantRow) => {
      const key = row.sku.toLowerCase();
      const existing = matches.get(key) ?? [];
      existing.push(row);
      matches.set(key, existing);
    });
  }

  return matches;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey, serviceRoleKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || !serviceRoleKey || missing.length > 0) {
    return res.status(500).json({
      ok: false,
      error:
        "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const parseResult = querySchema.safeParse(req.query ?? {});
  if (!parseResult.success) {
    return res.status(400).json({ ok: false, error: "Invalid query params" });
  }

  let batchId: string | null = null;
  let dataClient: SupabaseClient | null = null;

  try {
    const accessToken = await getAmazonAccessToken();
    const { companyId, client } = await resolveCompanyClient(
      req,
      supabaseUrl,
      anonKey,
      serviceRoleKey
    );
    dataClient = client;

    const { data: batch, error: batchError } = await client
      .from("erp_external_inventory_batches")
      .select(
        "id, channel_key, marketplace_id, pulled_at, status, external_report_id, report_id, report_document_id, report_type, rows_total, matched_count, unmatched_count, error"
      )
      .eq("id", parseResult.data.batchId)
      .maybeSingle();

    if (batchError || !batch) {
      return res.status(404).json({ ok: false, error: batchError?.message || "Batch not found" });
    }

    batchId = batch.id;

    const reportId = batch.report_id ?? batch.external_report_id;
    if (!reportId) {
      await client.rpc("erp_inventory_external_batch_update", {
        p_batch_id: batch.id,
        p_status: "fatal",
        p_error: "Missing report ID for batch.",
        p_report_response: { error: "Missing report ID for batch." },
      });
      return res.status(200).json({
        ok: true,
        status: "failed",
        message: "Missing report ID for batch.",
      });
    }

    if (batch.status === "done") {
      return res.status(200).json({
        ok: true,
        status: "completed",
        message: "Report completed.",
        rowsInserted: batch.rows_total ?? 0,
        matched: batch.matched_count ?? 0,
        unmatched: batch.unmatched_count ?? 0,
      });
    }

    if (batch.status === "fatal") {
      return res.status(200).json({
        ok: true,
        status: "failed",
        message: batch.error || "Report generation failed.",
      });
    }

    const reportStatusResponse = await spApiSignedFetch({
      method: "GET",
      path: `/reports/2021-06-30/reports/${reportId}`,
      accessToken,
    });

    const reportStatusJson = await reportStatusResponse.json();
    if (!reportStatusResponse.ok) {
      const message = `SP-API error: ${JSON.stringify(reportStatusJson)}`;
      await client.rpc("erp_inventory_external_batch_update", {
        p_batch_id: batch.id,
        p_status: "fatal",
        p_error: message,
        p_report_processing_status:
          (reportStatusJson as { processingStatus?: string })?.processingStatus ?? "ERROR",
        p_report_response: reportStatusJson,
      });
      return res.status(200).json({
        ok: true,
        status: "failed",
        message,
      });
    }

    const parsedStatus = reportStatusSchema.safeParse(reportStatusJson);
    const processingStatus = parsedStatus.success
      ? parsedStatus.data.processingStatus
      : (reportStatusJson as { processingStatus?: string })?.processingStatus;

    const normalizedStatus = processingStatus?.toUpperCase() ?? "UNKNOWN";
    const baseUpdate = {
      p_batch_id: batch.id,
      p_report_processing_status: normalizedStatus,
      p_report_response: reportStatusJson,
    };

    if (["CANCELLED", "FATAL", "DONE_NO_DATA"].includes(normalizedStatus)) {
      const fatalMessage = extractReportErrorMessage(normalizedStatus, reportStatusJson);
      await client.rpc("erp_inventory_external_batch_update", {
        ...baseUpdate,
        p_status: "fatal",
        p_error: fatalMessage,
      });

      return res.status(200).json({
        ok: true,
        status: "failed",
        message: fatalMessage,
      });
    }

    if (["IN_QUEUE", "IN_PROGRESS"].includes(normalizedStatus)) {
      await client.rpc("erp_inventory_external_batch_update", {
        ...baseUpdate,
        p_status: "in_progress",
      });
      return res.status(200).json({
        ok: true,
        status: "processing",
        message: "Report still processing.",
      });
    }

    if (normalizedStatus !== "DONE") {
      await client.rpc("erp_inventory_external_batch_update", baseUpdate);
      return res.status(200).json({
        ok: true,
        status: "processing",
        message: `Report status: ${normalizedStatus}`,
      });
    }

    const reportDocumentId = parsedStatus.success
      ? parsedStatus.data.reportDocumentId
      : (reportStatusJson as { reportDocumentId?: string })?.reportDocumentId;

    if (!reportDocumentId) {
      const message = "Missing reportDocumentId.";
      await client.rpc("erp_inventory_external_batch_update", {
        ...baseUpdate,
        p_status: "fatal",
        p_error: message,
      });
      return res.status(200).json({
        ok: true,
        status: "failed",
        message,
      });
    }

    await client.rpc("erp_inventory_external_batch_update", {
      ...baseUpdate,
      p_report_document_id: reportDocumentId,
    });

    const documentResponse = await spApiSignedFetch({
      method: "GET",
      path: `/reports/2021-06-30/documents/${reportDocumentId}`,
      accessToken,
    });

    const documentJson = await documentResponse.json();
    if (!documentResponse.ok) {
      const message = `SP-API error: ${JSON.stringify(documentJson)}`;
      await client.rpc("erp_inventory_external_batch_update", {
        ...baseUpdate,
        p_status: "fatal",
        p_error: message,
        p_report_response: { reportStatus: reportStatusJson, reportDocument: documentJson },
      });
      return res.status(200).json({
        ok: true,
        status: "failed",
        message,
      });
    }

    const parsedDocument = reportDocumentSchema.safeParse(documentJson);
    if (!parsedDocument.success) {
      const message = "Unexpected report document response.";
      await client.rpc("erp_inventory_external_batch_update", {
        ...baseUpdate,
        p_status: "fatal",
        p_error: message,
        p_report_response: { reportStatus: reportStatusJson, reportDocument: documentJson },
      });
      return res.status(200).json({
        ok: true,
        status: "failed",
        message,
      });
    }

    const documentFetch = await fetch(parsedDocument.data.url);
    if (!documentFetch.ok) {
      const message = "Failed to download report document.";
      await client.rpc("erp_inventory_external_batch_update", {
        ...baseUpdate,
        p_status: "fatal",
        p_error: message,
        p_report_response: {
          reportStatus: reportStatusJson,
          reportDocument: documentJson,
          downloadStatus: documentFetch.status,
        },
      });
      return res.status(200).json({
        ok: true,
        status: "failed",
        message,
      });
    }

    const buffer = Buffer.from(await documentFetch.arrayBuffer());
    const decompressed = parsedDocument.data.compressionAlgorithm === "GZIP" ? gunzipSync(buffer) : buffer;
    const text = decompressed.toString("utf8");

    const rawLines = text.split(/\r?\n/).slice(0, 10);
    console.info("[amazon inventory] report first lines", rawLines);

    const rows = parseReportText(text).filter((row) => !isSkippableRow(row));
    if (rows.length === 0) {
      await client.rpc("erp_inventory_external_batch_update", {
        ...baseUpdate,
        p_status: "done",
        p_pulled_at: new Date().toISOString(),
        p_rows_total: 0,
        p_matched_count: 0,
        p_unmatched_count: 0,
      });
      return res.status(200).json({
        ok: true,
        status: "completed",
        message: "Report completed with no rows.",
        rowsInserted: 0,
        matched: 0,
        unmatched: 0,
      });
    }

    const skuHeaderCandidates = [
      "seller-sku",
      "seller_sku",
      "seller sku",
      "merchant-sku",
      "merchant sku",
      "sku",
    ];

    let headerRowIndex = rows.findIndex((row) => {
      const normalized = row.map((header) => normalizeHeaderName(header));
      if (normalized.length < 2) return false;
      return normalized.some((header) => skuHeaderCandidates.includes(header));
    });

    if (headerRowIndex === -1) {
      headerRowIndex = 0;
    }

    const headerRow = rows[headerRowIndex];
    const dataRows = rows.slice(headerRowIndex + 1);
    const normalizedHeaders = headerRow.map((header) => normalizeHeaderName(header));
    const headerIndex = new Map<string, number>();
    normalizedHeaders.forEach((header, index) => {
      headerIndex.set(header, index);
    });

    const getCell = (row: string[], header: string | null): string => {
      if (!header) return "";
      const idx = headerIndex.get(header);
      if (idx === undefined) return "";
      return row[idx]?.trim() ?? "";
    };

    const skuHeader =
      pickHeader(headerIndex, skuHeaderCandidates) ??
      (normalizedHeaders.find((header) => header.length > 0) ?? null);

    const asinHeader = pickHeader(headerIndex, ["asin"]);
    const fnskuHeader = pickHeader(headerIndex, ["fnsku"]);
    const conditionHeader = pickHeader(headerIndex, ["condition"]);
    const availableHeader = pickHeader(headerIndex, [
      "available",
      "afn-fulfillable-quantity",
      "afn-warehouse-quantity",
    ]);
    const reservedHeader = pickHeader(headerIndex, ["reserved", "afn-reserved-quantity"]);
    const inboundWorkingHeader = pickHeader(headerIndex, ["afn-inbound-working-quantity"]);
    const inboundShippedHeader = pickHeader(headerIndex, ["afn-inbound-shipped-quantity"]);
    const inboundReceivingHeader = pickHeader(headerIndex, ["afn-inbound-receiving-quantity"]);
    const inboundHeader = pickHeader(headerIndex, ["inbound"]);
    const locationHeader = pickHeader(headerIndex, [
      "fulfillment-center-id",
      "fulfillment center id",
      "location",
    ]);

    if (!skuHeader) {
      const fatalMessage = "Missing seller-sku column in report";
      await client.rpc("erp_inventory_external_batch_update", {
        ...baseUpdate,
        p_status: "fatal",
        p_error: fatalMessage,
      });

      return res.status(200).json({
        ok: true,
        status: "failed",
        message: fatalMessage,
      });
    }

    const existingRows = await client
      .from("erp_external_inventory_rows")
      .select("id", { count: "exact", head: true })
      .eq("batch_id", batch.id);

    if (existingRows.error) {
      throw new Error(existingRows.error.message || "Failed to check existing rows");
    }

    let rowsInserted = 0;
    const externalSkus = dataRows
      .map((row) => getCell(row, skuHeader))
      .filter((sku): sku is string => Boolean(sku))
      .map((sku) => sku.trim())
      .filter((sku) => sku.length > 0);

    const matchesBySku = await fetchVariantMatches(client, companyId, externalSkus);

    if ((existingRows.count ?? 0) === 0) {
      const inserts: ExternalRowInsert[] = [];
      dataRows.forEach((row) => {
        const sku = getCell(row, skuHeader);
        if (!sku) return;
        const normalizedSku = normalizeSku(sku);
        const skuKey = sku.trim().toLowerCase();
        const variantMatches = matchesBySku.get(skuKey) ?? [];
        let matchStatus: ExternalRowInsert["match_status"] = "unmatched";
        let erpVariantId: string | null = null;

        if (variantMatches.length === 1) {
          matchStatus = "matched";
          erpVariantId = variantMatches[0].id;
        } else if (variantMatches.length > 1) {
          matchStatus = "ambiguous";
        }

        const qtyAvailable = toInt(getCell(row, availableHeader));
        const qtyReserved = toInt(getCell(row, reservedHeader));
        const qtyInboundWorking = toInt(getCell(row, inboundWorkingHeader));
        const qtyInboundShipped = toInt(getCell(row, inboundShippedHeader));
        const qtyInboundReceiving = toInt(getCell(row, inboundReceivingHeader));
        const inboundTotalRaw = toInt(getCell(row, inboundHeader));
        const inboundTotal =
          qtyInboundWorking + qtyInboundShipped + qtyInboundReceiving > 0
            ? qtyInboundWorking + qtyInboundShipped + qtyInboundReceiving
            : inboundTotalRaw;
        const location = getCell(row, locationHeader) || null;

        inserts.push({
          batch_id: batch.id,
          channel_key: "amazon",
          marketplace_id: batch.marketplace_id ?? null,
          external_sku: sku,
          external_sku_norm: normalizedSku,
          asin: getCell(row, asinHeader) || null,
          fnsku: getCell(row, fnskuHeader) || null,
          condition: getCell(row, conditionHeader) || null,
          qty_available: qtyAvailable,
          qty_reserved: qtyReserved,
          qty_inbound_working: qtyInboundWorking,
          qty_inbound_shipped: qtyInboundShipped,
          qty_inbound_receiving: qtyInboundReceiving,
          available_qty: qtyAvailable,
          reserved_qty: qtyReserved,
          inbound_qty: inboundTotal,
          location,
          external_location_code: location,
          erp_variant_id: erpVariantId,
          matched_variant_id: erpVariantId,
          erp_warehouse_id: null,
          match_status: matchStatus,
          raw: buildRawRecord(normalizedHeaders, row),
        });
      });

      rowsInserted = inserts.length;
      const chunkSize = 500;
      for (let i = 0; i < inserts.length; i += chunkSize) {
        const chunk = inserts.slice(i, i + chunkSize);
        if (chunk.length === 0) continue;
        const { error } = await client.rpc("erp_inventory_external_rows_upsert", {
          p_rows: chunk,
        });
        if (error) {
          throw new Error(error.message || "Failed to insert inventory rows");
        }
      }
    }

    const summary = await fetchBatchSummary(client, batch.id);

    const updatedBatch = await client.rpc("erp_inventory_external_batch_update", {
      ...baseUpdate,
      p_status: "done",
      p_pulled_at: new Date().toISOString(),
      p_rows_total: summary.row_count,
      p_matched_count: summary.matched_count,
      p_unmatched_count: summary.unmatched_count,
    });

    if (updatedBatch.error) {
      throw new Error(updatedBatch.error?.message || "Failed to update batch status");
    }

    return res.status(200).json({
      ok: true,
      status: "completed",
      message: "Report completed.",
      rowsInserted,
      matched: summary.matched_count,
      unmatched: summary.unmatched_count,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (batchId && dataClient) {
      await dataClient.rpc("erp_inventory_external_batch_update", {
        p_batch_id: batchId,
        p_status: "fatal",
        p_error: message,
        p_report_response: { error: message },
      });
    }
    return res.status(500).json({ ok: false, error: message });
  }
}
