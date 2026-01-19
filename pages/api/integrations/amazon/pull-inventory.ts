import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAmazonAccessToken, spApiSignedFetch } from "../../../../lib/amazonSpApi";
import {
  createServiceRoleClient,
  createUserClient,
  getBearerToken,
  getSupabaseEnv,
} from "../../../../lib/serverSupabase";

type ApiResponse =
  | {
      ok: true;
      batch_id: string;
      pulled_count: number;
      matched_count: number;
      unmatched_count: number;
      ambiguous_count: number;
    }
  | { ok: false; error: string; details?: string };

type VariantRow = {
  id: string;
  sku_code: string;
  title: string | null;
  size: string | null;
  color: string | null;
  hsn: string | null;
};

type InventorySummary = z.infer<typeof inventorySummarySchema>;

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

const requestSchema = z.object({
  marketplaceId: z.string().optional(),
  companyId: z.string().uuid().optional(),
});

const inventorySummarySchema = z
  .object({
    sellerSku: z.string(),
    asin: z.string().nullable().optional(),
    fnSku: z.string().nullable().optional(),
    condition: z.string().nullable().optional(),
    inventoryDetails: z
      .object({
        fulfillableQuantity: z.number().nullable().optional(),
        reservedQuantity: z.number().nullable().optional(),
        inboundWorkingQuantity: z.number().nullable().optional(),
        inboundShippedQuantity: z.number().nullable().optional(),
        inboundReceivingQuantity: z.number().nullable().optional(),
      })
      .nullable()
      .optional(),
  })
  .passthrough();

const inventoryResponseSchema = z
  .object({
    payload: z
      .object({
        inventorySummaries: z.array(inventorySummarySchema).nullable().optional(),
      })
      .nullable()
      .optional(),
    pagination: z
      .object({
        nextToken: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
  })
  .passthrough();

const DEFAULT_MARKETPLACE_ID = "A21TJRUUN4KGV";
const ALLOWED_ROLE_KEYS = ["owner", "admin", "inventory", "finance"] as const;

function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&").replace(/,/g, "\\,");
}

async function fetchInventorySummaries(
  accessToken: string,
  marketplaceId: string
): Promise<InventorySummary[]> {
  const summaries: InventorySummary[] = [];
  let nextToken: string | null = null;

  do {
    const query = nextToken
      ? { nextToken }
      : {
          granularityType: "Marketplace",
          granularityId: marketplaceId,
          marketplaceIds: marketplaceId,
          details: true,
        };

    const response = await spApiSignedFetch({
      method: "GET",
      path: "/fba/inventory/v1/summaries",
      accessToken,
      query,
    });

    const json = await response.json();
    if (!response.ok) {
      throw new Error(`SP-API error: ${JSON.stringify(json)}`);
    }

    const parsed = inventoryResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(`Unexpected inventory response: ${parsed.error.message}`);
    }

    const batchSummaries = parsed.data.payload?.inventorySummaries ?? [];
    summaries.push(...batchSummaries);
    nextToken = parsed.data.pagination?.nextToken ?? null;
  } while (nextToken);

  return summaries;
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
    const orFilter = chunk.map((sku) => `sku_code.ilike.${escapeIlike(sku)}`).join(",");

    const { data, error } = await client
      .from("erp_variants")
      .select("id, sku_code, title, size, color, hsn")
      .eq("company_id", companyId)
      .or(orFilter);

    if (error) {
      throw new Error(error.message || "Failed to match ERP SKUs");
    }

    (data || []).forEach((row: VariantRow) => {
      const key = row.sku_code.toLowerCase();
      const existing = matches.get(key) ?? [];
      existing.push(row);
      matches.set(key, existing);
    });
  }

  return matches;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
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

  const parseResult = requestSchema.safeParse(req.body ?? {});
  if (!parseResult.success) {
    return res.status(400).json({ ok: false, error: "Invalid request body" });
  }

  const internalToken = req.headers["x-internal-token"];
  const internalTokenValue = Array.isArray(internalToken) ? internalToken[0] : internalToken;
  const expectedToken = process.env.INTERNAL_ADMIN_TOKEN ?? null;
  const usingInternalToken = expectedToken && internalTokenValue === expectedToken;

  try {
    const accessToken = await getAmazonAccessToken();
    const marketplaceId = parseResult.data.marketplaceId ?? DEFAULT_MARKETPLACE_ID;

    let companyId: string | null = null;
    let dataClient: SupabaseClient = createUserClient(supabaseUrl, anonKey, "");

    if (usingInternalToken) {
      if (!parseResult.data.companyId) {
        return res
          .status(400)
          .json({ ok: false, error: "companyId is required when using internal token" });
      }

      companyId = parseResult.data.companyId;
      dataClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);
    } else {
      const bearerToken = getBearerToken(req);
      if (!bearerToken) {
        return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token" });
      }

      dataClient = createUserClient(supabaseUrl, anonKey, bearerToken);
      const { data: userData, error: userError } = await dataClient.auth.getUser();
      if (userError || !userData?.user) {
        return res.status(401).json({ ok: false, error: "Not authenticated" });
      }

      const { data: membership, error: membershipError } = await dataClient
        .from("erp_company_users")
        .select("company_id, role_key")
        .eq("user_id", userData.user.id)
        .eq("is_active", true)
        .maybeSingle();

      if (membershipError) {
        return res.status(500).json({ ok: false, error: membershipError.message });
      }

      if (!membership?.company_id) {
        return res.status(403).json({ ok: false, error: "No active company membership" });
      }

      if (!ALLOWED_ROLE_KEYS.includes(membership.role_key as (typeof ALLOWED_ROLE_KEYS)[number])) {
        return res.status(403).json({ ok: false, error: "Not authorized to pull inventory" });
      }

      companyId = membership.company_id;
    }

    if (!companyId) {
      return res.status(400).json({ ok: false, error: "Missing companyId" });
    }

    const summaries = await fetchInventorySummaries(accessToken, marketplaceId);
    const externalSkus = summaries.map((summary) => summary.sellerSku);
    const matchesBySku = await fetchVariantMatches(dataClient, companyId, externalSkus);

    const { data: batch, error: batchError } = await dataClient
      .from("erp_external_inventory_batches")
      .insert({
        company_id: companyId,
        channel_key: "amazon",
        marketplace_id: marketplaceId,
      })
      .select("id")
      .single();

    if (batchError || !batch) {
      throw new Error(batchError?.message || "Failed to create inventory batch");
    }

    const rows: ExternalRowInsert[] = summaries.map((summary) => {
      const details = summary.inventoryDetails ?? {};
      const key = summary.sellerSku.toLowerCase();
      const variantMatches = matchesBySku.get(key) ?? [];
      let matchStatus: ExternalRowInsert["match_status"] = "unmatched";
      let erpVariantId: string | null = null;

      if (variantMatches.length === 1) {
        matchStatus = "matched";
        erpVariantId = variantMatches[0].id;
      } else if (variantMatches.length > 1) {
        matchStatus = "ambiguous";
      }

      return {
        company_id: companyId,
        batch_id: batch.id,
        channel_key: "amazon",
        marketplace_id: marketplaceId,
        external_sku: summary.sellerSku,
        asin: summary.asin ?? null,
        fnsku: summary.fnSku ?? null,
        condition: summary.condition ?? null,
        qty_available: details.fulfillableQuantity ?? 0,
        qty_reserved: details.reservedQuantity ?? 0,
        qty_inbound_working: details.inboundWorkingQuantity ?? 0,
        qty_inbound_shipped: details.inboundShippedQuantity ?? 0,
        qty_inbound_receiving: details.inboundReceivingQuantity ?? 0,
        external_location_code: null,
        erp_variant_id: erpVariantId,
        erp_warehouse_id: null,
        match_status: matchStatus,
        raw: summary,
      };
    });

    const chunkSize = 500;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      if (chunk.length === 0) continue;
      const { error } = await dataClient.from("erp_external_inventory_rows").insert(chunk);
      if (error) {
        throw new Error(error.message || "Failed to insert inventory rows");
      }
    }

    const matchedCount = rows.filter((row) => row.match_status === "matched").length;
    const unmatchedCount = rows.filter((row) => row.match_status === "unmatched").length;
    const ambiguousCount = rows.filter((row) => row.match_status === "ambiguous").length;

    return res.status(200).json({
      ok: true,
      batch_id: batch.id,
      pulled_count: rows.length,
      matched_count: matchedCount,
      unmatched_count: unmatchedCount,
      ambiguous_count: ambiguousCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
