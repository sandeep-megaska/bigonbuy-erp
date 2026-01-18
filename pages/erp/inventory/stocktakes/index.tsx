import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
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

type StocktakeRow = {
  id: string;
  stocktake_date: string;
  reference: string | null;
  warehouse_id: string;
  status: string;
};

export default function StocktakesListPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stocktakes, setStocktakes] = useState<StocktakeRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);

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

      await loadStocktakes(context.companyId, active);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  async function loadStocktakes(companyId: string, isActive = true) {
    setError(null);

    const [stocktakeRes, warehouseRes] = await Promise.all([
      supabase
        .from("erp_stocktakes")
        .select("id, stocktake_date, reference, warehouse_id, status")
        .eq("company_id", companyId)
        .order("stocktake_date", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase.from("erp_warehouses").select("id, name").eq("company_id", companyId).order("name"),
    ]);

    if (stocktakeRes.error || warehouseRes.error) {
      if (isActive) {
        setError(stocktakeRes.error?.message || warehouseRes.error?.message || "Failed to load stocktakes.");
      }
      return;
    }

    if (isActive) {
      setStocktakes((stocktakeRes.data || []) as StocktakeRow[]);
      setWarehouses((warehouseRes.data || []) as WarehouseOption[]);
    }
  }

  const warehouseMap = useMemo(
    () => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse.name])),
    [warehouses]
  );

  if (loading) {
    return (
      <ErpShell activeModule="workspace">
        <div style={pageContainerStyle}>Loading stocktakes…</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="workspace">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory · Stocktakes</p>
            <h1 style={h1Style}>Stocktakes</h1>
            <p style={subtitleStyle}>Capture periodic counts and post adjustments to the ledger.</p>
          </div>
          <div>
            <Link
              href="/erp/inventory/stocktakes/new"
              style={{
                ...primaryButtonStyle,
                opacity: canWrite ? 1 : 0.5,
                pointerEvents: canWrite ? "auto" : "none",
              }}
            >
              New Stocktake
            </Link>
          </div>
        </header>

        {error ? <div style={errorStyle}>{error}</div> : null}

        <section style={cardStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Date</th>
                <th style={tableHeaderCellStyle}>Reference</th>
                <th style={tableHeaderCellStyle}>Warehouse</th>
                <th style={tableHeaderCellStyle}>Status</th>
                <th style={tableHeaderCellStyle}>Action</th>
              </tr>
            </thead>
            <tbody>
              {stocktakes.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={5}>
                    No stocktakes yet.
                  </td>
                </tr>
              ) : (
                stocktakes.map((stocktake) => (
                  <tr key={stocktake.id}>
                    <td style={tableCellStyle}>{stocktake.stocktake_date}</td>
                    <td style={tableCellStyle}>{stocktake.reference || "—"}</td>
                    <td style={tableCellStyle}>{warehouseMap.get(stocktake.warehouse_id) || "—"}</td>
                    <td style={tableCellStyle}>{stocktake.status}</td>
                    <td style={tableCellStyle}>
                      <Link href={`/erp/inventory/stocktakes/${stocktake.id}`} style={primaryButtonStyle}>
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
    </ErpShell>
  );
}

const errorStyle = {
  padding: "12px 16px",
  borderRadius: 10,
  backgroundColor: "#fee2e2",
  color: "#991b1b",
  marginBottom: 16,
};
