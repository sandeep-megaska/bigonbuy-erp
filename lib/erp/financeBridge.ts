import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { supabase } from "../supabaseClient";

const nullableNumberSchema = z.union([z.coerce.number(), z.null()]);

const inventoryClosingRowSchema = z.object({
  warehouse_id: z.string().uuid().nullable(),
  warehouse_name: z.string().nullable(),
  on_hand_qty: z.coerce.number(),
  stock_value: nullableNumberSchema,
  cost_coverage_pct: nullableNumberSchema,
});

const movementSummaryRowSchema = z.object({
  type: z.string(),
  warehouse_id: z.string().uuid().nullable(),
  warehouse_name: z.string().nullable(),
  qty_sum: z.coerce.number(),
  txn_count: z.coerce.number(),
});

const cogsEstimateRowSchema = z.object({
  sku: z.string(),
  variant_id: z.string().uuid(),
  qty_sold: z.coerce.number(),
  est_unit_cost: nullableNumberSchema,
  est_cogs: nullableNumberSchema,
  cost_source: z.string(),
  missing_cost: z.coerce.boolean(),
});

const grnRegisterRowSchema = z.object({
  grn_id: z.string().uuid(),
  grn_date: z.string(),
  vendor_name: z.string().nullable(),
  reference: z.string().nullable(),
  status: z.string(),
  total_qty: z.coerce.number(),
  total_cost: nullableNumberSchema,
  cost_missing_count: z.coerce.number(),
});

const inventoryClosingResponseSchema = z.array(inventoryClosingRowSchema);
const movementSummaryResponseSchema = z.array(movementSummaryRowSchema);
const cogsEstimateResponseSchema = z.array(cogsEstimateRowSchema);
const grnRegisterResponseSchema = z.array(grnRegisterRowSchema);

export type InventoryClosingSnapshotRow = z.infer<typeof inventoryClosingRowSchema>;
export type InventoryMovementSummaryRow = z.infer<typeof movementSummaryRowSchema>;
export type CogsEstimateRow = z.infer<typeof cogsEstimateRowSchema>;
export type GrnRegisterRow = z.infer<typeof grnRegisterRowSchema>;

export type InventoryClosingParams = {
  companyId: string | null;
  asOf: string;
  warehouseId?: string | null;
};

export type MovementSummaryParams = {
  companyId: string | null;
  from: string;
  to: string;
  warehouseId?: string | null;
};

export type CogsEstimateParams = {
  companyId: string | null;
  from: string;
  to: string;
  warehouseId?: string | null;
};

export type GrnRegisterParams = {
  companyId: string | null;
  from: string;
  to: string;
  vendorId?: string | null;
};

export function useInventoryClosingSnapshot(params: InventoryClosingParams) {
  const [data, setData] = useState<InventoryClosingSnapshotRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryKey = useMemo(
    () => [params.companyId, params.asOf, params.warehouseId ?? null],
    [params.companyId, params.asOf, params.warehouseId]
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

      const { data: rows, error: rpcError } = await supabase.rpc(
        "erp_fin_inventory_closing_snapshot",
        {
          p_as_of: params.asOf,
          p_warehouse_id: params.warehouseId ?? null,
        }
      );

      if (!active) return;

      if (rpcError) {
        setError(rpcError.message);
        setData([]);
        setLoading(false);
        return;
      }

      const parsed = inventoryClosingResponseSchema.safeParse(rows ?? []);
      if (!parsed.success) {
        setError("Failed to parse inventory closing snapshot response.");
        setData([]);
        setLoading(false);
        return;
      }

      setData(parsed.data);
      setLoading(false);
    }

    load();

    return () => {
      active = false;
    };
  }, [queryKey]);

  return { data, loading, error };
}

export function useInventoryMovementSummary(params: MovementSummaryParams) {
  const [data, setData] = useState<InventoryMovementSummaryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryKey = useMemo(
    () => [params.companyId, params.from, params.to, params.warehouseId ?? null],
    [params.companyId, params.from, params.to, params.warehouseId]
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

      const { data: rows, error: rpcError } = await supabase.rpc(
        "erp_fin_inventory_movement_summary",
        {
          p_from: params.from,
          p_to: params.to,
          p_warehouse_id: params.warehouseId ?? null,
        }
      );

      if (!active) return;

      if (rpcError) {
        setError(rpcError.message);
        setData([]);
        setLoading(false);
        return;
      }

      const parsed = movementSummaryResponseSchema.safeParse(rows ?? []);
      if (!parsed.success) {
        setError("Failed to parse inventory movement summary response.");
        setData([]);
        setLoading(false);
        return;
      }

      setData(parsed.data);
      setLoading(false);
    }

    load();

    return () => {
      active = false;
    };
  }, [queryKey]);

  return { data, loading, error };
}

export function useCogsEstimate(params: CogsEstimateParams) {
  const [data, setData] = useState<CogsEstimateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryKey = useMemo(
    () => [params.companyId, params.from, params.to, params.warehouseId ?? null],
    [params.companyId, params.from, params.to, params.warehouseId]
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

      const fromTimestamp = `${params.from}T00:00:00.000Z`;
      const toTimestamp = `${params.to}T23:59:59.999Z`;

      let salesQuery = supabase
        .from("erp_inventory_ledger")
        .select("variant_id, qty, qty_out")
        .eq("company_id", params.companyId)
        .eq("type", "sale_out")
        .gte("created_at", fromTimestamp)
        .lte("created_at", toTimestamp)
        .eq("is_void", false)
        .filter("variant_id", "not.is", null);

      if (params.warehouseId) {
        salesQuery = salesQuery.eq("warehouse_id", params.warehouseId);
      }

      const { data: salesRows, error: salesError } = await salesQuery;

      if (!active) return;

      if (salesError) {
        setError(salesError.message);
        setData([]);
        setLoading(false);
        return;
      }

      const qtyByVariant = new Map<string, number>();
      for (const row of salesRows ?? []) {
        const variantId = row.variant_id as string | null;
        if (!variantId) continue;
        const qtyOut = typeof row.qty_out === "number" && row.qty_out > 0 ? row.qty_out : null;
        const qty = typeof row.qty === "number" ? row.qty : 0;
        const qtySold = qtyOut ?? Math.abs(qty);
        if (qtySold === 0) continue;
        qtyByVariant.set(variantId, (qtyByVariant.get(variantId) ?? 0) + qtySold);
      }

      if (qtyByVariant.size === 0) {
        setData([]);
        setLoading(false);
        return;
      }

      const variantIds = Array.from(qtyByVariant.keys());

      let costQuery = supabase
        .from("erp_inventory_effective_unit_cost_v")
        .select("variant_id, effective_unit_cost_final, cost_source")
        .eq("company_id", params.companyId)
        .in("variant_id", variantIds);

      if (params.warehouseId) {
        costQuery = costQuery.eq("warehouse_id", params.warehouseId);
      }

      const [{ data: variantRows, error: variantError }, { data: costRows, error: costError }] =
        await Promise.all([
          supabase
            .from("erp_variants")
            .select("id, sku")
            .eq("company_id", params.companyId)
            .in("id", variantIds),
          costQuery,
        ]);

      if (!active) return;

      if (variantError || costError) {
        setError(variantError?.message || costError?.message || "Failed to load COGS data.");
        setData([]);
        setLoading(false);
        return;
      }

      const skuByVariant = new Map<string, string>();
      for (const row of variantRows ?? []) {
        if (row.id && row.sku) {
          skuByVariant.set(row.id, row.sku);
        }
      }

      const costByVariant = new Map<string, { unitCost: number | null; costSource: string }>();
      for (const row of costRows ?? []) {
        const variantId = row.variant_id as string | null;
        if (!variantId) continue;
        const unitCost =
          typeof row.effective_unit_cost_final === "number" ? row.effective_unit_cost_final : null;
        const rawSource = typeof row.cost_source === "string" ? row.cost_source.trim().toLowerCase() : "";
        const costSource = rawSource === "override" ? "Override" : "Inventory";
        costByVariant.set(variantId, { unitCost, costSource });
      }

      const roundCurrency = (value: number) => Math.round(value * 100) / 100;

      const rows: CogsEstimateRow[] = variantIds.map((variantId) => {
        const qtySold = qtyByVariant.get(variantId) ?? 0;
        const sku = skuByVariant.get(variantId) ?? variantId;
        const costInfo = costByVariant.get(variantId);
        const unitCost = costInfo?.unitCost ?? null;
        const estCogs = unitCost == null ? null : roundCurrency(qtySold * unitCost);
        const costSource = unitCost == null ? "Missing" : costInfo?.costSource ?? "Inventory";

        return {
          sku,
          variant_id: variantId,
          qty_sold: qtySold,
          est_unit_cost: unitCost == null ? null : roundCurrency(unitCost),
          est_cogs: estCogs,
          cost_source: costSource,
          missing_cost: unitCost == null,
        };
      });

      rows.sort((a, b) => a.sku.localeCompare(b.sku));

      const parsed = cogsEstimateResponseSchema.safeParse(rows);
      if (!parsed.success) {
        setError("Failed to parse COGS estimate response.");
        setData([]);
        setLoading(false);
        return;
      }

      setData(parsed.data);
      setLoading(false);
    }

    load();

    return () => {
      active = false;
    };
  }, [queryKey]);

  return { data, loading, error };
}

export function useGrnRegister(params: GrnRegisterParams) {
  const [data, setData] = useState<GrnRegisterRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryKey = useMemo(
    () => [params.companyId, params.from, params.to, params.vendorId ?? null],
    [params.companyId, params.from, params.to, params.vendorId]
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

      const { data: rows, error: rpcError } = await supabase.rpc("erp_fin_grn_register", {
        p_from: params.from,
        p_to: params.to,
        p_vendor_id: params.vendorId ?? null,
      });

      if (!active) return;

      if (rpcError) {
        setError(rpcError.message);
        setData([]);
        setLoading(false);
        return;
      }

      const parsed = grnRegisterResponseSchema.safeParse(rows ?? []);
      if (!parsed.success) {
        setError("Failed to parse GRN register response.");
        setData([]);
        setLoading(false);
        return;
      }

      setData(parsed.data);
      setLoading(false);
    }

    load();

    return () => {
      active = false;
    };
  }, [queryKey]);

  return { data, loading, error };
}
