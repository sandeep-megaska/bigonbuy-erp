import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { supabase } from "../supabaseClient";

const inventoryAvailableRowSchema = z.object({
  warehouse_id: z.string().uuid(),
  variant_id: z.string().uuid(),
  on_hand: z.coerce.number(),
  reserved: z.coerce.number(),
  available: z.coerce.number(),
});

const inventoryLowStockRowSchema = inventoryAvailableRowSchema.extend({
  min_stock_level: z.coerce.number(),
});

export type InventoryAvailableRow = z.infer<typeof inventoryAvailableRowSchema>;
export type InventoryLowStockRow = z.infer<typeof inventoryLowStockRowSchema>;

const inventoryAvailableResponseSchema = z.array(inventoryAvailableRowSchema);
const inventoryLowStockResponseSchema = z.array(inventoryLowStockRowSchema);

export type InventoryHealthParams = {
  companyId: string | null;
  limit?: number;
  offset?: number;
};

export function useInventoryNegativeStock(params: InventoryHealthParams) {
  const [data, setData] = useState<InventoryAvailableRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryKey = useMemo(
    () => [params.companyId, params.limit ?? 100, params.offset ?? 0],
    [params.companyId, params.limit, params.offset]
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

      const limit = params.limit ?? 100;
      const offset = params.offset ?? 0;

      const { data: rows, error: fetchError } = await supabase
        .from("erp_inventory_negative_stock_v")
        .select("warehouse_id, variant_id, on_hand, reserved, available")
        .order("available", { ascending: true })
        .range(offset, offset + limit - 1);

      if (!active) return;

      if (fetchError) {
        setError(fetchError.message);
        setData([]);
        setLoading(false);
        return;
      }

      const parseResult = inventoryAvailableResponseSchema.safeParse(rows ?? []);
      if (!parseResult.success) {
        setError("Failed to parse negative stock response.");
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

export function useInventoryLowStock(params: InventoryHealthParams) {
  const [data, setData] = useState<InventoryLowStockRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryKey = useMemo(
    () => [params.companyId, params.limit ?? 100, params.offset ?? 0],
    [params.companyId, params.limit, params.offset]
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

      const limit = params.limit ?? 100;
      const offset = params.offset ?? 0;

      const { data: rows, error: fetchError } = await supabase
        .from("erp_inventory_low_stock_v")
        .select("warehouse_id, variant_id, on_hand, reserved, available, min_stock_level")
        .order("available", { ascending: true })
        .range(offset, offset + limit - 1);

      if (!active) return;

      if (fetchError) {
        setError(fetchError.message);
        setData([]);
        setLoading(false);
        return;
      }

      const parseResult = inventoryLowStockResponseSchema.safeParse(rows ?? []);
      if (!parseResult.success) {
        setError("Failed to parse low stock response.");
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
