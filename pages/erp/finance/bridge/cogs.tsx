import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
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
import { useCogsEstimate, type CogsEstimateRow } from "../../../../lib/erp/financeBridge";

const formatDateInput = (value: Date) => value.toISOString().slice(0, 10);

function defaultMonthRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { start: formatDateInput(start), end: formatDateInput(now) };
}

type WarehouseOption = { id: string; name: string };

export default function CogsEstimatePage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [from, setFrom] = useState(() => defaultMonthRange().start);
  const [to, setTo] = useState(() => defaultMonthRange().end);
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
    if (typeof router.query.from === "string") {
      setFrom(router.query.from);
    }
    if (typeof router.query.to === "string") {
      setTo(router.query.to);
    }
    if (typeof router.query.warehouseId === "string") {
      setWarehouseId(router.query.warehouseId);
    }
  }, [router.isReady, router.query.from, router.query.to, router.query.warehouseId]);

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

  const { data, loading: dataLoading, error: dataError } = useCogsEstimate({
    companyId: ctx?.companyId ?? null,
    from,
    to,
    warehouseId: warehouseId || null,
  });

  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 2,
      }),
    []
  );

  const totalCogs = useMemo(() => {
    return data.reduce((sum, row) => sum + (row.est_cogs ?? 0), 0);
  }, [data]);

  function handleExport() {
    if (data.length === 0) return;
    const columns: CsvColumn<CogsEstimateRow>[] = [
      { header: "SKU", accessor: (row) => row.sku },
      { header: "Qty Sold", accessor: (row) => `${row.qty_sold}` },
      { header: "Unit Cost", accessor: (row) => (row.est_unit_cost ?? "").toString() },
      { header: "Est. COGS", accessor: (row) => (row.est_cogs ?? "").toString() },
      { header: "Cost Source", accessor: (row) => row.cost_source },
      { header: "Missing Cost", accessor: (row) => (row.missing_cost ? "Yes" : "No") },
    ];
    downloadCsv(`cogs-estimate-${from}-to-${to}.csv`, columns, data);
  }

  if (loading) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>Loading COGS estimate…</div>
      </ErpShell>
    );
  }

  if (!ctx?.companyId) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>
          <ErpPageHeader
            eyebrow="Finance Bridge"
            title="COGS Estimate"
            description="Estimated COGS from sales-out movements."
          />
          <p style={{ color: "#b91c1c" }}>{error || "Unable to load company context."}</p>
        </div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance Bridge"
          title="COGS Estimate"
          description="Estimated cost of goods sold from sales movements and inventory valuation."
          rightActions={
            <Link href="/erp/finance/bridge" style={linkButtonStyle}>
              Back to Bridge
            </Link>
          }
        />

        <section style={cardStyle}>
          <div style={filterGridStyle}>
            <div>
              <label style={labelStyle}>From date</label>
              <input
                type="date"
                value={from}
                style={inputStyle}
                onChange={(event) => setFrom(event.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>To date</label>
              <input
                type="date"
                value={to}
                style={inputStyle}
                onChange={(event) => setTo(event.target.value)}
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
        </section>

        <section style={cardStyle}>
          {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}
          {dataError ? <p style={{ color: "#b91c1c" }}>{dataError}</p> : null}
          {dataLoading ? <p>Loading COGS estimate…</p> : null}
          {!dataLoading && data.length === 0 ? (
            <p style={subtitleStyle}>No sales-out movements found for the selected range.</p>
          ) : null}

          {data.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>SKU</th>
                    <th style={tableHeaderCellStyle}>Qty Sold</th>
                    <th style={tableHeaderCellStyle}>Unit Cost</th>
                    <th style={tableHeaderCellStyle}>Est. COGS</th>
                    <th style={tableHeaderCellStyle}>Cost Source</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((row) => (
                    <tr
                      key={row.variant_id}
                      style={row.missing_cost ? missingRowStyle : undefined}
                    >
                      <td style={tableCellStyle}>{row.sku}</td>
                      <td style={tableCellStyle}>{row.qty_sold}</td>
                      <td style={tableCellStyle}>
                        {row.est_unit_cost == null ? "—" : currencyFormatter.format(row.est_unit_cost)}
                      </td>
                      <td style={tableCellStyle}>
                        {row.est_cogs == null ? "—" : currencyFormatter.format(row.est_cogs)}
                      </td>
                      <td style={tableCellStyle}>
                        {row.cost_source}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ ...tableCellStyle, fontWeight: 600 }}>Totals</td>
                    <td style={tableCellStyle}>—</td>
                    <td style={tableCellStyle}>—</td>
                    <td style={{ ...tableCellStyle, fontWeight: 600 }}>{currencyFormatter.format(totalCogs)}</td>
                    <td style={tableCellStyle}>—</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>
    </ErpShell>
  );
}

const filterGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: 16,
};

const labelStyle = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  color: "#374151",
  marginBottom: 6,
};

const missingRowStyle = {
  backgroundColor: "#fef2f2",
};

const linkButtonStyle = {
  ...secondaryButtonStyle,
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
};
