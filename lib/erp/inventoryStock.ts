import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { supabase } from "../supabaseClient";

const stockOnHandRowSchema = z.object({
  warehouse_id: z.string().uuid(),
  warehouse_code: z.string().nullable(),
  warehouse_name: z.string().nullable(),
  variant_id: z.string().uuid(),
  sku: z.string(),
  style_code: z.string().nullable(),
  product_title: z.string(),
  color: z.string().nullable(),
  size: z.string().nullable(),
  hsn: z.string().nullable(),
  qty: z.coerce.number(),
});

const stockMovementsRowSchema = z.object({
  id: z.string().uuid(),
  created_at: z.string(),
  movement_date: z.string(),
  source_type: z.string(),
  source_id: z.string().uuid().nullable(),
  reference: z.string().nullable(),
  reason: z.string().nullable(),
  qty_delta: z.coerce.number(),
  balance_after: z.coerce.number().nullable(),
  created_by: z.string().uuid().nullable(),
});

export type StockOnHandRow = z.infer<typeof stockOnHandRowSchema>;
export type StockMovementsRow = z.infer<typeof stockMovementsRowSchema>;

const stockOnHandResponseSchema = z.array(stockOnHandRowSchema);
const stockMovementsResponseSchema = z.array(stockMovementsRowSchema);

export type StockOnHandListParams = {
  companyId: string | null;
  warehouseId?: string | null;
  query?: string | null;
  inStockOnly?: boolean;
  limit?: number;
  offset?: number;
};

export type StockMovementsParams = {
  companyId: string | null;
  warehouseId: string | null;
  variantId: string | null;
  limit?: number;
  offset?: number;
};

export function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => {
      window.clearTimeout(handle);
    };
  }, [value, delayMs]);

  return debouncedValue;
}

export function useStockOnHandList(params: StockOnHandListParams) {
  const [data, setData] = useState<StockOnHandRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryKey = useMemo(
    () => [
      params.companyId,
      params.warehouseId ?? null,
      params.query ?? "",
      params.inStockOnly ?? false,
      params.limit ?? 50,
      params.offset ?? 0,
    ],
    [
      params.companyId,
      params.warehouseId,
      params.query,
      params.inStockOnly,
      params.limit,
      params.offset,
    ]
  );

  useEffect(() => {
    let active = true;

    async function load() {
      if (!params.companyId) {
        setData([]);
        setError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      const { data: rows, error: rpcError } = await supabase.rpc("erp_inventory_stock_on_hand_list", {
        p_warehouse_id: params.warehouseId ?? null,
        p_query: params.query ? params.query.trim() : null,
        p_in_stock_only: params.inStockOnly ?? false,
        p_limit: params.limit ?? 50,
        p_offset: params.offset ?? 0,
      });

      if (!active) return;

      if (rpcError) {
        setError(rpcError.message);
        setData([]);
        setLoading(false);
        return;
      }

      const parseResult = stockOnHandResponseSchema.safeParse(rows ?? []);
      if (!parseResult.success) {
        setError("Failed to parse stock on hand response.");
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

export function useStockMovements(params: StockMovementsParams) {
  const [data, setData] = useState<StockMovementsRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryKey = useMemo(
    () => [
      params.companyId,
      params.warehouseId,
      params.variantId,
      params.limit ?? 100,
      params.offset ?? 0,
    ],
    [params.companyId, params.warehouseId, params.variantId, params.limit, params.offset]
  );

  useEffect(() => {
    let active = true;

    async function load() {
      if (!params.companyId || !params.warehouseId || !params.variantId) {
        setData([]);
        setError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      const { data: rows, error: rpcError } = await supabase.rpc("erp_inventory_stock_movements", {
        p_warehouse_id: params.warehouseId,
        p_variant_id: params.variantId,
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

      const parseResult = stockMovementsResponseSchema.safeParse(rows ?? []);
      if (!parseResult.success) {
        setError("Failed to parse stock movements response.");
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
