import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { gunzipSync } from "zlib";
import { getAmazonAccessToken, spApiSignedFetch } from "../../../../lib/amazonSpApi";
import { parseTsv } from "../../../../lib/erp/parseCsv";
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
      batch?: {
        id: string;
        channel_key: string;
        marketplace_id: string | null;
        pulled_at: string;
        row_count: number;
        matched_count: number;
        unmatched_count: number;
      };
      message?: string;
    }
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

function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&").replace(/,/g, "\\,");
}

function toInt(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
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
      .select("id, channel_key, marketplace_id, pulled_at, status, external_report_id")
      .eq("id", parseResult.data.batchId)
      .maybeSingle();

    if (batchError || !batch) {
      return res.status(404).json({ ok: false, error: batchError?.message || "Batch not found" });
    }

    if (!batch.external_report_id) {
      return res.status(500).json({ ok: false, error: "Missing report ID for batch" });
    }

    if (batch.status === "completed") {
      const summary = await fetchBatchSummary(client, batch.id);
      return res.status(200).json({
        ok: true,
        status: "completed",
        batch: {
          id: batch.id,
          channel_key: batch.channel_key,
          marketplace_id: batch.marketplace_id ?? null,
          pulled_at: batch.pulled_at,
          ...summary,
        },
      });
    }

    const reportStatusResponse = await spApiSignedFetch({
      method: "GET",
      path: `/reports/2021-06-30/reports/${batch.external_report_id}`,
      accessToken,
    });

    const reportStatusJson = await reportStatusResponse.json();
    if (!reportStatusResponse.ok) {
      return res.status(500).json({
        ok: false,
        error: `SP-API error: ${JSON.stringify(reportStatusJson)}`,
      });
    }

    const parsedStatus = reportStatusSchema.safeParse(reportStatusJson);
    const processingStatus = parsedStatus.success
      ? parsedStatus.data.processingStatus
      : (reportStatusJson as { processingStatus?: string })?.processingStatus;

    const normalizedStatus = processingStatus?.toUpperCase() ?? "UNKNOWN";

    if (["CANCELLED", "FATAL"].includes(normalizedStatus)) {
      await client
        .from("erp_external_inventory_batches")
        .update({ status: "failed" })
        .eq("id", batch.id);
      return res.status(200).json({ ok: true, status: "failed", message: `Report status: ${normalizedStatus}` });
    }

    if (normalizedStatus !== "DONE") {
      await client
        .from("erp_external_inventory_batches")
        .update({ status: "processing" })
        .eq("id", batch.id);
      return res.status(200).json({ ok: true, status: "processing" });
    }

    const reportDocumentId = parsedStatus.success
      ? parsedStatus.data.reportDocumentId
      : (reportStatusJson as { reportDocumentId?: string })?.reportDocumentId;

    if (!reportDocumentId) {
      return res.status(500).json({ ok: false, error: "Missing reportDocumentId" });
    }

    const documentResponse = await spApiSignedFetch({
      method: "GET",
      path: `/reports/2021-06-30/documents/${reportDocumentId}`,
      accessToken,
    });

    const documentJson = await documentResponse.json();
    if (!documentResponse.ok) {
      return res.status(500).json({ ok: false, error: `SP-API error: ${JSON.stringify(documentJson)}` });
    }

    const parsedDocument = reportDocumentSchema.safeParse(documentJson);
    if (!parsedDocument.success) {
      return res.status(500).json({ ok: false, error: "Unexpected report document response" });
    }

    const documentFetch = await fetch(parsedDocument.data.url);
    if (!documentFetch.ok) {
      return res.status(500).json({ ok: false, error: "Failed to download report document" });
    }

    const buffer = Buffer.from(await documentFetch.arrayBuffer());
    const decompressed = parsedDocument.data.compressionAlgorithm === "GZIP" ? gunzipSync(buffer) : buffer;
    const text = decompressed.toString("utf8");

    const rows = parseTsv(text);
    if (rows.length === 0) {
      await client
        .from("erp_external_inventory_batches")
        .update({ status: "completed", pulled_at: new Date().toISOString() })
        .eq("id", batch.id);
      return res.status(200).json({ ok: true, status: "completed" });
    }

    const [headerRow, ...dataRows] = rows;
    const normalizedHeaders = headerRow.map((header) => header.trim().toLowerCase());
    const headerIndex = new Map<string, number>();
    normalizedHeaders.forEach((header, index) => {
      headerIndex.set(header, index);
    });

    const getCell = (row: string[], header: string): string => {
      const idx = headerIndex.get(header);
      if (idx === undefined) return "";
      return row[idx]?.trim() ?? "";
    };

    const externalSkus = dataRows
      .map((row) => getCell(row, "sku"))
      .filter((sku) => sku.length > 0);
    const matchesBySku = await fetchVariantMatches(client, companyId, externalSkus);

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
        const sku = getCell(row, "sku");
        if (!sku) return;
        const key = sku.toLowerCase();
        const variantMatches = matchesBySku.get(key) ?? [];
        let matchStatus: ExternalRowInsert["match_status"] = "unmatched";
        let erpVariantId: string | null = null;

        if (variantMatches.length === 1) {
          matchStatus = "matched";
          erpVariantId = variantMatches[0].id;
        } else if (variantMatches.length > 1) {
          matchStatus = "ambiguous";
        }

        const fulfillableRaw = getCell(row, "afn-fulfillable-quantity");
        const qtyAvailable = fulfillableRaw ? toInt(fulfillableRaw) : toInt(getCell(row, "afn-warehouse-quantity"));

        inserts.push({
          company_id: companyId,
          batch_id: batch.id,
          channel_key: "amazon",
          marketplace_id: batch.marketplace_id ?? null,
          external_sku: sku,
          asin: getCell(row, "asin") || null,
          fnsku: getCell(row, "fnsku") || null,
          condition: getCell(row, "condition") || null,
          qty_available: qtyAvailable,
          qty_reserved: toInt(getCell(row, "afn-reserved-quantity")),
          qty_inbound_working: toInt(getCell(row, "afn-inbound-working-quantity")),
          qty_inbound_shipped: toInt(getCell(row, "afn-inbound-shipped-quantity")),
          qty_inbound_receiving: toInt(getCell(row, "afn-inbound-receiving-quantity")),
          external_location_code: null,
          erp_variant_id: erpVariantId,
          erp_warehouse_id: null,
          match_status: matchStatus,
          raw: buildRawRecord(normalizedHeaders, row),
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
      .update({ status: "completed", pulled_at: new Date().toISOString() })
      .eq("id", batch.id)
      .select("id, channel_key, marketplace_id, pulled_at")
      .single();

    if (updatedBatch.error || !updatedBatch.data) {
      throw new Error(updatedBatch.error?.message || "Failed to update batch status");
    }

    const summary = await fetchBatchSummary(client, batch.id);

    return res.status(200).json({
      ok: true,
      status: "completed",
      batch: {
        id: updatedBatch.data.id,
        channel_key: updatedBatch.data.channel_key,
        marketplace_id: updatedBatch.data.marketplace_id ?? null,
        pulled_at: updatedBatch.data.pulled_at,
        ...summary,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
