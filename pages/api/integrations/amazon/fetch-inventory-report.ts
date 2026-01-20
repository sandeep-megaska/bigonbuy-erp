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
  | { ok: true; status: "queued" | "processing"; nextPollAfterMs: number; message?: string }
  | { ok: true; status: "done"; rowsInserted: number; message?: string }
  | { ok: true; status: "failed"; message: string; details?: string }
  | { ok: false; error: string; details?: string };

type VariantRow = {
  id: string;
  sku: string;
  title: string | null;
  size: string | null;
  color: string | null;
  hsn: string | null;
};

type ExternalRowInsert = {
  company_id: string;
  batch_id: string;
  channel_key: string;
  marketplace_id: string | null;
  external_sku: string;
  asin: string | null;
  fnsku: string | null;
  condition: string | null;
  qty_available: number;
  qty_reserved: number;
  qty_inbound_working: number;
  qty_inbound_shipped: number;
  qty_inbound_receiving: number;
  external_location_code: string | null;
  erp_variant_id: string | null;
  erp_sku: string | null;
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
const DEFAULT_POLL_MS = 60000;
const THROTTLED_POLL_MS = 120000;

function toInt(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&").replace(/,/g, "\\,");
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
      .select("id, sku, title, size, color, hsn")
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
    .not("erp_variant_id", "is", null);

  if (matchedCountError) {
    throw new Error(matchedCountError.message || "Failed to count matched inventory rows");
  }

  const { count: unmatchedCount, error: unmatchedCountError } = await client
    .from("erp_external_inventory_rows")
    .select("id", { count: "exact", head: true })
    .eq("batch_id", batchId)
    .is("erp_variant_id", null);

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

  try {
    const accessToken = await getAmazonAccessToken();
    const { companyId, client } = await resolveCompanyClient(
      req,
      supabaseUrl,
      anonKey,
      serviceRoleKey
    );

    const { data: batch, error: batchError } = await client
      .from("erp_external_inventory_batches")
      .select(
        "id, channel_key, marketplace_id, pulled_at, status, external_report_id, report_id, report_type, report_document_id"
      )
      .eq("id", parseResult.data.batchId)
      .maybeSingle();

    if (batchError || !batch) {
      return res.status(404).json({ ok: false, error: batchError?.message || "Batch not found" });
    }

    const reportId = batch.report_id ?? batch.external_report_id;
    if (!reportId) {
      await client
        .from("erp_external_inventory_batches")
        .update({ status: "failed", notes: "Missing report ID for batch." })
        .eq("id", batch.id);
      return res.status(200).json({ ok: true, status: "failed", message: "Missing report ID for batch." });
    }

    if (batch.status === "done" || batch.status === "completed") {
      const summary = await fetchBatchSummary(client, batch.id);
      return res.status(200).json({
        ok: true,
        status: "done",
        rowsInserted: summary.row_count,
        message: "Inventory snapshot already processed.",
      });
    }

    const reportStatusResponse = await spApiSignedFetch({
      method: "GET",
      path: `/reports/2021-06-30/reports/${reportId}`,
      accessToken,
    });

    const reportStatusJson = await reportStatusResponse.json();
    const isThrottledResponse =
      reportStatusResponse.status === 429 ||
      (Array.isArray((reportStatusJson as { errors?: Array<{ code?: string }> }).errors) &&
        (reportStatusJson as { errors?: Array<{ code?: string }> }).errors?.some((error) =>
          /quota|throttl/i.test(error?.code ?? "")
        ));
    if (!reportStatusResponse.ok) {
      if (isThrottledResponse) {
        return res.status(200).json({
          ok: true,
          status: "processing",
          nextPollAfterMs: THROTTLED_POLL_MS,
          message: "Amazon throttled the request. Retrying soon.",
        });
      }
      await client
        .from("erp_external_inventory_batches")
        .update({ status: "failed", notes: `SP-API status error: ${JSON.stringify(reportStatusJson)}` })
        .eq("id", batch.id);
      return res.status(200).json({
        ok: true,
        status: "failed",
        message: "Amazon report status failed.",
        details: JSON.stringify(reportStatusJson),
      });
    }

    const parsedStatus = reportStatusSchema.safeParse(reportStatusJson);
    const processingStatus = parsedStatus.success
      ? parsedStatus.data.processingStatus
      : (reportStatusJson as { processingStatus?: string })?.processingStatus;

    const normalizedStatus = processingStatus?.toUpperCase() ?? "UNKNOWN";

    if (["CANCELLED", "FATAL"].includes(normalizedStatus)) {
      const errorDetails = JSON.stringify(reportStatusJson);
      await client
        .from("erp_external_inventory_batches")
        .update({ status: "failed", notes: `Report status: ${normalizedStatus}. ${errorDetails}` })
        .eq("id", batch.id);
      return res.status(200).json({
        ok: true,
        status: "failed",
        message: `Report status: ${normalizedStatus}`,
        details: errorDetails,
      });
    }

    if (normalizedStatus !== "DONE") {
      const queuedStatus = normalizedStatus === "IN_QUEUE" ? "queued" : "processing";
      await client
        .from("erp_external_inventory_batches")
        .update({ status: "processing" })
        .eq("id", batch.id);
      return res.status(200).json({
        ok: true,
        status: queuedStatus,
        nextPollAfterMs: DEFAULT_POLL_MS,
        message: normalizedStatus === "IN_QUEUE" ? "Report queued with Amazon." : "Report processing.",
      });
    }

    const reportDocumentId = parsedStatus.success
      ? parsedStatus.data.reportDocumentId
      : (reportStatusJson as { reportDocumentId?: string })?.reportDocumentId;

    if (!reportDocumentId) {
      await client
        .from("erp_external_inventory_batches")
        .update({ status: "failed", notes: "Missing reportDocumentId." })
        .eq("id", batch.id);
      return res.status(200).json({ ok: true, status: "failed", message: "Missing report document ID." });
    }

    const documentResponse = await spApiSignedFetch({
      method: "GET",
      path: `/reports/2021-06-30/documents/${reportDocumentId}`,
      accessToken,
    });

    const documentJson = await documentResponse.json();
    const documentIsThrottled =
      documentResponse.status === 429 ||
      (Array.isArray((documentJson as { errors?: Array<{ code?: string }> }).errors) &&
        (documentJson as { errors?: Array<{ code?: string }> }).errors?.some((error) =>
          /quota|throttl/i.test(error?.code ?? "")
        ));
    if (!documentResponse.ok) {
      if (documentIsThrottled) {
        return res.status(200).json({
          ok: true,
          status: "processing",
          nextPollAfterMs: THROTTLED_POLL_MS,
          message: "Amazon throttled the document request.",
        });
      }
      await client
        .from("erp_external_inventory_batches")
        .update({ status: "failed", notes: `SP-API document error: ${JSON.stringify(documentJson)}` })
        .eq("id", batch.id);
      return res.status(200).json({
        ok: true,
        status: "failed",
        message: "Amazon report document fetch failed.",
        details: JSON.stringify(documentJson),
      });
    }

    const parsedDocument = reportDocumentSchema.safeParse(documentJson);
    if (!parsedDocument.success) {
      return res.status(500).json({ ok: false, error: "Unexpected report document response" });
    }

    const documentFetch = await fetch(parsedDocument.data.url);
    if (!documentFetch.ok) {
      await client
        .from("erp_external_inventory_batches")
        .update({ status: "failed", notes: "Failed to download report document." })
        .eq("id", batch.id);
      return res.status(200).json({ ok: true, status: "failed", message: "Failed to download report document." });
    }

    const buffer = Buffer.from(await documentFetch.arrayBuffer());
    const decompressed = parsedDocument.data.compressionAlgorithm === "GZIP" ? gunzipSync(buffer) : buffer;
    const text = decompressed.toString("utf8");

    const delimiter = text.includes("\t") ? "\t" : ",";
    const rows = parseDelimited(text, delimiter);
    if (rows.length === 0) {
      await client
        .from("erp_external_inventory_batches")
        .update({
          status: "done",
          pulled_at: new Date().toISOString(),
          report_document_id: reportDocumentId,
        })
        .eq("id", batch.id);
      return res.status(200).json({ ok: true, status: "done", rowsInserted: 0, message: "No rows in report." });
    }

    const [headerRow, ...dataRows] = rows;
    const normalizedHeaders = headerRow.map((header) =>
      header
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, "-")
    );
    const headerIndex = new Map<string, number>();
    normalizedHeaders.forEach((header, index) => {
      headerIndex.set(header, index);
    });

    const getCell = (row: string[], headers: string[]): string => {
      for (const header of headers) {
        const idx = headerIndex.get(header);
        if (idx !== undefined) {
          return row[idx]?.trim() ?? "";
        }
      }
      return "";
    };

    const skuHeaders = ["seller-sku", "sku", "merchant-sku"];
    const hasSkuHeader = skuHeaders.some((header) => headerIndex.has(header));
    if (!hasSkuHeader) {
      await client
        .from("erp_external_inventory_batches")
        .update({ status: "failed", notes: "Missing SKU header in report." })
        .eq("id", batch.id);
      return res.status(200).json({ ok: true, status: "failed", message: "Missing SKU column in report." });
    }
    const externalSkus = dataRows
      .map((row) => getCell(row, skuHeaders))
      .map((sku) => sku.trim())
      .filter((sku) => sku.length > 0);
    const normalizedSkus = externalSkus.map((sku) => sku.toLowerCase());
    const matchesBySku = await fetchVariantMatches(client, companyId, normalizedSkus);

    const existingRows = await client
      .from("erp_external_inventory_rows")
      .select("id", { count: "exact", head: true })
      .eq("batch_id", batch.id);

    if (existingRows.error) {
      throw new Error(existingRows.error.message || "Failed to check existing rows");
    }

    if ((existingRows.count ?? 0) === 0) {
      const inserts: ExternalRowInsert[] = [];
      dataRows.forEach((row) => {
        const sku = getCell(row, skuHeaders).trim();
        if (!sku) return;
        const key = sku.toLowerCase();
        const variantMatches = matchesBySku.get(key) ?? [];
        let matchStatus: ExternalRowInsert["match_status"] = "unmatched";
        let erpVariantId: string | null = null;
        let erpSku: string | null = null;

        if (variantMatches.length === 1) {
          matchStatus = "matched";
          erpVariantId = variantMatches[0].id;
          erpSku = variantMatches[0].sku;
        } else if (variantMatches.length > 1) {
          matchStatus = "ambiguous";
        }

        const fulfillableRaw = getCell(row, ["afn-fulfillable-quantity"]);
        const qtyAvailable = fulfillableRaw
          ? toInt(fulfillableRaw)
          : toInt(getCell(row, ["afn-warehouse-quantity", "afn-quantity"]));

        inserts.push({
          company_id: companyId,
          batch_id: batch.id,
          channel_key: "amazon",
          marketplace_id: batch.marketplace_id ?? null,
          external_sku: sku,
          asin: getCell(row, ["asin"]) || null,
          fnsku: getCell(row, ["fnsku"]) || null,
          condition: getCell(row, ["condition"]) || null,
          qty_available: qtyAvailable,
          qty_reserved: toInt(getCell(row, ["afn-reserved-quantity", "reserved-quantity"])),
          qty_inbound_working: toInt(getCell(row, ["afn-inbound-working-quantity"])),
          qty_inbound_shipped: toInt(getCell(row, ["afn-inbound-shipped-quantity"])),
          qty_inbound_receiving: toInt(getCell(row, ["afn-inbound-receiving-quantity"])),
          external_location_code: null,
          erp_variant_id: erpVariantId,
          erp_sku: erpSku,
          erp_warehouse_id: null,
          match_status: matchStatus,
          raw: buildRawRecord(headerRow, row),
        });
      });

      const chunkSize = 500;
      for (let i = 0; i < inserts.length; i += chunkSize) {
        const chunk = inserts.slice(i, i + chunkSize);
        if (chunk.length === 0) continue;
        const { error } = await client.from("erp_external_inventory_rows").insert(chunk);
        if (error) {
          throw new Error(error.message || "Failed to insert inventory rows");
        }
      }
    }

    const updatedBatch = await client
      .from("erp_external_inventory_batches")
      .update({
        status: "done",
        pulled_at: new Date().toISOString(),
        report_document_id: reportDocumentId,
        report_type: batch.report_type ?? null,
        report_id: reportId,
      })
      .eq("id", batch.id)
      .select("id, channel_key, marketplace_id, pulled_at")
      .single();

    if (updatedBatch.error || !updatedBatch.data) {
      throw new Error(updatedBatch.error?.message || "Failed to update batch status");
    }

    const summary = await fetchBatchSummary(client, batch.id);

    return res.status(200).json({
      ok: true,
      status: "done",
      rowsInserted: summary.row_count,
      message: "Inventory snapshot processed.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
