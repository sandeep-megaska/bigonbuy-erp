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
  size: string | null;
  color: string | null;
  product_id: string;
  product_title: string;
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
  const [serverFilteredRows, setServerFilteredRows] = useState<StockRow[] | null>(null);
  const [serverSearchLoading, setServerSearchLoading] = useState(false);

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
    const [warehouseRes, productRes, variantRes, stockRes] = await Promise.all([
      supabase
        .from("erp_warehouses")
        .select("id, name")
        .eq("company_id", companyId)
        .order("name", { ascending: true }),
      supabase
        .from("erp_products")
        .select("id, title")
        .eq("company_id", companyId),
      supabase
        .from("erp_variants")
        .select("id, sku, size, color, product_id")
        .eq("company_id", companyId)
        .order("sku", { ascending: true }),
      supabase
        .from("erp_inventory_on_hand")
        .select("warehouse_id, variant_id, qty_on_hand")
        .eq("company_id", companyId),
    ]);

    if (warehouseRes.error || productRes.error || variantRes.error || stockRes.error) {
      if (isActive) {
        setError(
          warehouseRes.error?.message ||
            productRes.error?.message ||
            variantRes.error?.message ||
            stockRes.error?.message ||
            "Failed to load stock on hand."
        );
      }
      return;
    }

    if (isActive) {
      const productMap = new Map((productRes.data || []).map((product) => [product.id, product.title]));
      const variantList = (variantRes.data || []).map((variant) => ({
        ...(variant as any),
        product_title: productMap.get((variant as any).product_id) || "",
      })) as VariantOption[];
      setWarehouses((warehouseRes.data || []) as WarehouseOption[]);
      setVariants(variantList);
      setStockRows((stockRes.data || []) as StockRow[]);
    }
  }

  const variantMap = useMemo(() => new Map(variants.map((variant) => [variant.id, variant])), [variants]);
  const warehouseMap = useMemo(
    () => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse.name])),
    [warehouses]
  );

  useEffect(() => {
    if (!ctx?.companyId) return;
    const query = skuQuery.trim();
    if (!query || stockRows.length <= LARGE_DATASET_THRESHOLD) {
      setServerFilteredRows(null);
      return;
    }

    let active = true;
    (async () => {
      setServerSearchLoading(true);
      const results = await searchStockRows(ctx.companyId, query, warehouseFilter, active);
      if (!active) return;
      setServerFilteredRows(results);
      setServerSearchLoading(false);
    })().catch((searchError) => {
      if (active) {
        setError(searchError?.message || "Failed to search stock on hand.");
        setServerSearchLoading(false);
      }
    });

    return () => {
      active = false;
    };
  }, [ctx?.companyId, skuQuery, warehouseFilter, stockRows.length]);

  function variantMatchesSearch(variant: VariantOption, query: string) {
    const normalized = query.toLowerCase();
    return (
      variant.sku.toLowerCase().includes(normalized) ||
      (variant.product_title || "").toLowerCase().includes(normalized) ||
      (variant.color || "").toLowerCase().includes(normalized) ||
      (variant.size || "").toLowerCase().includes(normalized)
    );
  }

  async function searchStockRows(
    companyId: string,
    query: string,
    warehouseId: string,
    isActive: boolean
  ) {
    setError("");
    const trimmed = query.trim();
    if (!trimmed) return [];

    const { data: productMatches, error: productError } = await supabase
      .from("erp_products")
      .select("id")
      .eq("company_id", companyId)
      .ilike("title", `%${trimmed}%`);

    if (productError) {
      if (isActive) setError(productError.message);
      return [];
    }

    const productIds = (productMatches || []).map((product) => product.id);
    const likeQuery = `%${trimmed}%`;
    const orFilters = [
      `sku.ilike.${likeQuery}`,
      `color.ilike.${likeQuery}`,
      `size.ilike.${likeQuery}`,
    ];
    if (productIds.length) {
      orFilters.push(`product_id.in.(${productIds.join(",")})`);
    }

    const { data: variantMatches, error: variantError } = await supabase
      .from("erp_variants")
      .select("id")
      .eq("company_id", companyId)
      .or(orFilters.join(","));

    if (variantError) {
      if (isActive) setError(variantError.message);
      return [];
    }

    const variantIds = (variantMatches || []).map((variant) => variant.id);
    if (variantIds.length === 0) return [];

    let stockQuery = supabase
      .from("erp_inventory_on_hand")
      .select("warehouse_id, variant_id, qty_on_hand")
      .eq("company_id", companyId)
      .in("variant_id", variantIds);

    if (warehouseId) {
      stockQuery = stockQuery.eq("warehouse_id", warehouseId);
    }

    const { data: stockMatches, error: stockError } = await stockQuery;
    if (stockError) {
      if (isActive) setError(stockError.message);
      return [];
    }

    return (stockMatches || []) as StockRow[];
  }

  const baseRows = serverFilteredRows ?? stockRows;

  const filteredRows = baseRows
    .map((row) => ({
      variant: variantMap.get(row.variant_id),
      ...row,
      warehouseName: warehouseMap.get(row.warehouse_id) || row.warehouse_id,
      sku: variantMap.get(row.variant_id)?.sku || row.variant_id,
      productTitle: variantMap.get(row.variant_id)?.product_title || "",
      size: variantMap.get(row.variant_id)?.size || "",
      color: variantMap.get(row.variant_id)?.color || "",
    }))
    .filter((row) => (warehouseFilter ? row.warehouse_id === warehouseFilter : true))
    .filter((row) => {
      if (!skuQuery || serverFilteredRows) return true;
      if (!row.variant) return row.sku.toLowerCase().includes(skuQuery.toLowerCase());
      return variantMatchesSearch(row.variant, skuQuery);
    });

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
              placeholder="Search SKU / title / color / size"
              style={inputStyle}
            />
            {serverSearchLoading ? <span style={mutedStyle}>Searching…</span> : null}
          </div>
        </section>

        <section style={tableStyle}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>SKU</th>
                <th style={tableHeaderCellStyle}>Product title</th>
                <th style={tableHeaderCellStyle}>Size</th>
                <th style={tableHeaderCellStyle}>Color</th>
                <th style={tableHeaderCellStyle}>Warehouse</th>
                <th style={tableHeaderCellStyle}>Qty On Hand</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, index) => (
                <tr key={`${row.warehouse_id}-${row.variant_id}-${index}`}>
                  <td style={{ ...tableCellStyle, fontWeight: 600 }}>{row.sku}</td>
                  <td style={tableCellStyle}>{row.productTitle || "—"}</td>
                  <td style={tableCellStyle}>{row.size || "—"}</td>
                  <td style={tableCellStyle}>{row.color || "—"}</td>
                  <td style={tableCellStyle}>{row.warehouseName}</td>
                  <td style={tableCellStyle}>{row.qty_on_hand}</td>
                </tr>
              ))}
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={6} style={emptyStateStyle}>
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

const mutedStyle: CSSProperties = {
  color: "#6b7280",
  fontSize: 12,
};

const LARGE_DATASET_THRESHOLD = 500;

const emptyStateStyle: CSSProperties = {
  ...tableCellStyle,
  textAlign: "center",
  color: "#6b7280",
};
