import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import {
  cardStyle,
  inputStyle,
  pageContainerStyle,
  secondaryButtonStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../components/erp/uiStyles";
import { downloadCsv, type CsvColumn } from "../../../../lib/erp/exportCsv";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";
import { useInventoryClosingSnapshot, type InventoryClosingSnapshotRow } from "../../../../lib/erp/financeBridge";

const formatDateInput = (value: Date) => value.toISOString().slice(0, 10);

function getDefaultAsOf() {
  const today = new Date();
  const previousMonthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
  return formatDateInput(previousMonthEnd);
}

type WarehouseOption = { id: string; name: string };

export default function InventoryClosingSnapshotPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [asOf, setAsOf] = useState(() => getDefaultAsOf());
  const [warehouseId, setWarehouseId] = useState<string>("");

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;

      setCtx(context);
      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found for this user.");
      }
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!router.isReady) return;
    if (typeof router.query.asOf === "string") {
      setAsOf(router.query.asOf);
    }
    if (typeof router.query.warehouseId === "string") {
      setWarehouseId(router.query.warehouseId);
    }
  }, [router.isReady, router.query.asOf, router.query.warehouseId]);

  useEffect(() => {
    let active = true;

    async function loadWarehouses() {
      if (!ctx?.companyId) return;

      const { data, error: loadError } = await supabase
        .from("erp_warehouses")
        .select("id, name")
        .eq("company_id", ctx.companyId)
        .order("name");

      if (!active) return;

      if (loadError) {
        setError(loadError.message || "Failed to load warehouses.");
        return;
      }

      setWarehouses((data || []) as WarehouseOption[]);
    }

    loadWarehouses();

    return () => {
      active = false;
    };
  }, [ctx?.companyId]);

  const { data, loading: dataLoading, error: dataError } = useInventoryClosingSnapshot({
    companyId: ctx?.companyId ?? null,
    asOf,
    warehouseId: warehouseId || null,
  });

  const numberFormatter = useMemo(() => new Intl.NumberFormat("en-IN"), []);
  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 2,
      }),
    []
  );

  function handleExport() {
    if (data.length === 0) return;
    const columns: CsvColumn<InventoryClosingSnapshotRow>[] = [
      { header: "Warehouse", accessor: (row) => row.warehouse_name ?? "All Warehouses" },
      { header: "On Hand Qty", accessor: (row) => `${row.on_hand_qty}` },
      { header: "Stock Value", accessor: (row) => (row.stock_value ?? "").toString() },
      { header: "Cost Coverage %", accessor: (row) => (row.cost_coverage_pct ?? "").toString() },
    ];
    downloadCsv(`inventory-closing-${asOf}.csv`, columns, data);
  }

  if (loading) {
    return (
      <>
        <div style={pageContainerStyle}>Loading inventory closing snapshot…</div>
      </>
    );
  }

  if (!ctx?.companyId) {
    return (
      <>
        <div style={pageContainerStyle}>
          <ErpPageHeader
            eyebrow="Finance Bridge"
            title="Inventory Closing Snapshot"
            description="Monthly closing snapshot by warehouse."
          />
          <p style={{ color: "#b91c1c" }}>{error || "Unable to load company context."}</p>
        </div>
      </>
    );
  }

  return (
    <>
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance Bridge"
          title="Inventory Closing Snapshot"
          description="Month-end stock on hand, value, and cost coverage by warehouse."
          rightActions={
            <Link href="/erp/finance/bridge" style={linkButtonStyle}>
              Back to Bridge
            </Link>
          }
        />

        <section style={cardStyle}>
          <div style={filterGridStyle}>
            <div>
              <label style={labelStyle}>As-of date</label>
              <input
                type="date"
                value={asOf}
                style={inputStyle}
                onChange={(event) => setAsOf(event.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>Warehouse</label>
              <select
                value={warehouseId}
                style={inputStyle}
                onChange={(event) => setWarehouseId(event.target.value)}
              >
                <option value="">All warehouses</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
              <button type="button" style={secondaryButtonStyle} onClick={handleExport} disabled={!data.length}>
                Export CSV
              </button>
            </div>
          </div>
          <p style={noteStyle}>
            Phase-1 note: the snapshot uses current on-hand balances (historical as-of dates are not yet
            tracked).
          </p>
        </section>

        <section style={cardStyle}>
          {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}
          {dataError ? <p style={{ color: "#b91c1c" }}>{dataError}</p> : null}
          {dataLoading ? <p>Loading snapshot…</p> : null}
          {!dataLoading && data.length === 0 ? (
            <p style={subtitleStyle}>No inventory balances found for the selected filters.</p>
          ) : null}

          {data.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>Warehouse</th>
                    <th style={tableHeaderCellStyle}>On Hand Qty</th>
                    <th style={tableHeaderCellStyle}>Stock Value</th>
                    <th style={tableHeaderCellStyle}>Cost Coverage</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((row) => (
                    <tr key={row.warehouse_id ?? row.warehouse_name ?? "overall"}>
                      <td style={tableCellStyle}>{row.warehouse_name ?? "All Warehouses"}</td>
                      <td style={tableCellStyle}>{numberFormatter.format(row.on_hand_qty)}</td>
                      <td style={tableCellStyle}>
                        {row.stock_value == null ? "—" : currencyFormatter.format(row.stock_value)}
                      </td>
                      <td style={tableCellStyle}>
                        {row.cost_coverage_pct == null
                          ? "—"
                          : `${numberFormatter.format(row.cost_coverage_pct)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>
    </>
  );
}

const filterGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 16,
};

const labelStyle = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  color: "#374151",
  marginBottom: 6,
};

const noteStyle = {
  marginTop: 12,
  marginBottom: 0,
  fontSize: 13,
  color: "#6b7280",
};

const linkButtonStyle = {
  ...secondaryButtonStyle,
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
};
