import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { z } from "zod";
import ErpShell from "../../../../components/erp/ErpShell";
import { pageContainerStyle } from "../../../../components/erp/uiStyles";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

type WarehouseOption = {
  id: string;
  name: string;
};

const stocktakeIdSchema = z.string().uuid();

export default function NewStocktakePage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;

      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found for this user.");
        setLoading(false);
        return;
      }

      const { data: warehouseData, error: warehouseError } = await supabase
        .from("erp_warehouses")
        .select("id, name")
        .eq("company_id", context.companyId)
        .order("name", { ascending: true });

      if (!active) return;

      if (warehouseError) {
        setError(warehouseError.message || "Failed to load warehouses.");
        setLoading(false);
        return;
      }

      const warehouses = (warehouseData || []) as WarehouseOption[];
      if (warehouses.length === 0) {
        setError("Create a warehouse before starting a stocktake.");
        setLoading(false);
        return;
      }

      const { data, error: createError } = await supabase.rpc("erp_stocktake_create", {
        p_warehouse_id: warehouses[0].id,
        p_date: new Date().toISOString().slice(0, 10),
        p_reference: null,
        p_notes: null,
      });

      if (!active) return;

      if (createError) {
        setError(createError.message || "Failed to create stocktake.");
        setLoading(false);
        return;
      }

      const parseResult = stocktakeIdSchema.safeParse(data);
      if (!parseResult.success) {
        setError("Failed to parse stocktake id.");
        setLoading(false);
        return;
      }

      router.replace(`/erp/inventory/stocktakes/${parseResult.data}`);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  if (loading) {
    return (
      <ErpShell activeModule="workspace">
        <div style={pageContainerStyle}>Creating stocktake…</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="workspace">
      <div style={pageContainerStyle}>{error || "Unable to create stocktake."}</div>
    </ErpShell>
  );
}
