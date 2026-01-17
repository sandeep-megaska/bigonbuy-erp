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

  const [adjustWarehouseId, setAdjustWarehouseId] = useState("");
  const [adjustVariantId, setAdjustVariantId] = useState("");
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustReason, setAdjustReason] = useState("Manual adjustment");

  const [fromWarehouseId, setFromWarehouseId] = useState("");
  const [toWarehouseId, setToWarehouseId] = useState("");
  const [transferVariantId, setTransferVariantId] = useState("");
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
    const [warehouseRes, variantRes, ledgerRes] = await Promise.all([
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
        .from("erp_inventory_ledger")
        .select("id, warehouse_id, variant_id, qty, type, reason, ref, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

    if (warehouseRes.error || variantRes.error || ledgerRes.error) {
      if (isActive) {
        setError(
          warehouseRes.error?.message ||
            variantRes.error?.message ||
            ledgerRes.error?.message ||
            "Failed to load stock movements."
        );
      }
      return;
    }

    if (isActive) {
      setWarehouses((warehouseRes.data || []) as WarehouseOption[]);
      setVariants((variantRes.data || []) as VariantOption[]);
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
  const variantMap = useMemo(() => new Map(variants.map((variant) => [variant.id, variant.sku])), [variants]);

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
              <select
                value={adjustVariantId}
                onChange={(event) => setAdjustVariantId(event.target.value)}
                style={inputStyle}
              >
                {variants.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.sku}
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
              <select
                value={transferVariantId}
                onChange={(event) => setTransferVariantId(event.target.value)}
                style={inputStyle}
              >
                <option value="">Select SKU</option>
                {variants.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.sku}
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
                <th style={tableHeaderCellStyle}>Qty</th>
                <th style={tableHeaderCellStyle}>Type</th>
                <th style={tableHeaderCellStyle}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {ledgerRows.map((row) => (
                <tr key={row.id}>
                  <td style={tableCellStyle}>{new Date(row.created_at).toLocaleString()}</td>
                  <td style={tableCellStyle}>{warehouseMap.get(row.warehouse_id) || row.warehouse_id}</td>
                  <td style={{ ...tableCellStyle, fontWeight: 600 }}>
                    {variantMap.get(row.variant_id) || row.variant_id}
                  </td>
                  <td style={tableCellStyle}>{row.qty}</td>
                  <td style={tableCellStyle}>{row.type}</td>
                  <td style={tableCellStyle}>{row.reason || row.ref || "—"}</td>
                </tr>
              ))}
              {ledgerRows.length === 0 ? (
                <tr>
                  <td colSpan={6} style={emptyStateStyle}>
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
