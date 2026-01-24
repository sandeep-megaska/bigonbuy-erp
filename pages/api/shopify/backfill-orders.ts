import type { NextApiRequest, NextApiResponse } from "next";
import {
  createUserClient,
  getBearerToken,
  getSupabaseEnv,
} from "../../../lib/serverSupabase";

const SHOPIFY_API_VERSION = "2024-01";

type BackfillResponse = {
  ok: boolean;
  fetched?: number;
  upserted?: number;
  lines_upserted?: number;
  oms_upserted?: number;
  oms_lines_upserted?: number;
  reservations_created?: number;
  reservations_released?: number;
  errors?: number;
  error_details?: string[];
  error?: string;
  details?: string | null;
};

type ShopifyEnv = {
  shopDomain: string;
  adminToken: string;
};

function getShopifyEnv(): ShopifyEnv {
  const shopDomain = process.env.SHOPIFY_STORE_DOMAIN;
  const adminToken = process.env.SHOPIFY_ACCESS_TOKEN;
  return { shopDomain: shopDomain ?? "", adminToken: adminToken ?? "" };
}

function buildShopifyBaseUrl(domain: string): string {
  if (domain.startsWith("http://") || domain.startsWith("https://")) {
    return domain.replace(/\/$/, "");
  }
  return `https://${domain}`;
}

function parseDateInput(value: unknown, endOfDay = false): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const time = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
  const date = new Date(`${value}${time}`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function extractNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const parts = linkHeader.split(",");
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel=\"next\"/i);
    if (match) return match[1];
  }
  return null;
}

async function fetchShopifyOrders(from: string, to: string): Promise<any[]> {
  const { shopDomain, adminToken } = getShopifyEnv();
  const baseUrl = buildShopifyBaseUrl(shopDomain);
  const headers = {
    "X-Shopify-Access-Token": adminToken,
    "Content-Type": "application/json",
  };

  const params = new URLSearchParams({
    status: "any",
    limit: "250",
    created_at_min: from,
    created_at_max: to,
    fields:
      "id,name,order_number,created_at,processed_at,financial_status,fulfillment_status,currency,subtotal_price,total_discounts,total_shipping_price_set,total_tax,total_price,cancelled_at,cancel_reason,shipping_address,customer,line_items",
  });

  let nextUrl: string | null = `${baseUrl}/admin/api/${SHOPIFY_API_VERSION}/orders.json?${params.toString()}`;
  const orders: any[] = [];

  while (nextUrl) {
    const response = await fetch(nextUrl, { method: "GET", headers });
    const payload = (await response.json()) as { orders?: any[]; errors?: any };

    if (!response.ok) {
      throw new Error(`Shopify orders fetch failed: ${response.status} ${JSON.stringify(payload)}`);
    }

    if (Array.isArray(payload.orders)) {
      orders.push(...payload.orders);
    }

    nextUrl = extractNextLink(response.headers.get("link"));
  }

  return orders;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<BackfillResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey) {
    return res.status(500).json({
      ok: false,
      error: "Missing Supabase env vars",
      details: missing.filter((item) => item !== "SUPABASE_SERVICE_ROLE_KEY").join(", ") || null,
    });
  }

  const { shopDomain, adminToken } = getShopifyEnv();
  if (!shopDomain) {
    return res.status(500).json({ ok: false, error: "Missing env SHOPIFY_STORE_DOMAIN" });
  }
  if (!adminToken) {
    return res.status(500).json({ ok: false, error: "Missing env SHOPIFY_ACCESS_TOKEN" });
  }

  let fromIso: string | null = null;
  let toIso: string | null = null;

  if (req.body && typeof req.body === "object") {
    fromIso = parseDateInput((req.body as Record<string, unknown>).from);
    toIso = parseDateInput((req.body as Record<string, unknown>).to, true);
  }

  if (!fromIso || !toIso) {
    return res.status(400).json({ ok: false, error: "from/to date (YYYY-MM-DD) is required" });
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token" });
  }

  const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  const { error: permissionError } = await userClient.rpc("erp_require_finance_writer");
  if (permissionError) {
    return res.status(403).json({ ok: false, error: "Not authorized" });
  }

  const { data: companyId, error: companyError } = await userClient.rpc("erp_current_company_id");
  if (companyError || !companyId) {
    return res.status(400).json({
      ok: false,
      error: companyError?.message || "Failed to determine company",
      details: companyError?.details || companyError?.hint || companyError?.code,
    });
  }

  try {
    const orders = await fetchShopifyOrders(fromIso, toIso);
    let upserted = 0;
    let linesUpserted = 0;
    let omsUpserted = 0;
    let omsLinesUpserted = 0;
    let reservationsCreated = 0;
    let reservationsReleased = 0;
    let errors = 0;
    const errorDetails: string[] = [];

    for (const order of orders) {
      const { data: orderId, error } = await userClient.rpc("erp_shopify_order_upsert", {
        p_company_id: companyId,
        p_order: order,
      });

      if (error || !orderId) {
        errors += 1;
        if (error?.message) {
          errorDetails.push(error.message);
        }
        continue;
      }

      upserted += 1;
      if (Array.isArray(order?.line_items)) {
        linesUpserted += order.line_items.length;
      }

      const { data: omsResult, error: omsError } = await userClient.rpc("erp_oms_sync_from_shopify", {
        p_company_id: companyId,
        p_shopify_order_id: order.id,
      });

      if (omsError || !omsResult?.ok) {
        errors += 1;
        if (omsError?.message) {
          errorDetails.push(omsError.message);
        }
        continue;
      }

      omsUpserted += 1;
      omsLinesUpserted += Number(omsResult?.lines_upserted ?? 0);

      const omsOrderId = omsResult?.oms_order_id ?? null;
      if (omsOrderId) {
        const { data: reserveResult, error: reserveError } = await userClient.rpc("erp_oms_reserve_inventory", {
          p_order_id: omsOrderId,
        });

        if (reserveError || !reserveResult?.ok) {
          errors += 1;
          if (reserveError?.message) {
            errorDetails.push(reserveError.message);
          }
          continue;
        }

        reservationsCreated += Number(reserveResult?.reservations_created ?? 0);
      }
    }

    return res.status(200).json({
      ok: true,
      fetched: orders.length,
      upserted,
      lines_upserted: linesUpserted,
      oms_upserted: omsUpserted,
      oms_lines_upserted: omsLinesUpserted,
      reservations_created: reservationsCreated,
      reservations_released: reservationsReleased,
      errors,
      error_details: errorDetails.slice(0, 10),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Shopify backfill failed";
    return res.status(500).json({ ok: false, error: message });
  }
}
