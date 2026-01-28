import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAmazonAccessToken, spApiSignedFetch } from "../../../../../lib/amazonSpApi";
import {
  createServiceRoleClient,
  createUserClient,
  getBearerToken,
  getSupabaseEnv,
} from "../../../../../lib/serverSupabase";

type SyncResponse =
  | { ok: true; orders_upserted: number; items_written: number; next_watermark: string | null }
  | { ok: false; error: string; details?: string };

type AmazonOrder = Record<string, unknown> & {
  AmazonOrderId?: string;
  LastUpdateDate?: string;
};

type AmazonOrderItem = Record<string, unknown> & {
  OrderItemId?: string;
};

const requestSchema = z.object({
  marketplaceId: z.string().optional(),
  companyId: z.string().uuid().optional(),
});

const DEFAULT_MARKETPLACE_ID = "A21TJRUUN4KGV";
const MAX_RESULTS = 100;
const CONCURRENCY = 3;
const SOURCE_KEY = "amazon_orders";

async function listOrdersPage({
  accessToken,
  marketplaceId,
  lastUpdatedAfter,
  nextToken,
}: {
  accessToken: string;
  marketplaceId: string;
  lastUpdatedAfter: string;
  nextToken?: string | null;
}): Promise<{ orders: AmazonOrder[]; nextToken?: string }> {
  const path = "/orders/v0/orders";
  const query = nextToken
    ? { NextToken: nextToken }
    : {
        MarketplaceIds: marketplaceId,
        LastUpdatedAfter: lastUpdatedAfter,
        MaxResultsPerPage: MAX_RESULTS,
      };

  const response = await spApiSignedFetch({
    method: "GET",
    path,
    accessToken,
    query,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`SP-API error: ${JSON.stringify(data)}`);
  }

  const payload = (data as { payload?: { Orders?: AmazonOrder[]; NextToken?: string } }).payload;
  const orders = Array.isArray(payload?.Orders) ? payload?.Orders ?? [] : [];
  const responseNextToken = typeof payload?.NextToken === "string" ? payload.NextToken : undefined;

  return { orders, nextToken: responseNextToken };
}

async function listOrderItems({
  accessToken,
  amazonOrderId,
}: {
  accessToken: string;
  amazonOrderId: string;
}): Promise<AmazonOrderItem[]> {
  const items: AmazonOrderItem[] = [];
  let nextToken: string | null = null;

  do {
    const path = `/orders/v0/orders/${amazonOrderId}/orderItems`;
    const query = nextToken ? { NextToken: nextToken } : undefined;

    const response = await spApiSignedFetch({
      method: "GET",
      path,
      accessToken,
      query,
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(`SP-API error: ${JSON.stringify(data)}`);
    }

    const payload = (data as { payload?: { OrderItems?: AmazonOrderItem[]; NextToken?: string } }).payload;
    const batch = Array.isArray(payload?.OrderItems) ? payload?.OrderItems ?? [] : [];
    items.push(...batch);
    nextToken = typeof payload?.NextToken === "string" ? payload.NextToken : null;
  } while (nextToken);

  return items;
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) return;
      await mapper(item);
    }
  });

  await Promise.all(workers);
}

function toIsoString(date: Date): string {
  return date.toISOString();
}

function applyOverlap(dateString: string, minutes: number): string {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;
  return new Date(date.getTime() - minutes * 60 * 1000).toISOString();
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

  const internalToken = req.headers["x-internal-token"];
  const internalTokenValue = Array.isArray(internalToken) ? internalToken[0] : internalToken;
  const expectedToken = process.env.INTERNAL_ADMIN_TOKEN ?? null;
  const usingInternalToken = expectedToken && internalTokenValue === expectedToken;

  let companyId: string | null = null;
  let dataClient: SupabaseClient = createUserClient(supabaseUrl, anonKey, "");

  try {
    if (usingInternalToken) {
      if (!parseResult.data.companyId) {
        res.status(400).json({
          ok: false,
          error: "companyId is required when using internal token",
        });
        return;
      }

      companyId = parseResult.data.companyId;
      dataClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);
    } else {
      const bearerToken = getBearerToken(req);
      if (!bearerToken) {
        res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token" });
        return;
      }

      dataClient = createUserClient(supabaseUrl, anonKey, bearerToken);
      const { data: userData, error: userError } = await dataClient.auth.getUser();
      if (userError || !userData?.user) {
        res.status(401).json({ ok: false, error: "Not authenticated" });
        return;
      }

      const { data: membership, error: membershipError } = await dataClient
        .from("erp_company_users")
        .select("company_id, role_key")
        .eq("user_id", userData.user.id)
        .eq("is_active", true)
        .maybeSingle();

      if (membershipError) {
        res.status(500).json({ ok: false, error: membershipError.message });
        return;
      }

      if (!membership?.company_id) {
        res.status(403).json({ ok: false, error: "No active company membership" });
        return;
      }

      const allowedRoles = ["owner", "admin"];
      if (!allowedRoles.includes(membership.role_key ?? "")) {
        res.status(403).json({ ok: false, error: "Not authorized to sync orders" });
        return;
      }

      companyId = membership.company_id;
    }

    if (!companyId) {
      res.status(400).json({ ok: false, error: "Missing companyId" });
      return;
    }

    const accessToken = await getAmazonAccessToken();
    const marketplaceId = parseResult.data.marketplaceId ?? DEFAULT_MARKETPLACE_ID;

    const { data: syncState, error: syncError } = await dataClient
      .from("erp_sync_state")
      .select("last_updated_after")
      .eq("company_id", companyId)
      .eq("source_key", SOURCE_KEY)
      .eq("marketplace_id", marketplaceId)
      .maybeSingle();

    if (syncError) {
      res.status(500).json({ ok: false, error: syncError.message });
      return;
    }

    const fallbackStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const lastUpdatedAfter =
      (syncState?.last_updated_after as string | null) ?? toIsoString(fallbackStart);

    let orders: AmazonOrder[] = [];
    let nextToken: string | null | undefined;

    do {
      const response = await listOrdersPage({
        accessToken,
        marketplaceId,
        lastUpdatedAfter,
        nextToken,
      });

      orders = orders.concat(response.orders);
      nextToken = response.nextToken;
    } while (nextToken);

    let ordersUpserted = 0;
    let itemsWritten = 0;
    let maxLastUpdate: string | null = null;

    const processOrder = async (order: AmazonOrder) => {
      const amazonOrderId = typeof order.AmazonOrderId === "string" ? order.AmazonOrderId : null;
      if (!amazonOrderId) return;

      const { error: upsertError } = await dataClient.rpc("erp_amazon_orders_upsert", {
        p_marketplace_id: marketplaceId,
        p_order: order,
      });

      if (upsertError) {
        throw new Error(upsertError.message);
      }

      ordersUpserted += 1;

      const items = await listOrderItems({ accessToken, amazonOrderId });
      const { data: itemCount, error: itemsError } = await dataClient.rpc(
        "erp_amazon_order_items_replace",
        {
          p_marketplace_id: marketplaceId,
          p_amazon_order_id: amazonOrderId,
          p_items: items,
        }
      );

      if (itemsError) {
        throw new Error(itemsError.message);
      }

      if (typeof itemCount === "number") {
        itemsWritten += itemCount;
      }

      if (typeof order.LastUpdateDate === "string") {
        const date = new Date(order.LastUpdateDate);
        if (!Number.isNaN(date.getTime())) {
          const current = maxLastUpdate ? new Date(maxLastUpdate) : null;
          if (!current || date > current) {
            maxLastUpdate = order.LastUpdateDate;
          }
        }
      }
    };

    await mapWithConcurrency(orders, CONCURRENCY, processOrder);

    const nextWatermark = maxLastUpdate
      ? applyOverlap(maxLastUpdate, 5)
      : lastUpdatedAfter;

    const { error: syncUpdateError } = await dataClient.from("erp_sync_state").upsert(
      {
        company_id: companyId,
        source_key: SOURCE_KEY,
        marketplace_id: marketplaceId,
        last_updated_after: nextWatermark,
        last_run_at: new Date().toISOString(),
        last_status: "success",
        last_error: null,
      },
      { onConflict: "company_id,source_key,marketplace_id" }
    );

    if (syncUpdateError) {
      res.status(500).json({ ok: false, error: syncUpdateError.message });
      return;
    }

    res.status(200).json({
      ok: true,
      orders_upserted: ordersUpserted,
      items_written: itemsWritten,
      next_watermark: nextWatermark,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (companyId) {
      await dataClient.from("erp_sync_state").upsert(
        {
          company_id: companyId,
          source_key: SOURCE_KEY,
          marketplace_id: parseResult.data.marketplaceId ?? DEFAULT_MARKETPLACE_ID,
          last_run_at: new Date().toISOString(),
          last_status: "error",
          last_error: message,
        },
        { onConflict: "company_id,source_key,marketplace_id" }
      );
    }
    res.status(500).json({ ok: false, error: message });
  }
}
