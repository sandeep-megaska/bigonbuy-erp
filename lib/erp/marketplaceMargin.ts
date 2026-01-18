import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { supabase } from "../supabaseClient";

const nullableNumberSchema = z.union([z.coerce.number(), z.null()]);

const marginSummaryRowSchema = z.object({
  sku: z.string(),
  qty: z.coerce.number(),
  gross_sales: nullableNumberSchema,
  net_payout: nullableNumberSchema,
  total_fees: nullableNumberSchema,
  refunds: nullableNumberSchema,
  est_unit_cost: nullableNumberSchema,
  est_cogs: nullableNumberSchema,
  contribution: nullableNumberSchema,
  margin_pct: nullableNumberSchema,
});

const marginSummaryResponseSchema = z.array(marginSummaryRowSchema);

export type MarketplaceMarginRow = z.infer<typeof marginSummaryRowSchema>;

const orderSummaryRowSchema = z.object({
  order_id: z.string(),
  txn_count: z.coerce.number(),
  qty: z.coerce.number(),
  net_payout: nullableNumberSchema,
  est_cogs: nullableNumberSchema,
  contribution: nullableNumberSchema,
  margin_pct: nullableNumberSchema,
});

const orderSummaryResponseSchema = z.array(orderSummaryRowSchema);

export type MarketplaceOrderSummaryRow = z.infer<typeof orderSummaryRowSchema>;

const orderLineRowSchema = z.object({
  txn_date: z.string().nullable(),
  sku: z.string().nullable(),
  qty: z.coerce.number(),
  gross_sales: nullableNumberSchema,
  net_payout: nullableNumberSchema,
  fees: nullableNumberSchema,
  refunds: nullableNumberSchema,
  est_unit_cost: nullableNumberSchema,
  est_cogs: nullableNumberSchema,
  contribution: nullableNumberSchema,
});

const orderLineResponseSchema = z.array(orderLineRowSchema);

export type MarketplaceOrderLineRow = z.infer<typeof orderLineRowSchema>;

export type MarketplaceMarginParams = {
  channelCode: string;
  from: string | null;
  to: string | null;
  skuQuery?: string | null;
  limit?: number;
  offset?: number;
};

export function useMarketplaceMarginSummary(params: MarketplaceMarginParams) {
  const [data, setData] = useState<MarketplaceMarginRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryKey = useMemo(
    () => [
      params.channelCode,
      params.from ?? null,
      params.to ?? null,
      params.skuQuery ?? "",
      params.limit ?? 100,
      params.offset ?? 0,
    ],
    [params.channelCode, params.from, params.to, params.skuQuery, params.limit, params.offset]
  );

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      const { data: rows, error: rpcError } = await supabase.rpc("erp_marketplace_margin_summary", {
        p_channel_code: params.channelCode,
        p_from: params.from,
        p_to: params.to,
        p_sku_query: params.skuQuery ? params.skuQuery.trim() : null,
        p_limit: params.limit ?? 100,
        p_offset: params.offset ?? 0,
      });

      if (!active) return;

      if (rpcError) {
        setError(rpcError.message);
        setData([]);
        setLoading(false);
        return;
      }

      const parseResult = marginSummaryResponseSchema.safeParse(rows ?? []);
      if (!parseResult.success) {
        setError("Failed to parse marketplace margin summary.");
        setData([]);
        setLoading(false);
        return;
      }

      setData(parseResult.data);
      setLoading(false);
    }

    load();

    return () => {
      active = false;
    };
  }, [queryKey]);

  return { data, loading, error };
}

export type MarketplaceOrderParams = {
  channelCode: string;
  from: string | null;
  to: string | null;
  orderQuery?: string | null;
  limit?: number;
  offset?: number;
};

export function useMarketplaceOrderSummary(params: MarketplaceOrderParams) {
  const [data, setData] = useState<MarketplaceOrderSummaryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryKey = useMemo(
    () => [
      params.channelCode,
      params.from ?? null,
      params.to ?? null,
      params.orderQuery ?? "",
      params.limit ?? 100,
      params.offset ?? 0,
    ],
    [params.channelCode, params.from, params.to, params.orderQuery, params.limit, params.offset]
  );

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      const { data: rows, error: rpcError } = await supabase.rpc("erp_marketplace_order_drilldown", {
        p_channel_code: params.channelCode,
        p_from: params.from,
        p_to: params.to,
        p_order_query: params.orderQuery ? params.orderQuery.trim() : null,
        p_limit: params.limit ?? 100,
        p_offset: params.offset ?? 0,
      });

      if (!active) return;

      if (rpcError) {
        setError(rpcError.message);
        setData([]);
        setLoading(false);
        return;
      }

      const parseResult = orderSummaryResponseSchema.safeParse(rows ?? []);
      if (!parseResult.success) {
        setError("Failed to parse marketplace order summary.");
        setData([]);
        setLoading(false);
        return;
      }

      setData(parseResult.data);
      setLoading(false);
    }

    load();

    return () => {
      active = false;
    };
  }, [queryKey]);

  return { data, loading, error };
}

export function useMarketplaceOrderLines({
  channelCode,
  orderId,
}: {
  channelCode: string;
  orderId: string | null;
}) {
  const [data, setData] = useState<MarketplaceOrderLineRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryKey = useMemo(() => [channelCode, orderId ?? ""], [channelCode, orderId]);

  useEffect(() => {
    let active = true;

    async function load() {
      if (!orderId) {
        setData([]);
        setError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      const { data: rows, error: rpcError } = await supabase.rpc("erp_marketplace_order_lines", {
        p_order_id: orderId,
        p_channel_code: channelCode,
      });

      if (!active) return;

      if (rpcError) {
        setError(rpcError.message);
        setData([]);
        setLoading(false);
        return;
      }

      const parseResult = orderLineResponseSchema.safeParse(rows ?? []);
      if (!parseResult.success) {
        setError("Failed to parse marketplace order lines.");
        setData([]);
        setLoading(false);
        return;
      }

      setData(parseResult.data);
      setLoading(false);
    }

    load();

    return () => {
      active = false;
    };
  }, [queryKey]);

  return { data, loading, error };
}
