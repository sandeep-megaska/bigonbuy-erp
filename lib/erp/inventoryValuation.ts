import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { supabase } from "../supabaseClient";

const nullableNumberSchema = z.union([z.coerce.number(), z.null()]);

const valuationRowSchema = z.object({
  warehouse_id: z.string().uuid(),
  warehouse_name: z.string().nullable(),
  variant_id: z.string().uuid(),
  sku: z.string(),
  style_code: z.string().nullable(),
  product_title: z.string(),
  size: z.string().nullable(),
  color: z.string().nullable(),
  on_hand: z.coerce.number(),
  wac: nullableNumberSchema,
  stock_value: nullableNumberSchema,
});

export type InventoryValuationRow = z.infer<typeof valuationRowSchema>;

const valuationResponseSchema = z.array(valuationRowSchema);

export type InventoryValuationParams = {
  companyId: string | null;
  warehouseId?: string | null;
  query?: string | null;
  limit?: number;
  offset?: number;
};

export function useInventoryValuationList(params: InventoryValuationParams) {
  const [data, setData] = useState<InventoryValuationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryKey = useMemo(
    () => [
      params.companyId,
      params.warehouseId ?? null,
      params.query ?? "",
      params.limit ?? 100,
      params.offset ?? 0,
    ],
    [params.companyId, params.warehouseId, params.query, params.limit, params.offset]
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

      const { data: rows, error: rpcError } = await supabase.rpc("erp_inventory_valuation", {
        p_warehouse_id: params.warehouseId ?? null,
        p_query: params.query ? params.query.trim() : null,
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

      const parseResult = valuationResponseSchema.safeParse(rows ?? []);
      if (!parseResult.success) {
        setError("Failed to parse inventory valuation response.");
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
