import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  amazonCreateReport,
  amazonDownloadReportDocument,
  amazonGetReport,
  amazonGetReportDocument,
} from "../../../../../lib/oms/adapters/amazonSpApi";
import { parseDelimited } from "../../../../../lib/erp/parseCsv";
import {
  createServiceRoleClient,
  createUserClient,
  getBearerToken,
  getSupabaseEnv,
} from "../../../../../lib/serverSupabase";

const requestSchema = z.object({
  marketplaceId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

const DEFAULT_MARKETPLACE_ID = "A21TJRUUN4KGV";
const REPORT_TYPE = "GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL";
const CHANNEL_KEY = "amazon";
const MAX_POLL_ATTEMPTS = 12;
const INITIAL_BACKOFF_MS = 2500;
const MAX_BACKOFF_MS = 20000;

const ALLOWED_ROLE_KEYS = ["owner", "admin", "inventory", "finance"] as const;

type SyncResponse =
  | { ok: true; run_id: string; report_id: string; row_count: number; facts_upserted: number }
  | { ok: false; error: string; details?: string };

type VariantRow = {
  id: string;
  sku: string;
  style_code: string | null;
  size: string | null;
  color: string | null;
};

type DraftFact = {
  amazon_order_id: string;
  order_item_id: string;
  purchase_date: string | null;
  order_status: string | null;
  fulfillment_channel: string | null;
  sales_channel: string | null;
  buyer_email: string | null;
  buyer_name: string | null;
  ship_state: string | null;
  ship_city: string | null;
  ship_postal_code: string | null;
  asin: string | null;
  external_sku: string | null;
  fnsku: string | null;
  quantity: number;
  item_amount: number;
  item_tax: number;
  shipping_amount: number;
  shipping_tax: number;
  gift_wrap_amount: number;
  promo_discount: number;
  currency: string | null;
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

function parseDateValue(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function parseNumber(value: string | null): number {
  if (!value) return 0;
  const cleaned = value.replace(/[^0-9.-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseIntValue(value: string | null): number {
  if (!value) return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeSku(value: string | null): string {
  return value ? value.trim().toUpperCase() : "";
}

function normalizeSkuKey(value: string | null): string {
  return value ? value.trim().toLowerCase().replace(/\s+/g, " ") : "";
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
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

function parseReportText(text: string): string[][] {
  const sample = text.split(/\r?\n/)[0] ?? "";
  const delimiter = sample.includes("\t") ? "\t" : ",";
  return parseDelimited(text, delimiter);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SyncResponse>
): Promise<void> {
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

  const parseResult = requestSchema.safeParse(req.body ?? {});
  if (!parseResult.success) {
    res.status(400).json({ ok: false, error: "Invalid request body" });
    return;
  }

  const auth = await ensureAuthorizedClient(req, supabaseUrl, anonKey, serviceRoleKey);
  if (!auth) {
    res.status(401).json({ ok: false, error: "Not authorized to sync reports" });
    return;
  }

  const marketplaceId = parseResult.data.marketplaceId ?? DEFAULT_MARKETPLACE_ID;
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const fromDate = parseResult.data.from ? new Date(parseResult.data.from) : defaultFrom;
  const toDate = parseResult.data.to ? new Date(parseResult.data.to) : now;

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    res.status(400).json({ ok: false, error: "Invalid from/to date" });
    return;
  }

  const dataStartTime = fromDate.toISOString();
  const dataEndTime = toDate.toISOString();

  let runId: string | null = null;
  let reportId: string | null = null;

  try {
    const runInsert = await auth.serviceClient
      .from("erp_channel_report_runs")
      .insert({
        company_id: auth.companyId,
        channel_key: CHANNEL_KEY,
        marketplace_id: marketplaceId,
        report_type: REPORT_TYPE,
        status: "requested",
        report_request: {
          reportType: REPORT_TYPE,
          marketplaceIds: [marketplaceId],
          dataStartTime,
          dataEndTime,
        },
      })
      .select("id")
      .single();

    if (runInsert.error || !runInsert.data?.id) {
      res.status(500).json({ ok: false, error: runInsert.error?.message || "Failed to create report run" });
      return;
    }

    runId = runInsert.data.id;

    const createResult = await amazonCreateReport({
      reportType: REPORT_TYPE,
      marketplaceIds: [marketplaceId],
      dataStartTime,
      dataEndTime,
    });

    reportId = createResult.reportId;

    await auth.serviceClient
      .from("erp_channel_report_runs")
      .update({
        status: "processing",
        report_id: createResult.reportId,
        report_request: createResult.request,
        report_response: createResult.response,
      })
      .eq("id", runId);

    let reportStatus = await amazonGetReport({ reportId: createResult.reportId });
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

      reportStatus = await amazonGetReport({ reportId: createResult.reportId });
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
      res.status(502).json({ ok: false, error: `Report failed (${normalizedStatus}).` });
      return;
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
        report_response: { reportStatus, reportDocument },
      })
      .eq("id", runId);

    const rows = parseReportText(reportText);
    if (rows.length <= 1) {
      await auth.serviceClient
        .from("erp_channel_report_runs")
        .update({
          status: "done",
          completed_at: new Date().toISOString(),
          row_count: 0,
        })
        .eq("id", runId);

      res.status(200).json({
        ok: true,
        run_id: runId ?? "",
        report_id: reportId ?? "",
        row_count: 0,
        facts_upserted: 0,
      });
      return;
    }

    const headers = rows[0].map((header) => header.trim());
    const headerIndex = new Map<string, number>();
    headers.forEach((header, idx) => {
      headerIndex.set(normalizeHeader(header), idx);
    });

    const getValue = (row: string[], keys: string[]): string | null => {
      for (const key of keys) {
        const index = headerIndex.get(key);
        if (index === undefined) continue;
        const value = row[index];
        if (value !== undefined && value !== null && value.trim() !== "") {
          return value.trim();
        }
      }
      return null;
    };

    const orderIdKeys = ["order-id", "amazon-order-id"];
    const purchaseDateKeys = ["purchase-date", "order-date", "order-date-utc", "purchase-date-time"];
    const statusKeys = ["order-status", "status"];
    const fulfillmentKeys = ["fulfillment-channel"];
    const salesChannelKeys = ["sales-channel", "saleschannel"];
    const buyerEmailKeys = ["buyer-email", "buyer-email-address", "buyeremail"];
    const buyerNameKeys = ["buyer-name", "buyername"];
    const shipStateKeys = ["ship-state", "shipping-address-state", "shipping-state", "ship-state-province"];
    const shipCityKeys = ["ship-city", "shipping-address-city", "shipping-city"];
    const shipPostalKeys = ["ship-postal-code", "shipping-address-postal-code", "postal-code", "postalcode"];
    const skuKeys = ["sku", "seller-sku", "merchant-sku"];
    const asinKeys = ["asin", "asin-1", "asin1"];
    const fnskuKeys = ["fnsku", "fnsku-id"];
    const qtyKeys = ["quantity", "quantity-ordered", "quantity-purchased"];
    const itemAmountKeys = ["item-price", "item-price-amount", "item-amount", "itemprice"];
    const itemTaxKeys = ["item-tax", "item-tax-amount", "itemtax"];
    const shippingAmountKeys = ["shipping-price", "shipping-amount", "shippingprice"];
    const shippingTaxKeys = ["shipping-tax", "shipping-tax-amount", "shippingtax"];
    const giftWrapKeys = ["gift-wrap-price", "gift-wrap-amount", "giftwrapprice"];
    const promoDiscountKeys = [
      "promotion-discount",
      "promotion-discount-amount",
      "item-promotion-discount",
      "item-promotion-discount-amount",
    ];
    const currencyKeys = ["currency", "currency-code", "currencycode"];
    const orderItemIdKeys = ["order-item-id", "order-item-identifier", "orderitemid"];

    if (!orderIdKeys.some((key) => headerIndex.has(key))) {
      throw new Error("Missing order-id column in report header.");
    }

    const draftFacts: DraftFact[] = [];
    const skuCandidates = new Set<string>();
    const skuNorms = new Set<string>();

    rows.slice(1).forEach((row, index) => {
      const orderId = getValue(row, orderIdKeys);
      if (!orderId) return;

      const purchaseDate = parseDateValue(getValue(row, purchaseDateKeys));
      const orderStatus = getValue(row, statusKeys);
      const fulfillmentChannel = getValue(row, fulfillmentKeys);
      const salesChannel = getValue(row, salesChannelKeys);
      const buyerEmail = getValue(row, buyerEmailKeys);
      const buyerName = getValue(row, buyerNameKeys);
      const shipState = getValue(row, shipStateKeys);
      const shipCity = getValue(row, shipCityKeys);
      const shipPostal = getValue(row, shipPostalKeys);
      const externalSku = getValue(row, skuKeys);
      const asin = getValue(row, asinKeys);
      const fnsku = getValue(row, fnskuKeys);
      const quantity = parseIntValue(getValue(row, qtyKeys));
      const itemAmount = parseNumber(getValue(row, itemAmountKeys));
      const itemTax = parseNumber(getValue(row, itemTaxKeys));
      const shippingAmount = parseNumber(getValue(row, shippingAmountKeys));
      const shippingTax = parseNumber(getValue(row, shippingTaxKeys));
      const giftWrapAmount = parseNumber(getValue(row, giftWrapKeys));
      const promoDiscount = parseNumber(getValue(row, promoDiscountKeys));
      const currency = getValue(row, currencyKeys);
      const orderItemId = getValue(row, orderItemIdKeys);

      if (!purchaseDate) return;

      const orderItemKey =
        orderItemId ??
        crypto
          .createHash("sha256")
          .update(`${orderId}|${externalSku ?? ""}|${asin ?? ""}|${index}`)
          .digest("hex");

      draftFacts.push({
        amazon_order_id: orderId,
        order_item_id: orderItemKey,
        purchase_date: purchaseDate,
        order_status: orderStatus,
        fulfillment_channel: fulfillmentChannel,
        sales_channel: salesChannel,
        buyer_email: buyerEmail,
        buyer_name: buyerName,
        ship_state: shipState,
        ship_city: shipCity,
        ship_postal_code: shipPostal,
        asin,
        external_sku: externalSku,
        fnsku,
        quantity,
        item_amount: itemAmount,
        item_tax: itemTax,
        shipping_amount: shippingAmount,
        shipping_tax: shippingTax,
        gift_wrap_amount: giftWrapAmount,
        promo_discount: promoDiscount,
        currency,
      });

      if (externalSku) {
        skuCandidates.add(externalSku.trim());
        skuCandidates.add(normalizeSku(externalSku));
        skuNorms.add(normalizeSkuKey(externalSku));
      }
    });

    if (draftFacts.length === 0) {
      await auth.serviceClient
        .from("erp_channel_report_runs")
        .update({ status: "done", completed_at: new Date().toISOString(), row_count: 0 })
        .eq("id", runId);

      res
        .status(200)
        .json({ ok: true, run_id: runId ?? "", report_id: reportId ?? "", row_count: 0, facts_upserted: 0 });
      return;
    }

    const variantBySku = new Map<string, VariantRow>();
    const variantById = new Map<string, VariantRow>();

    const skuList = Array.from(skuCandidates).filter(Boolean);
    for (const skuChunk of chunk(skuList, 200)) {
      const { data: variants } = await auth.serviceClient
        .from("erp_variants")
        .select("id, sku, style_code, size, color")
        .eq("company_id", auth.companyId)
        .in("sku", skuChunk);

      (variants ?? []).forEach((variant) => {
        const row = variant as VariantRow;
        variantBySku.set(normalizeSku(row.sku), row);
        variantById.set(row.id, row);
      });
    }

    const channelMap = new Map<string, string>();
    const skuNormList = Array.from(skuNorms).filter(Boolean);
    for (const skuNormChunk of chunk(skuNormList, 200)) {
      const { data: mappings } = await auth.serviceClient
        .from("erp_channel_sku_map")
        .select("external_sku_norm, mapped_variant_id")
        .eq("company_id", auth.companyId)
        .eq("channel_key", CHANNEL_KEY)
        .in("marketplace_id_norm", [marketplaceId, ""])
        .in("external_sku_norm", skuNormChunk);

      (mappings ?? []).forEach((mapping) => {
        if (mapping.external_sku_norm && mapping.mapped_variant_id) {
          channelMap.set(mapping.external_sku_norm, mapping.mapped_variant_id);
        }
      });
    }

    const missingVariantIds = Array.from(channelMap.values()).filter((id) => !variantById.has(id));
    for (const idChunk of chunk(missingVariantIds, 200)) {
      const { data: variants } = await auth.serviceClient
        .from("erp_variants")
        .select("id, sku, style_code, size, color")
        .eq("company_id", auth.companyId)
        .in("id", idChunk);

      (variants ?? []).forEach((variant) => {
        const row = variant as VariantRow;
        variantById.set(row.id, row);
        variantBySku.set(normalizeSku(row.sku), row);
      });
    }

    const factsInsertPayload = draftFacts.map((item) => {
      const normalizedSku = normalizeSku(item.external_sku);
      const normalizedSkuKey = normalizeSkuKey(item.external_sku);
      const directVariant = normalizedSku ? variantBySku.get(normalizedSku) : undefined;
      const mappedVariantId = directVariant?.id ?? (normalizedSkuKey ? channelMap.get(normalizedSkuKey) : null);
      const mappedVariant = mappedVariantId ? variantById.get(mappedVariantId) : undefined;
      const variant = directVariant ?? mappedVariant;

      return {
        company_id: auth.companyId,
        marketplace_id: marketplaceId,
        amazon_order_id: item.amazon_order_id,
        order_item_id: item.order_item_id,
        purchase_date: item.purchase_date,
        order_status: item.order_status,
        fulfillment_channel: item.fulfillment_channel,
        sales_channel: item.sales_channel,
        buyer_email: item.buyer_email,
        buyer_name: item.buyer_name,
        ship_state: item.ship_state,
        ship_city: item.ship_city,
        ship_postal_code: item.ship_postal_code,
        asin: item.asin,
        external_sku: item.external_sku,
        fnsku: item.fnsku,
        quantity: item.quantity,
        item_amount: item.item_amount,
        item_tax: item.item_tax,
        shipping_amount: item.shipping_amount,
        shipping_tax: item.shipping_tax,
        gift_wrap_amount: item.gift_wrap_amount,
        promo_discount: item.promo_discount,
        currency: item.currency,
        mapped_variant_id: variant?.id ?? mappedVariantId ?? null,
        erp_sku: variant?.sku ?? null,
        style_code: variant?.style_code ?? null,
        size: variant?.size ?? null,
        color: variant?.color ?? null,
        source_run_id: runId,
      };
    });

    for (const payloadChunk of chunk(factsInsertPayload, 500)) {
      const { error: factsError } = await auth.serviceClient
        .from("erp_amazon_order_facts")
        .upsert(payloadChunk, {
          onConflict: "company_id,marketplace_id,amazon_order_id,order_item_id",
        });

      if (factsError) {
        throw new Error(factsError.message);
      }
    }

    await auth.serviceClient
      .from("erp_channel_report_runs")
      .update({
        status: "done",
        completed_at: new Date().toISOString(),
        row_count: draftFacts.length,
      })
      .eq("id", runId);

    res.status(200).json({
      ok: true,
      run_id: runId ?? "",
      report_id: reportId ?? "",
      row_count: draftFacts.length,
      facts_upserted: factsInsertPayload.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to sync report";
    if (runId) {
      await auth.serviceClient
        .from("erp_channel_report_runs")
        .update({ status: "failed", error: message, completed_at: new Date().toISOString() })
        .eq("id", runId);
    }
    res.status(500).json({ ok: false, error: message });
  }
}
