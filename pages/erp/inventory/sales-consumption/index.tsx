import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { z } from "zod";
import {
  cardStyle,
  eyebrowStyle,
  h1Style,
  pageContainerStyle,
  pageHeaderStyle,
  primaryButtonStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../components/erp/uiStyles";
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
};

type SalesChannel = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

type SalesConsumptionRow = {
  id: string;
  consumption_date: string;
  channel_id: string;
  warehouse_id: string;
  reference: string | null;
  status: string;
  created_at: string;
};

const salesChannelsSchema = z.array(
  z.object({
    id: z.string().uuid(),
    code: z.string(),
    name: z.string(),
    is_active: z.boolean(),
  })
);

export default function SalesConsumptionListPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [consumptions, setConsumptions] = useState<SalesConsumptionRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [channels, setChannels] = useState<SalesChannel[]>([]);

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

      await loadConsumptions(context.companyId, active);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  async function loadConsumptions(companyId: string, isActive = true) {
    setError(null);

    const [consumptionRes, warehouseRes, channelRes] = await Promise.all([
      supabase
        .from("erp_sales_consumptions")
        .select("id, consumption_date, channel_id, warehouse_id, reference, status, created_at")
        .eq("company_id", companyId)
        .order("consumption_date", { ascending: false }),
      supabase.from("erp_warehouses").select("id, name").eq("company_id", companyId).order("name"),
      supabase.rpc("erp_sales_channels_list"),
    ]);

    if (consumptionRes.error || warehouseRes.error || channelRes.error) {
      if (isActive) {
        setError(
          consumptionRes.error?.message ||
            warehouseRes.error?.message ||
            channelRes.error?.message ||
            "Failed to load sales consumptions."
        );
      }
      return;
    }

    const channelParse = salesChannelsSchema.safeParse(channelRes.data);
    if (!channelParse.success) {
      if (isActive) setError("Failed to parse sales channels.");
      return;
    }

    if (isActive) {
      setConsumptions((consumptionRes.data || []) as SalesConsumptionRow[]);
      setWarehouses((warehouseRes.data || []) as WarehouseOption[]);
      setChannels(channelParse.data);
    }
  }

  const warehouseMap = useMemo(
    () => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse.name])),
    [warehouses]
  );

  const channelMap = useMemo(() => new Map(channels.map((channel) => [channel.id, channel.name])), [channels]);

  if (loading) {
    return (
      <>
        <div style={pageContainerStyle}>Loading sales consumptions…</div>
      </>
    );
  }

  return (
    <>
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory · Sales Consumption</p>
            <h1 style={h1Style}>Sales Consumption</h1>
            <p style={subtitleStyle}>Post stock consumption for dispatched sales across channels.</p>
          </div>
          <div>
            <Link
              href="/erp/inventory/sales-consumption/new"
              style={{
                ...primaryButtonStyle,
                opacity: canWrite ? 1 : 0.5,
                pointerEvents: canWrite ? "auto" : "none",
              }}
            >
              New Consumption
            </Link>
          </div>
        </header>

        {error ? <div style={errorStyle}>{error}</div> : null}

        <section style={cardStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Date</th>
                <th style={tableHeaderCellStyle}>Channel</th>
                <th style={tableHeaderCellStyle}>Warehouse</th>
                <th style={tableHeaderCellStyle}>Reference</th>
                <th style={tableHeaderCellStyle}>Status</th>
                <th style={tableHeaderCellStyle}>Created</th>
                <th style={tableHeaderCellStyle}>Action</th>
              </tr>
            </thead>
            <tbody>
              {consumptions.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={7}>
                    No sales consumptions yet.
                  </td>
                </tr>
              ) : (
                consumptions.map((consumption) => (
                  <tr key={consumption.id}>
                    <td style={tableCellStyle}>{consumption.consumption_date}</td>
                    <td style={tableCellStyle}>{channelMap.get(consumption.channel_id) || "—"}</td>
                    <td style={tableCellStyle}>{warehouseMap.get(consumption.warehouse_id) || "—"}</td>
                    <td style={tableCellStyle}>{consumption.reference || "—"}</td>
                    <td style={tableCellStyle}>{consumption.status}</td>
                    <td style={tableCellStyle}>{new Date(consumption.created_at).toLocaleString()}</td>
                    <td style={tableCellStyle}>
                      <Link href={`/erp/inventory/sales-consumption/${consumption.id}`} style={primaryButtonStyle}>
                        View
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}

const errorStyle = {
  padding: "12px 16px",
  borderRadius: 10,
  backgroundColor: "#fee2e2",
  color: "#991b1b",
  fontSize: 14,
};
