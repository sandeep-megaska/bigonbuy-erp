import type { NextApiRequest, NextApiResponse } from "next";
import {
  createServiceRoleClient,
  createUserClient,
  getBearerToken,
  getSupabaseEnv,
} from "../../../../lib/serverSupabase";

const SHOPIFY_API_VERSION = "2024-01";

type SyncResponse =
  | {
      ok: true;
      run_id: string;
      row_count: number;
      orders_upserted: number;
      lines_upserted: number;
    }
  | { ok: false; error: string; details?: string };

type ShopifyEnv = {
  shopDomain: string;
  adminToken: string;
};

type ShopifyOrder = {
  id: number;
  name?: string | null;
  order_number?: number | null;
  created_at?: string | null;
  currency?: string | null;
  total_discounts?: string | null;
  email?: string | null;
  customer?: {
    id?: number | null;
    email?: string | null;
  } | null;
  shipping_address?: {
    province?: string | null;
    city?: string | null;
    zip?: string | null;
    phone?: string | null;
  } | null;
  line_items?: Array<{
    id?: number | null;
    sku?: string | null;
    quantity?: number | null;
    price?: string | null;
    total_discount?: string | null;
  }> | null;
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

function parseNumber(value: string | null | undefined): number {
  if (!value) return 0;
  const cleaned = value.replace(/[^0-9.-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function buildCustomerKey(order: ShopifyOrder): string | null {
  if (order.customer?.id) return `customer:${order.customer.id}`;
  if (order.customer?.email) return order.customer.email.toLowerCase();
  if (order.email) return order.email.toLowerCase();
  if (order.shipping_address?.phone) return `phone:${order.shipping_address.phone}`;
  return `order:${order.id}`;
}

async function fetchShopifyOrders(from: string, to: string): Promise<ShopifyOrder[]> {
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
      "id,name,order_number,created_at,currency,total_discounts,email,shipping_address,customer,line_items",
  });

  let nextUrl: string | null = `${baseUrl}/admin/api/${SHOPIFY_API_VERSION}/orders.json?${params.toString()}`;
  const orders: ShopifyOrder[] = [];

  while (nextUrl) {
    const response = await fetch(nextUrl, { method: "GET", headers });
    const payload = (await response.json()) as { orders?: ShopifyOrder[]; errors?: any };

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

export default async function handler(req: NextApiRequest, res: NextApiResponse<SyncResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const startParam = req.query.start ?? (req.body as Record<string, unknown>)?.start;
  const endParam = req.query.end ?? (req.body as Record<string, unknown>)?.end;
  const channelParam =
    req.query.channel_account_id ?? (req.body as Record<string, unknown>)?.channel_account_id;

  const fromIso = parseDateInput(startParam);
  const toIso = parseDateInput(endParam, true);
  const channelAccountId = typeof channelParam === "string" ? channelParam : null;

  if (!fromIso || !toIso || !channelAccountId) {
    return res
      .status(400)
      .json({ ok: false, error: "start/end (YYYY-MM-DD) and channel_account_id are required" });
  }

  const { supabaseUrl, anonKey, serviceRoleKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return res.status(500).json({
      ok: false,
      error: "Missing Supabase env vars",
      details: missing.join(", ") || undefined,
    });
  }

  const { shopDomain, adminToken } = getShopifyEnv();
  if (!shopDomain) {
    return res.status(500).json({ ok: false, error: "Missing env SHOPIFY_STORE_DOMAIN" });
  }
  if (!adminToken) {
    return res.status(500).json({ ok: false, error: "Missing env SHOPIFY_ACCESS_TOKEN" });
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

  const { error: permissionError } = await userClient.rpc("erp_require_analytics_reader");
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

  const { data: channelAccounts, error: channelError } = await userClient.rpc("erp_channel_account_list");
  if (channelError) {
    return res.status(400).json({ ok: false, error: channelError.message });
  }

  const channelAccount = (channelAccounts as Array<{ id: string; channel_key: string }>).find(
    (account) => account.id === channelAccountId
  );
  if (!channelAccount || channelAccount.channel_key !== "shopify") {
    return res.status(400).json({ ok: false, error: "Invalid Shopify channel account" });
  }

  const serviceClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);
  let runId: string | null = null;

  try {
    const { data: runRow, error: runError } = await serviceClient
      .from("erp_channel_report_runs")
      .insert({
        company_id: companyId,
        channel_key: "shopify",
        marketplace_id: channelAccountId,
        report_type: "shopify_orders_sync_v1",
        status: "running",
        report_request: {
          start: startParam,
          end: endParam,
          channel_account_id: channelAccountId,
        },
        report_response: {},
      })
      .select("id")
      .single();

    if (runError) {
      throw new Error(runError.message);
    }

    runId = runRow?.id ?? null;

    const orders = await fetchShopifyOrders(fromIso, toIso);
    const orderFacts: Array<Record<string, unknown>> = [];
    const lineFacts: Array<Record<string, unknown>> = [];

    for (const order of orders) {
      const orderDate = normalizeDate(order.created_at ?? null);
      if (!orderDate) continue;

      const lines = Array.isArray(order.line_items) ? order.line_items : [];
      let units = 0;
      let grossSales = 0;
      let lineDiscounts = 0;

      for (const [index, line] of lines.entries()) {
        const qty = Number(line.quantity ?? 0);
        const lineGross = parseNumber(line.price) * qty;
        const lineDiscount = parseNumber(line.total_discount);
        units += qty;
        grossSales += lineGross;
        lineDiscounts += lineDiscount;

        lineFacts.push({
          company_id: companyId,
          channel_account_id: channelAccountId,
          order_id: String(order.id),
          line_id: line.id ? String(line.id) : `line:${order.id}:${index}`,
          sku: line.sku ?? null,
          qty,
          line_gross: lineGross,
          line_discount: lineDiscount,
          created_at: orderDate,
        });
      }

      const orderDiscounts = parseNumber(order.total_discounts) || lineDiscounts;
      const netSales = grossSales - orderDiscounts;

      orderFacts.push({
        company_id: companyId,
        channel_account_id: channelAccountId,
        order_id: String(order.id),
        order_number: order.order_number?.toString() ?? order.name ?? null,
        created_at: orderDate,
        currency: order.currency ?? null,
        ship_state: order.shipping_address?.province ?? null,
        ship_city: order.shipping_address?.city ?? null,
        ship_zip: order.shipping_address?.zip ?? null,
        customer_key: buildCustomerKey(order),
        gross_sales: grossSales,
        discounts: orderDiscounts,
        net_sales_estimated: netSales,
        units,
      });
    }

    const chunkSize = 500;
    for (let i = 0; i < orderFacts.length; i += chunkSize) {
      const batch = orderFacts.slice(i, i + chunkSize);
      const { error: upsertError } = await serviceClient
        .from("erp_shopify_order_facts")
        .upsert(batch, { onConflict: "company_id,channel_account_id,order_id" });
      if (upsertError) {
        throw new Error(upsertError.message);
      }
    }

    for (let i = 0; i < lineFacts.length; i += chunkSize) {
      const batch = lineFacts.slice(i, i + chunkSize);
      const { error: lineError } = await serviceClient
        .from("erp_shopify_order_line_facts")
        .upsert(batch, { onConflict: "company_id,channel_account_id,order_id,line_id" });
      if (lineError) {
        throw new Error(lineError.message);
      }
    }

    if (runId) {
      await serviceClient
        .from("erp_channel_report_runs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          row_count: orderFacts.length,
          report_response: {
            orders: orderFacts.length,
            lines: lineFacts.length,
          },
        })
        .eq("id", runId);
    }

    return res.status(200).json({
      ok: true,
      run_id: runId ?? "",
      row_count: orderFacts.length,
      orders_upserted: orderFacts.length,
      lines_upserted: lineFacts.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Shopify analytics sync failed";
    if (runId) {
      await serviceClient
        .from("erp_channel_report_runs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error: message,
        })
        .eq("id", runId);
    }
    return res.status(500).json({ ok: false, error: message });
  }
}
