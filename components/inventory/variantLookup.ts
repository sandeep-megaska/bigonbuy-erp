import { supabase } from "../../lib/supabaseClient";
import type { VariantSearchResult } from "./VariantTypeahead";

export async function resolveVariantBySku(sku: string): Promise<VariantSearchResult | null> {
  const normalized = sku.trim();
  if (!normalized) return null;

  const { data, error } = await supabase.rpc("erp_variant_search", {
    p_query: normalized,
    p_limit: 20,
  });

  if (error) {
    throw new Error(error.message || "Failed to search variants.");
  }

  const results = (data || []) as VariantSearchResult[];
  const upperSku = normalized.toUpperCase();

  return results.find((variant) => variant.sku.toUpperCase() === upperSku) ?? null;
}
