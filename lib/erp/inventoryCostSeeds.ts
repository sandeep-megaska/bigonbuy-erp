import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { supabase } from "../supabaseClient";

const costSeedRowSchema = z.object({
  id: z.string().uuid(),
  variant_id: z.string().uuid(),
  sku: z.string().nullable(),
  product_title: z.string().nullable(),
  style_code: z.string().nullable(),
  color: z.string().nullable(),
  size: z.string().nullable(),
  standard_unit_cost: z.coerce.number(),
  effective_from: z.string(),
  updated_at: z.string(),
});

const costSeedResponseSchema = z.array(costSeedRowSchema);

export type InventoryCostSeedRow = z.infer<typeof costSeedRowSchema>;

export type InventoryCostSeedListParams = {
  companyId: string | null;
  query?: string | null;
  refreshKey?: number;
};

export function useInventoryCostSeedList(params: InventoryCostSeedListParams) {
  const [data, setData] = useState<InventoryCostSeedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryKey = useMemo(
    () => [params.companyId, params.query ?? "", params.refreshKey ?? 0],
    [params.companyId, params.query, params.refreshKey]
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

      const { data: rows, error: rpcError } = await supabase.rpc("erp_inventory_cost_seed_list", {
        p_search: params.query ? params.query.trim() : null,
      });

      if (!active) return;

      if (rpcError) {
        setError(rpcError.message);
        setData([]);
        setLoading(false);
        return;
      }

      const parseResult = costSeedResponseSchema.safeParse(rows ?? []);
      if (!parseResult.success) {
        setError("Failed to parse cost seed response.");
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
