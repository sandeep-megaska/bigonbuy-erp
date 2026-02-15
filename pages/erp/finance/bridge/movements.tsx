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
import { useInventoryMovementSummary, type InventoryMovementSummaryRow } from "../../../../lib/erp/financeBridge";

const formatDateInput = (value: Date) => value.toISOString().slice(0, 10);

function defaultRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 6);
  return { start: formatDateInput(start), end: formatDateInput(end) };
}

type WarehouseOption = { id: string; name: string };

export default function InventoryMovementSummaryPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [from, setFrom] = useState(() => defaultRange().start);
  const [to, setTo] = useState(() => defaultRange().end);
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

  const { data, loading: dataLoading, error: dataError } = useInventoryMovementSummary({
    companyId: ctx?.companyId ?? null,
    from,
    to,
    warehouseId: warehouseId || null,
  });

  const totals = useMemo(() => {
    return data.reduce(
      (acc, row) => {
        acc.qty += row.qty_sum;
        acc.txn += row.txn_count;
        return acc;
      },
      { qty: 0, txn: 0 }
    );
  }, [data]);

  function handleExport() {
    if (data.length === 0) return;
    const columns: CsvColumn<InventoryMovementSummaryRow>[] = [
      { header: "Movement Type", accessor: (row) => row.type },
      { header: "Warehouse", accessor: (row) => row.warehouse_name ?? "Unassigned" },
      { header: "Qty Sum", accessor: (row) => `${row.qty_sum}` },
      { header: "Txn Count", accessor: (row) => `${row.txn_count}` },
    ];
    downloadCsv(`inventory-movements-${from}-to-${to}.csv`, columns, data);
  }

  if (loading) {
    return (
      <>
        <div style={pageContainerStyle}>Loading movement summary…</div>
      </>
    );
  }

  if (!ctx?.companyId) {
    return (
      <>
        <div style={pageContainerStyle}>
          <ErpPageHeader
            eyebrow="Finance Bridge"
            title="Inventory Movement Summary"
            description="Ledger totals by movement type."
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
          title="Inventory Movement Summary"
          description="Inventory ledger totals grouped by type and warehouse."
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
          {dataLoading ? <p>Loading movements…</p> : null}
          {!dataLoading && data.length === 0 ? (
            <p style={subtitleStyle}>No inventory movements found for the selected range.</p>
          ) : null}

          {data.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>Type</th>
                    <th style={tableHeaderCellStyle}>Warehouse</th>
                    <th style={tableHeaderCellStyle}>Qty Sum</th>
                    <th style={tableHeaderCellStyle}>Txn Count</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((row, index) => (
                    <tr key={`${row.type}-${row.warehouse_id ?? "all"}-${index}`}>
                      <td style={tableCellStyle}>{row.type}</td>
                      <td style={tableCellStyle}>{row.warehouse_name ?? "Unassigned"}</td>
                      <td style={tableCellStyle}>{row.qty_sum}</td>
                      <td style={tableCellStyle}>{row.txn_count}</td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ ...tableCellStyle, fontWeight: 600 }}>Totals</td>
                    <td style={tableCellStyle}>—</td>
                    <td style={{ ...tableCellStyle, fontWeight: 600 }}>{totals.qty}</td>
                    <td style={{ ...tableCellStyle, fontWeight: 600 }}>{totals.txn}</td>
                  </tr>
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

const linkButtonStyle = {
  ...secondaryButtonStyle,
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
};
