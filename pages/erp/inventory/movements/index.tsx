import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
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
  inputStyle,
} from "../../../../components/erp/uiStyles";
import { getCompanyContext, isAdmin, requireAuthRedirectHome } from "../../../../lib/erpContext";
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

type LedgerRow = {
  id: string;
  warehouse_id: string;
  variant_id: string;
  qty: number;
  type: string;
  reason: string | null;
  ref: string | null;
  created_at: string;
};

export default function InventoryMovementsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [ledgerRows, setLedgerRows] = useState<LedgerRow[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [serverFilteredRows, setServerFilteredRows] = useState<LedgerRow[] | null>(null);
  const [serverSearchLoading, setServerSearchLoading] = useState(false);

  const [adjustWarehouseId, setAdjustWarehouseId] = useState("");
  const [adjustVariantId, setAdjustVariantId] = useState("");
  const [adjustVariantQuery, setAdjustVariantQuery] = useState("");
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustReason, setAdjustReason] = useState("Manual adjustment");

  const [fromWarehouseId, setFromWarehouseId] = useState("");
  const [toWarehouseId, setToWarehouseId] = useState("");
  const [transferVariantId, setTransferVariantId] = useState("");
  const [transferVariantQuery, setTransferVariantQuery] = useState("");
  const [transferQty, setTransferQty] = useState("");
  const [transferReason, setTransferReason] = useState("Stock transfer");

  const canWrite = useMemo(() => (ctx ? isAdmin(ctx.roleKey) : false), [ctx]);

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

      await loadMovements(context.companyId, active);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  async function loadMovements(companyId: string, isActive = true) {
    setError("");
    const [warehouseRes, productRes, variantRes, ledgerRes] = await Promise.all([
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
        .from("erp_inventory_ledger")
        .select("id, warehouse_id, variant_id, qty, type, reason, ref, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

    if (warehouseRes.error || productRes.error || variantRes.error || ledgerRes.error) {
      if (isActive) {
        setError(
          warehouseRes.error?.message ||
            productRes.error?.message ||
            variantRes.error?.message ||
            ledgerRes.error?.message ||
            "Failed to load stock movements."
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
      setLedgerRows((ledgerRes.data || []) as LedgerRow[]);
      if (!adjustWarehouseId) {
        setAdjustWarehouseId(warehouseRes.data?.[0]?.id || "");
      }
      if (!adjustVariantId) {
        setAdjustVariantId(variantRes.data?.[0]?.id || "");
      }
      if (!fromWarehouseId) {
        setFromWarehouseId(warehouseRes.data?.[0]?.id || "");
      }
      if (!toWarehouseId) {
        setToWarehouseId(warehouseRes.data?.[0]?.id || "");
      }
      if (!transferVariantId) {
        setTransferVariantId(variantRes.data?.[0]?.id || "");
      }
    }
  }

  async function submitAdjustment(event: FormEvent) {
    event.preventDefault();
    if (!ctx?.companyId) return;
    if (!canWrite) {
      setError("Only owner/admin can post stock adjustments.");
      return;
    }
    const qty = Number(adjustQty);
    if (!adjustWarehouseId || !adjustVariantId || !Number.isFinite(qty) || qty === 0) {
      setError("Select a warehouse, SKU, and non-zero quantity.");
      return;
    }

    setError("");
    const payload = {
      company_id: ctx.companyId,
      warehouse_id: adjustWarehouseId,
      variant_id: adjustVariantId,
      qty,
      type: "adjustment",
      reason: adjustReason.trim() || null,
      ref: null,
      created_by: ctx.userId,
    };

    const { error: insertError } = await supabase.from("erp_inventory_ledger").insert(payload);
    if (insertError) {
      setError(insertError.message);
      return;
    }

    setAdjustQty("");
    setAdjustReason("Manual adjustment");
    await loadMovements(ctx.companyId);
  }

  async function submitTransfer(event: FormEvent) {
    event.preventDefault();
    if (!ctx?.companyId) return;
    if (!canWrite) {
      setError("Only owner/admin can post stock transfers.");
      return;
    }
    const qty = Number(transferQty);
    if (!fromWarehouseId || !toWarehouseId || fromWarehouseId === toWarehouseId) {
      setError("Select two different warehouses for transfer.");
      return;
    }
    if (!transferVariantId || !Number.isFinite(qty) || qty <= 0) {
      setError("Enter a positive transfer quantity.");
      return;
    }

    setError("");
    const transferRef = `TR-${Date.now()}`;
    const basePayload = {
      company_id: ctx.companyId,
      variant_id: transferVariantId,
      reason: transferReason.trim() || null,
      ref: transferRef,
      created_by: ctx.userId,
    };

    const outPayload = {
      ...basePayload,
      warehouse_id: fromWarehouseId,
      qty: -Math.abs(qty),
      type: "transfer_out",
    };
    const inPayload = {
      ...basePayload,
      warehouse_id: toWarehouseId,
      qty: Math.abs(qty),
      type: "transfer_in",
    };

    const { error: insertError } = await supabase.from("erp_inventory_ledger").insert([outPayload, inPayload]);
    if (insertError) {
      setError(insertError.message);
      return;
    }

    setTransferQty("");
    setTransferReason("Stock transfer");
    await loadMovements(ctx.companyId);
  }

  const warehouseMap = useMemo(
    () => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse.name])),
    [warehouses]
  );
  const variantMap = useMemo(() => new Map(variants.map((variant) => [variant.id, variant])), [variants]);

  useEffect(() => {
    if (!ctx?.companyId) return;
    const query = searchQuery.trim();
    if (!query || ledgerRows.length <= LARGE_DATASET_THRESHOLD) {
      setServerFilteredRows(null);
      return;
    }

    let active = true;
    (async () => {
      setServerSearchLoading(true);
      const results = await searchLedgerRows(ctx.companyId, query, active);
      if (!active) return;
      setServerFilteredRows(results);
      setServerSearchLoading(false);
    })().catch((searchError) => {
      if (active) {
        setError(searchError?.message || "Failed to search stock movements.");
        setServerSearchLoading(false);
      }
    });

    return () => {
      active = false;
    };
  }, [ctx?.companyId, searchQuery, ledgerRows.length]);

  function variantMatchesSearch(variant: VariantOption, query: string) {
    const normalized = query.toLowerCase();
    return (
      variant.sku.toLowerCase().includes(normalized) ||
      (variant.product_title || "").toLowerCase().includes(normalized) ||
      (variant.color || "").toLowerCase().includes(normalized) ||
      (variant.size || "").toLowerCase().includes(normalized)
    );
  }

  function getVariantDisplay(variant?: VariantOption) {
    if (!variant) return "";
    const color = variant.color?.trim();
    const size = variant.size?.trim();
    const details = [color, size].filter(Boolean).join("/");
    const detailText = details ? ` — ${details}` : "";
    return `${variant.sku} — ${variant.product_title || "Untitled"}${detailText}`;
  }

  const filteredAdjustmentVariants = variants.filter((variant) =>
    adjustVariantQuery ? variantMatchesSearch(variant, adjustVariantQuery) : true
  );
  const filteredTransferVariants = variants.filter((variant) =>
    transferVariantQuery ? variantMatchesSearch(variant, transferVariantQuery) : true
  );

  async function searchLedgerRows(companyId: string, query: string, isActive: boolean) {
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

    const { data: ledgerMatches, error: ledgerError } = await supabase
      .from("erp_inventory_ledger")
      .select("id, warehouse_id, variant_id, qty, type, reason, ref, created_at")
      .eq("company_id", companyId)
      .in("variant_id", variantIds)
      .order("created_at", { ascending: false })
      .limit(200);

    if (ledgerError) {
      if (isActive) setError(ledgerError.message);
      return [];
    }

    return (ledgerMatches || []) as LedgerRow[];
  }

  const baseRows = serverFilteredRows ?? ledgerRows;
  const filteredRows = baseRows.filter((row) => {
    if (!searchQuery || serverFilteredRows) return true;
    const variant = variantMap.get(row.variant_id);
    if (!variant) return false;
    return variantMatchesSearch(variant, searchQuery);
  });

  if (loading) {
    return (
      <ErpShell activeModule="workspace">
        <div style={pageContainerStyle}>Loading stock movements…</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="workspace">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory · Stock Movements</p>
            <h1 style={h1Style}>Stock Movements</h1>
            <p style={subtitleStyle}>Post adjustments and transfers while tracking ledger entries.</p>
          </div>
        </header>

        {error ? <div style={errorStyle}>{error}</div> : null}

        <section style={cardStyle}>
          <div style={filterRowStyle}>
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search SKU / title / color / size"
              style={inputStyle}
            />
            {serverSearchLoading ? <span style={mutedStyle}>Searching…</span> : null}
          </div>
        </section>

        <section style={cardStyle}>
          <h2 style={sectionTitleStyle}>Stock Adjustment</h2>
          {!canWrite ? (
            <p style={mutedStyle}>Only owner/admin can post adjustments.</p>
          ) : (
            <form onSubmit={submitAdjustment} style={formGridStyle}>
              <select
                value={adjustWarehouseId}
                onChange={(event) => setAdjustWarehouseId(event.target.value)}
                style={inputStyle}
              >
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
              <input
                value={adjustVariantQuery}
                onChange={(event) => setAdjustVariantQuery(event.target.value)}
                placeholder="Filter SKUs"
                style={inputStyle}
              />
              <select
                value={adjustVariantId}
                onChange={(event) => setAdjustVariantId(event.target.value)}
                style={inputStyle}
              >
                {filteredAdjustmentVariants.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {getVariantDisplay(variant)}
                  </option>
                ))}
              </select>
              <input
                value={adjustQty}
                onChange={(event) => setAdjustQty(event.target.value)}
                placeholder="Qty (+ / -)"
                style={inputStyle}
              />
              <input
                value={adjustReason}
                onChange={(event) => setAdjustReason(event.target.value)}
                placeholder="Reason"
                style={inputStyle}
              />
              <button type="submit" style={primaryButtonStyle}>
                Post Adjustment
              </button>
            </form>
          )}
        </section>

        <section style={cardStyle}>
          <h2 style={sectionTitleStyle}>Stock Transfer</h2>
          {!canWrite ? (
            <p style={mutedStyle}>Only owner/admin can post transfers.</p>
          ) : (
            <form onSubmit={submitTransfer} style={formGridStyle}>
              <select
                value={fromWarehouseId}
                onChange={(event) => setFromWarehouseId(event.target.value)}
                style={inputStyle}
              >
                <option value="">From warehouse</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
              <select
                value={toWarehouseId}
                onChange={(event) => setToWarehouseId(event.target.value)}
                style={inputStyle}
              >
                <option value="">To warehouse</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
              <input
                value={transferVariantQuery}
                onChange={(event) => setTransferVariantQuery(event.target.value)}
                placeholder="Filter SKUs"
                style={inputStyle}
              />
              <select
                value={transferVariantId}
                onChange={(event) => setTransferVariantId(event.target.value)}
                style={inputStyle}
              >
                <option value="">Select SKU</option>
                {filteredTransferVariants.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {getVariantDisplay(variant)}
                  </option>
                ))}
              </select>
              <input
                value={transferQty}
                onChange={(event) => setTransferQty(event.target.value)}
                placeholder="Qty"
                style={inputStyle}
              />
              <input
                value={transferReason}
                onChange={(event) => setTransferReason(event.target.value)}
                placeholder="Reason"
                style={inputStyle}
              />
              <button type="submit" style={primaryButtonStyle}>
                Post Transfer
              </button>
            </form>
          )}
        </section>

        <section style={tableStyle}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Date</th>
                <th style={tableHeaderCellStyle}>Warehouse</th>
                <th style={tableHeaderCellStyle}>SKU</th>
                <th style={tableHeaderCellStyle}>Variant</th>
                <th style={tableHeaderCellStyle}>Qty</th>
                <th style={tableHeaderCellStyle}>Type</th>
                <th style={tableHeaderCellStyle}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const variant = variantMap.get(row.variant_id);
                return (
                  <tr key={row.id}>
                    <td style={tableCellStyle}>{new Date(row.created_at).toLocaleString()}</td>
                    <td style={tableCellStyle}>{warehouseMap.get(row.warehouse_id) || row.warehouse_id}</td>
                    <td style={{ ...tableCellStyle, fontWeight: 600 }}>{variant?.sku || row.variant_id}</td>
                    <td style={tableCellStyle}>{getVariantDisplay(variant) || row.variant_id}</td>
                    <td style={tableCellStyle}>{row.qty}</td>
                    <td style={tableCellStyle}>{row.type}</td>
                    <td style={tableCellStyle}>{row.reason || row.ref || "—"}</td>
                  </tr>
                );
              })}
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={7} style={emptyStateStyle}>
                    No stock movements yet.
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

const formGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 12,
  alignItems: "center",
};

const filterRowStyle: CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "center",
  flexWrap: "wrap",
};

const sectionTitleStyle: CSSProperties = {
  margin: "0 0 12px",
  fontSize: 18,
};

const mutedStyle: CSSProperties = {
  color: "#6b7280",
  fontSize: 13,
  margin: 0,
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

const LARGE_DATASET_THRESHOLD = 500;
