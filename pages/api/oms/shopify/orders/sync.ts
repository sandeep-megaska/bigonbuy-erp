import type { NextApiRequest, NextApiResponse } from "next";
import {
  createServiceRoleClient,
  createUserClient,
  getBearerToken,
  getSupabaseEnv,
} from "../../../../../lib/serverSupabase";

const SHOPIFY_API_VERSION = "2024-01";
const ORDER_FETCH_FIELDS =
  "id,name,order_number,created_at,processed_at,updated_at,financial_status,fulfillment_status,cancelled_at,currency,subtotal_price,total_discounts,total_shipping_price,total_shipping_price_set,total_tax,total_price,email,customer,shipping_address,line_items";

const ALLOWED_ROLE_KEYS = new Set(["owner", "admin", "hr", "manager"]);

type ShopifyOrder = {
  id?: number;
  line_items?: Array<{ id?: number }>;
};

type SyncResponse =
  | {
      ok: true;
      from_ts: string;
      imported_orders: number;
      imported_lines: number;
      last_order_created_at: string | null;
      errors: string[];
    }
  | { ok: false; error: string; details?: string | null };

function getShopifyEnv() {
  const shopDomain = process.env.SHOPIFY_STORE_DOMAIN;
  const adminToken = process.env.SHOPIFY_ACCESS_TOKEN;

  if (!shopDomain) {
    throw new Error("Missing env SHOPIFY_STORE_DOMAIN");
  }
  if (!adminToken) {
    throw new Error("Missing env SHOPIFY_ACCESS_TOKEN");
  }

  return { shopDomain, adminToken };
}

function buildShopifyBaseUrl(domain: string): string {
  if (domain.startsWith("http://") || domain.startsWith("https://")) {
    return domain.replace(/\/$/, "");
  }
  return `https://${domain}`;
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

async function fetchShopifyOrdersSince(fromTsIso: string): Promise<ShopifyOrder[]> {
  const { shopDomain, adminToken } = getShopifyEnv();
  const baseUrl = buildShopifyBaseUrl(shopDomain);

  const params = new URLSearchParams({
    status: "any",
    limit: "250",
    updated_at_min: fromTsIso,
    fields: ORDER_FETCH_FIELDS,
  });

  const headers = {
    "X-Shopify-Access-Token": adminToken,
    "Content-Type": "application/json",
  };

  const allOrders: ShopifyOrder[] = [];
  let nextUrl: string | null = `${baseUrl}/admin/api/${SHOPIFY_API_VERSION}/orders.json?${params.toString()}`;

  while (nextUrl) {
    const response = await fetch(nextUrl, { method: "GET", headers });
    const payload = (await response.json()) as { orders?: ShopifyOrder[]; errors?: unknown };

    if (!response.ok) {
      throw new Error(`Shopify orders fetch failed: ${response.status} ${JSON.stringify(payload)}`);
    }

    if (Array.isArray(payload.orders)) {
      allOrders.push(...payload.orders);
    }

    nextUrl = extractNextLink(response.headers.get("link"));
  }

  return allOrders;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<SyncResponse>) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey, serviceRoleKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return res.status(500).json({
      ok: false,
      error: "Missing Supabase env vars",
      details: missing.join(", ") || null,
    });
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

  const { data: companyId, error: companyError } = await userClient.rpc("erp_current_company_id");
  if (companyError || !companyId) {
    return res.status(400).json({
      ok: false,
      error: companyError?.message || "Failed to determine company",
      details: companyError?.details || companyError?.hint || companyError?.code,
    });
  }

  const serviceClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);

  const { data: membership, error: membershipError } = await serviceClient
    .from("erp_company_users")
    .select("role_key")
    .eq("company_id", companyId)
    .eq("user_id", userData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    return res.status(400).json({ ok: false, error: membershipError.message });
  }

  if (!ALLOWED_ROLE_KEYS.has((membership?.role_key ?? "").toLowerCase())) {
    return res.status(403).json({ ok: false, error: "Only manager/admin can sync Shopify orders" });
  }

  const { data: latestOrder, error: latestOrderError } = await serviceClient
    .from("erp_shopify_orders")
    .select("order_created_at")
    .eq("company_id", companyId)
    .order("order_created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestOrderError) {
    return res.status(400).json({ ok: false, error: latestOrderError.message });
  }

  const lastOrderCreatedAt = latestOrder?.order_created_at ?? null;

  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      from_ts: "",
      imported_orders: 0,
      imported_lines: 0,
      last_order_created_at: lastOrderCreatedAt,
      errors: [],
    });
  }

  const now = new Date();
  const fromDate = lastOrderCreatedAt ? new Date(lastOrderCreatedAt) : now;
  fromDate.setUTCDate(fromDate.getUTCDate() - (lastOrderCreatedAt ? 2 : 60));
  const fromTsIso = fromDate.toISOString();

  try {
    const orders = await fetchShopifyOrdersSince(fromTsIso);

    let importedOrders = 0;
    let importedLines = 0;
    const syncErrors: string[] = [];

    for (const order of orders) {
      if (!order?.id) continue;

      const { error: upsertError } = await serviceClient.rpc("erp_shopify_order_upsert", {
        p_company_id: companyId,
        p_order: order,
      });

      if (upsertError) {
        syncErrors.push(`order ${order.id}: ${upsertError.message}`);
        continue;
      }

      importedOrders += 1;
      importedLines += Array.isArray(order.line_items)
        ? order.line_items.filter((line) => Number.isFinite(Number(line?.id))).length
        : 0;
    }

    const { data: updatedLatestOrder, error: updatedLatestOrderError } = await serviceClient
      .from("erp_shopify_orders")
      .select("order_created_at")
      .eq("company_id", companyId)
      .order("order_created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (updatedLatestOrderError) {
      return res.status(400).json({ ok: false, error: updatedLatestOrderError.message });
    }

    return res.status(200).json({
      ok: true,
      from_ts: fromTsIso,
      imported_orders: importedOrders,
      imported_lines: importedLines,
      last_order_created_at: updatedLatestOrder?.order_created_at ?? lastOrderCreatedAt,
      errors: syncErrors,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Shopify sync failed";
    return res.status(500).json({ ok: false, error: message });
  }
}
