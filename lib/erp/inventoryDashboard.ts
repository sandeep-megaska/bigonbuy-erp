import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { supabase } from "../supabaseClient";

const dashboardSummarySchema = z.object({
  warehouse: z.object({
    id: z.string().uuid(),
    code: z.string().nullable(),
    name: z.string(),
  }),
  kpis: z.object({
    on_hand_value: z.coerce.number().nullable(),
    low_stock_count: z.coerce.number(),
    pending_po_count: z.coerce.number(),
    stocktake_pending_count: z.coerce.number(),
    sales_today_count: z.coerce.number(),
  }),
  recent: z.object({
    grns: z.array(
      z.object({
        id: z.string().uuid(),
        date: z.string(),
        ref: z.string(),
        vendor_name: z.string().nullable(),
        status: z.string(),
      })
    ),
    transfers: z.array(
      z.object({
        id: z.string().uuid(),
        date: z.string(),
        ref: z.string().nullable(),
        from_wh: z.string().nullable(),
        to_wh: z.string().nullable(),
        status: z.string(),
      })
    ),
    sales: z.array(
      z.object({
        id: z.string().uuid(),
        date: z.string(),
        ref: z.string().nullable(),
        channel_name: z.string().nullable(),
        status: z.string(),
      })
    ),
  }),
});

export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

export type InventoryDashboardSummaryParams = {
  companyId: string | null;
  warehouseId: string | null;
  date?: string | null;
};

export function useInventoryDashboardSummary(params: InventoryDashboardSummaryParams) {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryKey = useMemo(
    () => [params.companyId, params.warehouseId, params.date ?? null],
    [params.companyId, params.warehouseId, params.date]
  );

  useEffect(() => {
    let active = true;

    async function load() {
      if (!params.companyId || !params.warehouseId) {
        setData(null);
        setError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      const { data: summary, error: rpcError } = await supabase.rpc("erp_inventory_dashboard_summary", {
        p_warehouse_id: params.warehouseId,
        p_date: params.date ?? null,
      });

      if (!active) return;

      if (rpcError) {
        setError(rpcError.message);
        setData(null);
        setLoading(false);
        return;
      }

      const parseResult = dashboardSummarySchema.safeParse(summary);
      if (!parseResult.success) {
        setError("Failed to parse inventory dashboard summary.");
        setData(null);
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
