import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import {
  cardStyle,
  eyebrowStyle,
  h1Style,
  pageContainerStyle,
  pageHeaderStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
  inputStyle,
} from "../../../../components/erp/uiStyles";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

type WarehouseOption = {
  id: string;
  name: string;
};

type VariantOption = {
  id: string;
  sku: string;
};

type StockRow = {
  warehouse_id: string;
  variant_id: string;
  qty_on_hand: number;
};

export default function InventoryStockPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [stockRows, setStockRows] = useState<StockRow[]>([]);
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [skuQuery, setSkuQuery] = useState("");

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
        setLoading(false);
        return;
      }

      await loadStock(context.companyId, active);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  async function loadStock(companyId: string, isActive = true) {
    setError("");
    const [warehouseRes, variantRes, stockRes] = await Promise.all([
      supabase
        .from("erp_warehouses")
        .select("id, name")
        .eq("company_id", companyId)
        .order("name", { ascending: true }),
      supabase
        .from("erp_variants")
        .select("id, sku")
        .eq("company_id", companyId)
        .order("sku", { ascending: true }),
      supabase
        .from("erp_inventory_on_hand")
        .select("warehouse_id, variant_id, qty_on_hand")
        .eq("company_id", companyId),
    ]);

    if (warehouseRes.error || variantRes.error || stockRes.error) {
      if (isActive) {
        setError(
          warehouseRes.error?.message ||
            variantRes.error?.message ||
            stockRes.error?.message ||
            "Failed to load stock on hand."
        );
      }
      return;
    }

    if (isActive) {
      setWarehouses((warehouseRes.data || []) as WarehouseOption[]);
      setVariants((variantRes.data || []) as VariantOption[]);
      setStockRows((stockRes.data || []) as StockRow[]);
    }
  }

  const variantMap = useMemo(() => new Map(variants.map((v) => [v.id, v.sku])), [variants]);
  const warehouseMap = useMemo(
    () => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse.name])),
    [warehouses]
  );

  const filteredRows = stockRows
    .map((row) => ({
      ...row,
      warehouseName: warehouseMap.get(row.warehouse_id) || row.warehouse_id,
      sku: variantMap.get(row.variant_id) || row.variant_id,
    }))
    .filter((row) => (warehouseFilter ? row.warehouse_id === warehouseFilter : true))
    .filter((row) => (skuQuery ? row.sku.toLowerCase().includes(skuQuery.toLowerCase()) : true));

  if (loading) {
    return (
      <ErpShell activeModule="workspace">
        <div style={pageContainerStyle}>Loading stock on hand…</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="workspace">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory · Stock On Hand</p>
            <h1 style={h1Style}>Stock On Hand</h1>
            <p style={subtitleStyle}>Current inventory balances by SKU and warehouse.</p>
          </div>
        </header>

        {error ? <div style={errorStyle}>{error}</div> : null}

        <section style={cardStyle}>
          <div style={filterRowStyle}>
            <select
              value={warehouseFilter}
              onChange={(event) => setWarehouseFilter(event.target.value)}
              style={inputStyle}
            >
              <option value="">All warehouses</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </option>
              ))}
            </select>
            <input
              value={skuQuery}
              onChange={(event) => setSkuQuery(event.target.value)}
              placeholder="Search SKU"
              style={inputStyle}
            />
          </div>
        </section>

        <section style={tableStyle}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Warehouse</th>
                <th style={tableHeaderCellStyle}>SKU</th>
                <th style={tableHeaderCellStyle}>Qty On Hand</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, index) => (
                <tr key={`${row.warehouse_id}-${row.variant_id}-${index}`}>
                  <td style={tableCellStyle}>{row.warehouseName}</td>
                  <td style={{ ...tableCellStyle, fontWeight: 600 }}>{row.sku}</td>
                  <td style={tableCellStyle}>{row.qty_on_hand}</td>
                </tr>
              ))}
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={3} style={emptyStateStyle}>
                    No stock on hand found for the selected filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>
      </div>
    </ErpShell>
  );
}

const filterRowStyle: CSSProperties = {
  display: "flex",
  gap: 12,
  flexWrap: "wrap",
};

const errorStyle: CSSProperties = {
  padding: 12,
  borderRadius: 10,
  border: "1px solid #fecaca",
  backgroundColor: "#fef2f2",
  color: "#991b1b",
};

const emptyStateStyle: CSSProperties = {
  ...tableCellStyle,
  textAlign: "center",
  color: "#6b7280",
};
