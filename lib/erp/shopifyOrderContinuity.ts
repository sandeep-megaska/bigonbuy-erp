import type { SupabaseClient } from "@supabase/supabase-js";

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-01";
export const SHOPIFY_ORDER_FIELDS = [
  "id", "name", "order_number", "created_at", "processed_at", "updated_at",
  "financial_status", "fulfillment_status", "cancelled_at", "currency",
  "subtotal_price", "total_discounts", "total_shipping_price", "total_shipping_price_set",
  "total_tax", "total_price", "email", "phone", "customer", "shipping_address",
  "line_items", "payment_gateway_names", "fulfillments", "note_attributes",
  "landing_site", "order_status_url",
].join(",");

type ShopifyOrder = Record<string, any> & { id?: number; updated_at?: string; line_items?: Array<{ id?: number }> };

function shopifyEnv() {
  const shopDomain = process.env.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_SHOP_DOMAIN || process.env.SHOPIFY_DOMAIN;
  const adminToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.SHOPIFY_ADMIN_API_TOKEN || process.env.SHOPIFY_ACCESS_TOKEN;
  if (!shopDomain || !adminToken) throw new Error("Missing Shopify credentials");
  const baseUrl = shopDomain.startsWith("http://") || shopDomain.startsWith("https://")
    ? shopDomain.replace(/\/$/, "")
    : `https://${shopDomain}`;
  return { baseUrl, adminToken };
}

function nextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/i);
    if (match) return match[1];
  }
  return null;
}

async function shopifyGet(url: string) {
  const { adminToken } = shopifyEnv();
  const response = await fetch(url, { headers: { "X-Shopify-Access-Token": adminToken, "Content-Type": "application/json" } });
  const payload = await response.json();
  if (!response.ok) throw new Error(`Shopify orders fetch failed: ${response.status} ${JSON.stringify(payload)}`);
  return { response, payload };
}

export async function fetchShopifyOrder(orderId: number): Promise<ShopifyOrder> {
  const { baseUrl } = shopifyEnv();
  const url = `${baseUrl}/admin/api/${SHOPIFY_API_VERSION}/orders/${orderId}.json?fields=${encodeURIComponent(SHOPIFY_ORDER_FIELDS)}`;
  const { payload } = await shopifyGet(url);
  if (!payload?.order?.id) throw new Error(`Shopify order ${orderId} not found`);
  return payload.order as ShopifyOrder;
}

export async function fetchShopifyOrdersUpdatedSince(fromTsIso: string): Promise<ShopifyOrder[]> {
  const { baseUrl } = shopifyEnv();
  const params = new URLSearchParams({ status: "any", limit: "250", updated_at_min: fromTsIso, fields: SHOPIFY_ORDER_FIELDS });
  const orders: ShopifyOrder[] = [];
  let url: string | null = `${baseUrl}/admin/api/${SHOPIFY_API_VERSION}/orders.json?${params.toString()}`;
  while (url) {
    const { response, payload } = await shopifyGet(url);
    if (Array.isArray(payload.orders)) orders.push(...payload.orders);
    url = nextLink(response.headers.get("link"));
  }
  return orders;
}

export async function getOrderReconciliationCursor(db: SupabaseClient, companyId: string): Promise<string> {
  const { data, error } = await db
    .from("erp_shopify_orders")
    .select("raw_order,updated_at")
    .eq("company_id", companyId)
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);

  let latestMs = 0;
  for (const row of data || []) {
    const candidate = (row.raw_order as Record<string, unknown> | null)?.updated_at;
    if (typeof candidate !== "string") continue;
    const ms = Date.parse(candidate);
    if (Number.isFinite(ms)) latestMs = Math.max(latestMs, ms);
  }
  // Overlap protects against equal timestamps, pagination races and delayed writes.
  const baseMs = latestMs || Date.now() - 60 * 24 * 60 * 60 * 1000;
  return new Date(baseMs - 2 * 60 * 60 * 1000).toISOString();
}

export async function persistCanonicalShopifyOrder(db: SupabaseClient, companyId: string, order: ShopifyOrder) {
  const { error } = await db.rpc("erp_shopify_order_upsert", { p_company_id: companyId, p_order: order });
  if (error) throw new Error(error.message);
}

export async function reconcileShopifyOrders(db: SupabaseClient, companyId: string) {
  const fromTs = await getOrderReconciliationCursor(db, companyId);
  const orders = await fetchShopifyOrdersUpdatedSince(fromTs);
  let importedOrders = 0;
  let importedLines = 0;
  const errors: string[] = [];
  let latestShopifyUpdatedAt: string | null = null;

  for (const order of orders) {
    if (!order?.id) continue;
    try {
      await persistCanonicalShopifyOrder(db, companyId, order);
      importedOrders += 1;
      importedLines += Array.isArray(order.line_items) ? order.line_items.filter((line) => Number.isFinite(Number(line?.id))).length : 0;
      if (order.updated_at && (!latestShopifyUpdatedAt || order.updated_at > latestShopifyUpdatedAt)) latestShopifyUpdatedAt = order.updated_at;
    } catch (error) {
      errors.push(`order ${order.id}: ${error instanceof Error ? error.message : "upsert failed"}`);
    }
  }

  return { from_ts: fromTs, imported_orders: importedOrders, imported_lines: importedLines, latest_shopify_updated_at: latestShopifyUpdatedAt, errors };
}
