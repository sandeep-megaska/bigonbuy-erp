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

const inventoryLowStockRowSchema = inventoryAvailableRowSchema;

export type InventoryAvailableRow = z.infer<typeof inventoryAvailableRowSchema>;
export type InventoryLowStockRow = z.infer<typeof inventoryLowStockRowSchema>;

const inventoryAvailableResponseSchema = z.array(inventoryAvailableRowSchema);
const inventoryLowStockResponseSchema = z.array(inventoryLowStockRowSchema);

export type InventoryHealthParams = {
  companyId: string | null;
  warehouseId?: string | null;
  query?: string;
  limit?: number;
  offset?: number;
  sortBy?: "sku" | "qty";
  sortDirection?: "asc" | "desc";
  reloadKey?: number;
};

export function useInventoryAvailable(params: InventoryHealthParams) {
  const [data, setData] = useState<InventoryAvailableRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryKey = useMemo(
    () => [
      params.companyId,
      params.warehouseId,
      params.query,
      params.limit ?? 100,
      params.offset ?? 0,
      params.sortBy ?? "sku",
      params.sortDirection ?? "asc",
      params.reloadKey ?? 0,
    ],
    [
      params.companyId,
      params.warehouseId,
      params.query,
      params.limit,
      params.offset,
      params.sortBy,
      params.sortDirection,
      params.reloadKey,
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

      const limit = params.limit ?? 100;
      const offset = params.offset ?? 0;

      const sortBy = params.sortBy ?? "sku";
      const sortDirection = params.sortDirection ?? "asc";

      let query = supabase
        .from("erp_inventory_available_v")
        .select("*")
        .order(sortBy === "qty" ? "available" : "variant_id", { ascending: sortDirection === "asc" })
        .range(offset, offset + limit - 1);

      if (params.warehouseId) {
        query = query.eq("warehouse_id", params.warehouseId);
      }

      const trimmedQuery = params.query?.trim();
      if (trimmedQuery && isUuid(trimmedQuery)) {
        query = query.eq("variant_id", trimmedQuery);
      }

      const { data: rows, error: fetchError } = await query;

      if (!active) return;

      if (fetchError) {
        setError(fetchError.message);
        setData([]);
        setLoading(false);
        return;
      }

      const parseResult = inventoryAvailableResponseSchema.safeParse(rows ?? []);
      if (!parseResult.success) {
        setError("Failed to parse available stock response.");
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

export function useInventoryNegativeStock(params: InventoryHealthParams) {
  const [data, setData] = useState<InventoryAvailableRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryKey = useMemo(
    () => [
      params.companyId,
      params.warehouseId,
      params.query,
      params.limit ?? 100,
      params.offset ?? 0,
      params.sortBy ?? "qty",
      params.sortDirection ?? "asc",
      params.reloadKey ?? 0,
    ],
    [
      params.companyId,
      params.warehouseId,
      params.query,
      params.limit,
      params.offset,
      params.sortBy,
      params.sortDirection,
      params.reloadKey,
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

      const limit = params.limit ?? 100;
      const offset = params.offset ?? 0;

      const sortBy = params.sortBy ?? "qty";
      const sortDirection = params.sortDirection ?? "asc";

      let query = supabase
        .from("erp_inventory_negative_stock_v")
        .select("*")
        .order(sortBy === "qty" ? "on_hand" : "variant_id", { ascending: sortDirection === "asc" })
        .range(offset, offset + limit - 1);

      if (params.warehouseId) {
        query = query.eq("warehouse_id", params.warehouseId);
      }

      const trimmedQuery = params.query?.trim();
      if (trimmedQuery && isUuid(trimmedQuery)) {
        query = query.eq("variant_id", trimmedQuery);
      }

      const { data: rows, error: fetchError } = await query;

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
    () => [
      params.companyId,
      params.warehouseId,
      params.query,
      params.limit ?? 100,
      params.offset ?? 0,
      params.sortBy ?? "qty",
      params.sortDirection ?? "asc",
      params.reloadKey ?? 0,
    ],
    [
      params.companyId,
      params.warehouseId,
      params.query,
      params.limit,
      params.offset,
      params.sortBy,
      params.sortDirection,
      params.reloadKey,
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

      const limit = params.limit ?? 100;
      const offset = params.offset ?? 0;

      const sortBy = params.sortBy ?? "qty";
      const sortDirection = params.sortDirection ?? "asc";

      let query = supabase
        .from("erp_inventory_low_stock_v")
        .select("*")
        .order(sortBy === "qty" ? "available" : "variant_id", { ascending: sortDirection === "asc" })
        .range(offset, offset + limit - 1);

      if (params.warehouseId) {
        query = query.eq("warehouse_id", params.warehouseId);
      }

      const trimmedQuery = params.query?.trim();
      if (trimmedQuery && isUuid(trimmedQuery)) {
        query = query.eq("variant_id", trimmedQuery);
      }

      const { data: rows, error: fetchError } = await query;

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

function isUuid(value: string) {
  return z.string().uuid().safeParse(value).success;
}
