import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { supabase } from "../supabaseClient";

const reorderSuggestionRowSchema = z.object({
  warehouse_id: z.string().uuid(),
  variant_id: z.string().uuid(),
  sku: z.string(),
  style_code: z.string().nullable(),
  product_title: z.string(),
  size: z.string().nullable(),
  color: z.string().nullable(),
  hsn: z.string().nullable(),
  on_hand: z.coerce.number(),
  min_qty: z.coerce.number(),
  target_qty: z.coerce.number().nullable(),
  suggested_qty: z.coerce.number(),
  preferred_vendor_id: z.string().uuid().nullable(),
  preferred_vendor_name: z.string().nullable(),
});

const reorderSuggestionsResponseSchema = z.array(reorderSuggestionRowSchema);

export type ReorderSuggestionRow = z.infer<typeof reorderSuggestionRowSchema>;

export type ReorderSuggestionParams = {
  companyId: string | null;
  warehouseId: string | null;
  query?: string | null;
  onlyBelowMin?: boolean;
  limit?: number;
  offset?: number;
};

export function useReorderSuggestions(params: ReorderSuggestionParams) {
  const [data, setData] = useState<ReorderSuggestionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryKey = useMemo(
    () => [
      params.companyId,
      params.warehouseId,
      params.query ?? "",
      params.onlyBelowMin ?? true,
      params.limit ?? 100,
      params.offset ?? 0,
    ],
    [
      params.companyId,
      params.warehouseId,
      params.query,
      params.onlyBelowMin,
      params.limit,
      params.offset,
    ]
  );

  useEffect(() => {
    let active = true;

    async function load() {
      if (!params.companyId || !params.warehouseId) {
        setData([]);
        setError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      const { data: rows, error: rpcError } = await supabase.rpc("erp_reorder_suggestions", {
        p_warehouse_id: params.warehouseId,
        p_query: params.query ? params.query.trim() : null,
        p_only_below_min: params.onlyBelowMin ?? true,
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

      const parseResult = reorderSuggestionsResponseSchema.safeParse(rows ?? []);
      if (!parseResult.success) {
        setError("Failed to parse reorder suggestions response.");
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
