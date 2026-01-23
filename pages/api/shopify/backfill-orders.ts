import type { NextApiRequest, NextApiResponse } from "next";
import {
  createServiceRoleClient,
  createUserClient,
  getBearerToken,
  getSupabaseEnv,
} from "../../../lib/serverSupabase";

const SHOPIFY_API_VERSION = "2024-01";

type BackfillResponse = {
  ok: boolean;
  fetched?: number;
  upserted?: number;
  errors?: number;
  error?: string;
  details?: string | null;
};

type ShopifyEnv = {
  shopDomain: string;
  adminToken: string;
};

function getShopifyEnv(): ShopifyEnv {
  const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN;
  const adminToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  if (!shopDomain || !adminToken) {
    throw new Error("Missing Shopify env vars: SHOPIFY_SHOP_DOMAIN, SHOPIFY_ADMIN_ACCESS_TOKEN");
  }
  return { shopDomain, adminToken };
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

  const { supabaseUrl, anonKey, serviceRoleKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || !serviceRoleKey || missing.length > 0) {
    return res.status(500).json({
      ok: false,
      error: "Missing Supabase env vars",
      details: missing.join(", ") || null,
    });
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

  const serviceClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);

  try {
    const orders = await fetchShopifyOrders(fromIso, toIso);
    let upserted = 0;
    let errors = 0;

    for (const order of orders) {
      const { data: orderId, error } = await serviceClient.rpc("erp_shopify_order_upsert", {
        p_company_id: companyId,
        p_order: order,
      });

      if (error || !orderId) {
        errors += 1;
        continue;
      }

      upserted += 1;
    }

    return res.status(200).json({
      ok: true,
      fetched: orders.length,
      upserted,
      errors,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Shopify backfill failed";
    return res.status(500).json({ ok: false, error: message });
  }
}
