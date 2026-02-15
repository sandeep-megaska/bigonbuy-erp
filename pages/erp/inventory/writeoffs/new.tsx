import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { z } from "zod";
import { pageContainerStyle } from "../../../../components/erp/uiStyles";
import { getCompanyContext, isInventoryWriter, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

type CompanyContext = {
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
};

type WarehouseOption = {
  id: string;
  name: string;
  code: string | null;
};

const writeoffIdSchema = z.string().uuid();

function pickDefaultWarehouse(warehouses: WarehouseOption[]) {
  if (warehouses.length === 0) return null;
  const match = warehouses.find((warehouse) => {
    const code = (warehouse.code || "").toLowerCase();
    const name = (warehouse.name || "").toLowerCase();
    return code === "jaipur" || name.includes("jaipur");
  });
  return match ?? warehouses[0];
}

export default function NewInventoryWriteoffPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const canWrite = useMemo(() => (ctx ? isInventoryWriter(ctx.roleKey) : false), [ctx]);

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;

      setCtx({
        companyId: context.companyId,
        roleKey: context.roleKey,
        membershipError: context.membershipError,
      });

      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found for this user.");
        setLoading(false);
        return;
      }

      if (!isInventoryWriter(context.roleKey)) {
        setError("You do not have permission to create write-offs.");
        setLoading(false);
        return;
      }

      const { data: warehouseData, error: warehouseError } = await supabase
        .from("erp_warehouses")
        .select("id, name, code")
        .eq("company_id", context.companyId)
        .order("name", { ascending: true });

      if (!active) return;

      if (warehouseError) {
        setError(warehouseError.message || "Failed to load warehouses.");
        setLoading(false);
        return;
      }

      const warehouses = (warehouseData || []) as WarehouseOption[];
      const defaultWarehouse = pickDefaultWarehouse(warehouses);

      if (!defaultWarehouse) {
        setError("Create a warehouse before making a write-off.");
        setLoading(false);
        return;
      }

      const { data, error: createError } = await supabase.rpc("erp_inventory_writeoff_create", {
        p_warehouse_id: defaultWarehouse.id,
        p_date: new Date().toISOString().slice(0, 10),
        p_reason: null,
        p_ref: null,
        p_notes: null,
      });

      if (!active) return;

      if (createError) {
        setError(createError.message || "Failed to create write-off.");
        setLoading(false);
        return;
      }

      const parseResult = writeoffIdSchema.safeParse(data);
      if (!parseResult.success) {
        setError("Failed to parse write-off id.");
        setLoading(false);
        return;
      }

      await router.replace(`/erp/inventory/writeoffs/${parseResult.data}`);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  if (loading) {
    return (
      <>
        <div style={pageContainerStyle}>Creating write-off…</div>
      </>
    );
  }

  return (
    <>
      <div style={pageContainerStyle}>{error || (canWrite ? "Unable to create write-off." : "No access.")}</div>
    </>
  );
}
