import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  cardStyle,
  eyebrowStyle,
  h1Style,
  h2Style,
  inputStyle,
  pageContainerStyle,
  pageHeaderStyle,
  secondaryButtonStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../components/erp/uiStyles";
import { useInventoryDashboardSummary } from "../../../../lib/erp/inventoryDashboard";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
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

type KpiCard = {
  label: string;
  value: string;
  href: string;
  helper?: string;
  tooltip?: string;
};

function pickDefaultWarehouse(warehouses: WarehouseOption[]) {
  if (warehouses.length === 0) return null;
  const codeMatch = warehouses.find(
    (warehouse) => (warehouse.code || "").trim().toLowerCase() === "jaipur"
  );
  if (codeMatch) return codeMatch;
  const nameMatch = warehouses.find((warehouse) => warehouse.name.toLowerCase().includes("jaipur"));
  return nameMatch ?? warehouses[0];
}

function buildWarehouseLink(path: string, warehouseId: string, params?: Record<string, string>) {
  if (!warehouseId) return path;
  const searchParams = new URLSearchParams({ warehouse: warehouseId, ...(params || {}) });
  return `${path}?${searchParams.toString()}`;
}

export default function InventoryDashboardPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [warehouseId, setWarehouseId] = useState("");

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

      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!ctx?.companyId) return;
    let active = true;

    (async () => {
      const { data, error: loadError } = await supabase
        .from("erp_warehouses")
        .select("id, name, code")
        .eq("company_id", ctx.companyId)
        .order("name", { ascending: true });

      if (!active) return;

      if (loadError) {
        setError(loadError.message);
        return;
      }

      setWarehouses((data || []) as WarehouseOption[]);
    })().catch((loadError: Error) => {
      if (active) setError(loadError.message || "Failed to load warehouses.");
    });

    return () => {
      active = false;
    };
  }, [ctx?.companyId]);

  useEffect(() => {
    if (warehouses.length === 0) return;
    const hasSelected = warehouses.some((warehouse) => warehouse.id === warehouseId);
    if (warehouseId && hasSelected) return;
    const defaultWarehouse = pickDefaultWarehouse(warehouses);
    setWarehouseId(defaultWarehouse?.id || "");
  }, [warehouses, warehouseId]);

  const { data: summary, loading: summaryLoading, error: summaryError } = useInventoryDashboardSummary({
    companyId: ctx?.companyId ?? null,
    warehouseId: warehouseId || null,
  });

  const displayError = error || summaryError;

  const numberFormatter = useMemo(() => new Intl.NumberFormat("en-IN"), []);
  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      }),
    []
  );

  const onHandValueLabel = summary?.kpis.on_hand_value;
  const onHandValueDisplay =
    onHandValueLabel === null || onHandValueLabel === undefined
      ? "—"
      : currencyFormatter.format(onHandValueLabel);

  const kpiCards = useMemo<KpiCard[]>(() => {
    const warehouseParam = warehouseId || "";
    return [
      {
        label: "On-hand value",
        value: onHandValueDisplay,
        helper: onHandValueLabel === null ? "Costs missing for some SKUs" : "Inventory valuation",
        tooltip: onHandValueLabel === null ? "Costs missing for some SKUs" : undefined,
        href: buildWarehouseLink("/erp/inventory/valuation", warehouseParam),
      },
      {
        label: "Low-stock SKUs",
        value: numberFormatter.format(summary?.kpis.low_stock_count ?? 0),
        helper: "Below minimum stock",
        href: buildWarehouseLink("/erp/inventory/reorder", warehouseParam, { belowMin: "1" }),
      },
      {
        label: "Pending POs",
        value: numberFormatter.format(summary?.kpis.pending_po_count ?? 0),
        helper: "Draft / approved",
        href: "/erp/inventory/purchase-orders?status=pending",
      },
      {
        label: "Stocktakes pending",
        value: numberFormatter.format(summary?.kpis.stocktake_pending_count ?? 0),
        helper: "Draft stocktakes",
        href: buildWarehouseLink("/erp/inventory/stocktakes", warehouseParam, { status: "draft" }),
      },
      {
        label: "Sales today",
        value: numberFormatter.format(summary?.kpis.sales_today_count ?? 0),
        helper: "Posted today",
        href: buildWarehouseLink("/erp/inventory/sales-consumption", warehouseParam, { date: "today" }),
      },
    ];
  }, [numberFormatter, onHandValueDisplay, onHandValueLabel, summary, warehouseId]);

  const quickLinks = useMemo(
    () => [
      { label: "Reorder", href: buildWarehouseLink("/erp/inventory/reorder", warehouseId, { belowMin: "1" }) },
      { label: "Stock on Hand", href: buildWarehouseLink("/erp/inventory/stock", warehouseId) },
      { label: "Transfers", href: "/erp/inventory/transfers" },
      { label: "Sales Consumption", href: "/erp/inventory/sales-consumption" },
      { label: "Returns/RTO", href: "/erp/inventory/returns" },
      { label: "Write-off", href: "/erp/inventory/writeoffs" },
      { label: "Stocktake", href: buildWarehouseLink("/erp/inventory/stocktakes", warehouseId) },
      { label: "Valuation", href: buildWarehouseLink("/erp/inventory/valuation", warehouseId) },
      { label: "CSV Import", href: "/erp/inventory/import" },
      { label: "Amazon Snapshot", href: "/erp/inventory/external/amazon" },
    ],
    [warehouseId]
  );

  if (loading) {
    return (
      <>
        <div style={pageContainerStyle}>Loading inventory dashboard…</div>
      </>
    );
  }

  return (
    <>
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory · Dashboard</p>
            <h1 style={h1Style}>Unified Inventory Dashboard</h1>
            <p style={subtitleStyle}>Daily snapshot of stock health and warehouse activity.</p>
          </div>
          <div style={headerActionsStyle}>
            <label style={labelStyle}>
              <span style={labelTextStyle}>Warehouse</span>
              <select
                value={warehouseId}
                onChange={(event) => setWarehouseId(event.target.value)}
                style={inputStyle}
              >
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name} {warehouse.code ? `(${warehouse.code})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <Link href={buildWarehouseLink("/erp/inventory/stock", warehouseId)} style={linkButtonStyle}>
              Go to Stock On Hand
            </Link>
          </div>
        </header>

        {displayError ? <div style={errorStyle}>{displayError}</div> : null}

        <section style={kpiGridStyle}>
          {kpiCards.map((card) => (
            <Link key={card.label} href={card.href} style={kpiCardStyle} title={card.tooltip}>
              <div style={kpiLabelStyle}>{card.label}</div>
              <div style={kpiValueStyle}>{summaryLoading ? "…" : card.value}</div>
              <div style={kpiHelperStyle}>{card.helper}</div>
            </Link>
          ))}
        </section>

        <section style={cardStyle}>
          <h2 style={h2Style}>Quick Links</h2>
          <div style={quickLinksGridStyle}>
            {quickLinks.map((link) => (
              <Link key={link.label} href={link.href} style={quickLinkCardStyle}>
                {link.label}
              </Link>
            ))}
          </div>
        </section>

        <section style={cardStyle}>
          <h2 style={h2Style}>Today Activity</h2>
          <div style={activityGridStyle}>
            <div>
              <h3 style={activityTitleStyle}>Recent GRNs</h3>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>GRN</th>
                    <th style={tableHeaderCellStyle}>Vendor</th>
                    <th style={tableHeaderCellStyle}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary?.recent.grns || []).length === 0 ? (
                    <tr>
                      <td style={tableCellStyle} colSpan={3}>
                        No GRNs yet.
                      </td>
                    </tr>
                  ) : (
                    summary?.recent.grns.map((grn) => (
                      <tr key={grn.id}>
                        <td style={tableCellStyle}>
                          <Link href="/erp/inventory/grns" style={tableLinkStyle}>
                            {grn.ref}
                          </Link>
                          <div style={mutedTextStyle}>{grn.date}</div>
                        </td>
                        <td style={tableCellStyle}>{grn.vendor_name || "—"}</td>
                        <td style={tableCellStyle}>{grn.status}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div>
              <h3 style={activityTitleStyle}>Recent Transfers</h3>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>Transfer</th>
                    <th style={tableHeaderCellStyle}>Route</th>
                    <th style={tableHeaderCellStyle}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary?.recent.transfers || []).length === 0 ? (
                    <tr>
                      <td style={tableCellStyle} colSpan={3}>
                        No transfers yet.
                      </td>
                    </tr>
                  ) : (
                    summary?.recent.transfers.map((transfer) => (
                      <tr key={transfer.id}>
                        <td style={tableCellStyle}>
                          <Link href={`/erp/inventory/transfers/${transfer.id}`} style={tableLinkStyle}>
                            {transfer.ref || "Transfer"}
                          </Link>
                          <div style={mutedTextStyle}>{transfer.date}</div>
                        </td>
                        <td style={tableCellStyle}>
                          {(transfer.from_wh || "—") + " → " + (transfer.to_wh || "—")}
                        </td>
                        <td style={tableCellStyle}>{transfer.status}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div>
              <h3 style={activityTitleStyle}>Recent Sales</h3>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>Consumption</th>
                    <th style={tableHeaderCellStyle}>Channel</th>
                    <th style={tableHeaderCellStyle}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary?.recent.sales || []).length === 0 ? (
                    <tr>
                      <td style={tableCellStyle} colSpan={3}>
                        No sales consumptions yet.
                      </td>
                    </tr>
                  ) : (
                    summary?.recent.sales.map((sale) => (
                      <tr key={sale.id}>
                        <td style={tableCellStyle}>
                          <Link href={`/erp/inventory/sales-consumption/${sale.id}`} style={tableLinkStyle}>
                            {sale.ref || "Consumption"}
                          </Link>
                          <div style={mutedTextStyle}>{sale.date}</div>
                        </td>
                        <td style={tableCellStyle}>{sale.channel_name || "—"}</td>
                        <td style={tableCellStyle}>{sale.status}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

const headerActionsStyle: CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "flex-end",
  flexWrap: "wrap",
};

const labelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 12,
  color: "#6b7280",
  fontWeight: 600,
};

const labelTextStyle: CSSProperties = {
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const linkButtonStyle: CSSProperties = {
  ...secondaryButtonStyle,
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
};

const errorStyle: CSSProperties = {
  padding: 12,
  borderRadius: 8,
  backgroundColor: "#fee2e2",
  border: "1px solid #fca5a5",
  color: "#991b1b",
  fontWeight: 600,
};

const kpiGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: 16,
};

const kpiCardStyle: CSSProperties = {
  ...cardStyle,
  textDecoration: "none",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  borderColor: "#e2e8f0",
  color: "#111827",
  transition: "transform 120ms ease, box-shadow 120ms ease",
};

const kpiLabelStyle: CSSProperties = {
  fontSize: 13,
  color: "#6b7280",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontWeight: 600,
};

const kpiValueStyle: CSSProperties = {
  fontSize: 24,
  fontWeight: 700,
  color: "#111827",
};

const kpiHelperStyle: CSSProperties = {
  fontSize: 13,
  color: "#6b7280",
};

const quickLinksGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: 12,
};

const quickLinkCardStyle: CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: "12px 14px",
  textDecoration: "none",
  color: "#111827",
  fontWeight: 600,
  backgroundColor: "#f8fafc",
};

const activityGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: 16,
};

const activityTitleStyle: CSSProperties = {
  margin: "0 0 12px",
  fontSize: 16,
  fontWeight: 700,
  color: "#111827",
};

const tableLinkStyle: CSSProperties = {
  color: "#111827",
  textDecoration: "none",
  fontWeight: 600,
};

const mutedTextStyle: CSSProperties = {
  color: "#6b7280",
  fontSize: 12,
  marginTop: 4,
};
