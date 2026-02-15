import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { z } from "zod";
import { pageContainerStyle } from "../../../../components/erp/uiStyles";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

type WarehouseOption = {
  id: string;
  name: string;
  code: string | null;
};

const receiptIdSchema = z.string().uuid();

export default function NewReturnReceiptPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const receiptType = useMemo(() => {
    if (typeof router.query.type !== "string") return "return";
    return router.query.type === "rto" ? "rto" : "return";
  }, [router.query.type]);

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
      if (warehouses.length === 0) {
        setError("Create a warehouse before making a return receipt.");
        setLoading(false);
        return;
      }

      const jaipur = warehouses.find((warehouse) => {
        const code = (warehouse.code || "").toLowerCase();
        const name = (warehouse.name || "").toLowerCase();
        return code === "jaipur" || name.includes("jaipur");
      });

      const warehouseId = (jaipur || warehouses[0]).id;

      const { data, error: createError } = await supabase.rpc("erp_return_receipt_create", {
        p_warehouse_id: warehouseId,
        p_receipt_type: receiptType,
        p_reference: null,
        p_notes: null,
        p_receipt_date: new Date().toISOString().slice(0, 10),
      });

      if (!active) return;

      if (createError) {
        setError(createError.message || "Failed to create return receipt.");
        setLoading(false);
        return;
      }

      const parseResult = receiptIdSchema.safeParse(data);
      if (!parseResult.success) {
        setError("Failed to parse receipt id.");
        setLoading(false);
        return;
      }

      router.replace(`/erp/inventory/returns/${parseResult.data}`);
    })();

    return () => {
      active = false;
    };
  }, [router, receiptType]);

  if (loading) {
    return (
      <>
        <div style={pageContainerStyle}>Creating return receipt…</div>
      </>
    );
  }

  return (
    <>
      <div style={pageContainerStyle}>{error || "Unable to create return receipt."}</div>
    </>
  );
}
