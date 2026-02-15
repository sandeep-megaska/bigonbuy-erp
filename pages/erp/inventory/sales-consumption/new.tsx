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

type SalesChannel = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

const salesChannelsSchema = z.array(
  z.object({
    id: z.string().uuid(),
    code: z.string(),
    name: z.string(),
    is_active: z.boolean(),
  })
);

const consumptionIdSchema = z.string().uuid();

function pickDefaultWarehouse(warehouses: WarehouseOption[]) {
  if (warehouses.length === 0) return null;
  const match = warehouses.find((warehouse) =>
    [warehouse.name, warehouse.code]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes("jaipur"))
  );
  return match ?? warehouses[0];
}

function pickDefaultChannel(channels: SalesChannel[]) {
  if (channels.length === 0) return null;
  const activeChannels = channels.filter((channel) => channel.is_active);
  const preferred = ["myntra", "amazon"];
  for (const code of preferred) {
    const match = activeChannels.find((channel) => channel.code === code);
    if (match) return match;
  }
  return activeChannels[0] ?? channels[0];
}

export default function SalesConsumptionNewPage() {
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
        setError("You do not have permission to create sales consumption documents.");
        setLoading(false);
        return;
      }

      const [warehouseRes, channelRes] = await Promise.all([
        supabase.from("erp_warehouses").select("id, name, code").eq("company_id", context.companyId).order("name"),
        supabase.rpc("erp_sales_channels_list"),
      ]);

      if (warehouseRes.error || channelRes.error) {
        setError(warehouseRes.error?.message || channelRes.error?.message || "Failed to load defaults.");
        setLoading(false);
        return;
      }

      const channelParse = salesChannelsSchema.safeParse(channelRes.data);
      if (!channelParse.success) {
        setError("Failed to parse sales channels.");
        setLoading(false);
        return;
      }

      const warehouses = (warehouseRes.data || []) as WarehouseOption[];
      const channels = channelParse.data;
      const defaultWarehouse = pickDefaultWarehouse(warehouses);
      const defaultChannel = pickDefaultChannel(channels);

      if (!defaultWarehouse || !defaultChannel) {
        setError("Create a warehouse and sales channel before creating a sales consumption.");
        setLoading(false);
        return;
      }

      const { data, error: createError } = await supabase.rpc("erp_sales_consumption_create", {
        p_channel_id: defaultChannel.id,
        p_warehouse_id: defaultWarehouse.id,
        p_date: new Date().toISOString().slice(0, 10),
        p_reference: null,
        p_notes: null,
      });

      if (createError) {
        setError(createError.message || "Failed to create sales consumption.");
        setLoading(false);
        return;
      }

      const parseResult = consumptionIdSchema.safeParse(data);
      if (!parseResult.success) {
        setError("Failed to parse sales consumption id.");
        setLoading(false);
        return;
      }

      await router.replace(`/erp/inventory/sales-consumption/${parseResult.data}`);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  if (loading) {
    return (
      <>
        <div style={pageContainerStyle}>Creating sales consumption…</div>
      </>
    );
  }

  return (
    <>
      <div style={pageContainerStyle}>{error || (canWrite ? "Unable to create sales consumption." : "No access.")}</div>
    </>
  );
}
