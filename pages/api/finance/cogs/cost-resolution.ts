import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../lib/serverSupabase";

type CostResolution = {
  sku: string;
  style_code: string | null;
  override_unit_cost: number | null;
  base_unit_cost: number | null;
  style_avg_unit_cost: number | null;
  fallback_cost_price: number | null;
  chosen_unit_cost: number | null;
  cost_source_final: string | null;
};

type ApiResponse =
  | { ok: true; data: CostResolution }
  | { ok: false; error: string; details?: string | null };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const sku = typeof req.query.sku === "string" ? req.query.sku.trim() : "";
  if (!sku) {
    return res.status(400).json({ ok: false, error: "sku is required" });
  }

  const { supabaseUrl, anonKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || missing.length > 0) {
    return res.status(500).json({
      ok: false,
      error:
        "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token" });
  }

  const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  const { data: companyId, error: companyError } = await userClient.rpc("erp_current_company_id");
  if (companyError || !companyId) {
    return res.status(400).json({
      ok: false,
      error: companyError?.message || "Failed to determine company",
      details: companyError?.details || companyError?.hint || companyError?.code || null,
    });
  }

  const { data: variant, error: variantError } = await userClient
    .from("erp_variants")
    .select("id, sku, style_code, cost_price")
    .eq("company_id", companyId)
    .eq("sku", sku)
    .maybeSingle();

  if (variantError) {
    return res.status(500).json({ ok: false, error: variantError.message });
  }

  if (!variant) {
    return res.status(404).json({ ok: false, error: "SKU not found" });
  }

  const { data: costRows, error: costError } = await userClient
    .from("erp_inventory_effective_unit_cost_v")
    .select(
      "override_unit_cost, base_unit_cost, style_avg_unit_cost, fallback_cost_price, effective_unit_cost_final, cost_source_final, on_hand_qty"
    )
    .eq("company_id", companyId)
    .eq("variant_id", variant.id)
    .order("on_hand_qty", { ascending: false })
    .limit(1);

  if (costError) {
    return res.status(500).json({ ok: false, error: costError.message });
  }

  const costRow = costRows?.[0] ?? null;

  return res.status(200).json({
    ok: true,
    data: {
      sku: variant.sku,
      style_code: variant.style_code ?? null,
      override_unit_cost: typeof costRow?.override_unit_cost === "number" ? costRow.override_unit_cost : null,
      base_unit_cost: typeof costRow?.base_unit_cost === "number" ? costRow.base_unit_cost : null,
      style_avg_unit_cost: typeof costRow?.style_avg_unit_cost === "number" ? costRow.style_avg_unit_cost : null,
      fallback_cost_price:
        typeof costRow?.fallback_cost_price === "number" ? costRow.fallback_cost_price : variant.cost_price ?? null,
      chosen_unit_cost:
        typeof costRow?.effective_unit_cost_final === "number" ? costRow.effective_unit_cost_final : null,
      cost_source_final: typeof costRow?.cost_source_final === "string" ? costRow.cost_source_final : null,
    },
  });
}
