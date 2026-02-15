import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { z } from "zod";
import { pageContainerStyle } from "../../../../components/erp/uiStyles";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

type WarehouseOption = {
  id: string;
  name: string;
};

const transferIdSchema = z.string().uuid();

export default function NewTransferPage() {
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
      if (warehouses.length < 2) {
        setError("Create at least two warehouses before making a transfer.");
        setLoading(false);
        return;
      }

      const fromWarehouse = warehouses[0];
      const toWarehouse = warehouses.find((warehouse) => warehouse.id !== fromWarehouse.id) || warehouses[1];

      const { data, error: createError } = await supabase.rpc("erp_stock_transfer_create", {
        p_from_warehouse_id: fromWarehouse.id,
        p_to_warehouse_id: toWarehouse.id,
        p_transfer_date: new Date().toISOString().slice(0, 10),
        p_reference: null,
        p_notes: null,
      });

      if (!active) return;

      if (createError) {
        setError(createError.message || "Failed to create transfer.");
        setLoading(false);
        return;
      }

      const parseResult = transferIdSchema.safeParse(data);
      if (!parseResult.success) {
        setError("Failed to parse transfer id.");
        setLoading(false);
        return;
      }

      router.replace(`/erp/inventory/transfers/${parseResult.data}`);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  if (loading) {
    return (
      <>
        <div style={pageContainerStyle}>Creating transfer…</div>
      </>
    );
  }

  return (
    <>
      <div style={pageContainerStyle}>{error || "Unable to create transfer."}</div>
    </>
  );
}
