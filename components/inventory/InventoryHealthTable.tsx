import type { CSSProperties } from "react";
import { tableCellStyle, tableHeaderCellStyle, tableStyle } from "../erp/uiStyles";

export type InventoryHealthDisplayRow = {
  warehouse_id: string;
  variant_id: string;
  internal_sku?: string | null;
  on_hand: number;
  reserved: number;
  available: number;
  min_level?: number | null;
  shortage?: number | null;
  sku?: string | null;
  style_code?: string | null;
  product_title?: string | null;
  color?: string | null;
  size?: string | null;
  hsn?: string | null;
  warehouse_name?: string | null;
  warehouse_code?: string | null;
};

type InventoryHealthTableProps = {
  rows: InventoryHealthDisplayRow[];
  showMinLevel?: boolean;
  showShortage?: boolean;
  emptyMessage?: string;
};

export default function InventoryHealthTable({
  rows,
  showMinLevel = false,
  showShortage = false,
  emptyMessage = "No inventory health rows to display.",
}: InventoryHealthTableProps) {
  return (
    <section style={tableStyle}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={tableHeaderCellStyle}>SKU</th>
            <th style={tableHeaderCellStyle}>Style</th>
            <th style={tableHeaderCellStyle}>Title</th>
            <th style={tableHeaderCellStyle}>Size</th>
            <th style={tableHeaderCellStyle}>Color</th>
            <th style={tableHeaderCellStyle}>HSN</th>
            <th style={tableHeaderCellStyle}>On hand</th>
            <th style={tableHeaderCellStyle}>Reserved</th>
            <th style={tableHeaderCellStyle}>Available</th>
            <th style={tableHeaderCellStyle}>Warehouse</th>
            {showMinLevel ? <th style={tableHeaderCellStyle}>Min level</th> : null}
            {showShortage ? <th style={tableHeaderCellStyle}>Shortage</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.warehouse_id}-${row.variant_id}`}>
              <td style={tableCellStyle}>{row.sku || row.internal_sku || "—"}</td>
              <td style={tableCellStyle}>{row.style_code || "—"}</td>
              <td style={tableCellStyle}>{row.product_title || "—"}</td>
              <td style={tableCellStyle}>{row.size || "—"}</td>
              <td style={tableCellStyle}>{row.color || "—"}</td>
              <td style={tableCellStyle}>{row.hsn || "—"}</td>
              <td style={tableCellStyle}>{formatQty(row.on_hand)}</td>
              <td style={tableCellStyle}>{formatQty(row.reserved)}</td>
              <td style={{ ...tableCellStyle, fontWeight: 600 }}>{formatQty(row.available)}</td>
              <td style={tableCellStyle}>{row.warehouse_name || row.warehouse_code || "—"}</td>
              {showMinLevel ? (
                <td style={tableCellStyle}>{formatQty(row.min_level ?? null)}</td>
              ) : null}
              {showShortage ? <td style={tableCellStyle}>{formatQty(row.shortage ?? null)}</td> : null}
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={10 + (showMinLevel ? 1 : 0) + (showShortage ? 1 : 0)}
                style={emptyStateStyle}
              >
                {emptyMessage}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}

function formatQty(qty: number | null) {
  return Number.isFinite(qty) ? Number(qty).toLocaleString() : "—";
}

const emptyStateStyle: CSSProperties = {
  ...tableCellStyle,
  textAlign: "center",
  color: "#6b7280",
};
