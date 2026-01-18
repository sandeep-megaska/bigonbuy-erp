import type { CSSProperties } from "react";
import { badgeStyle, tableCellStyle, tableHeaderCellStyle, tableStyle } from "../erp/uiStyles";
import type { InventoryValuationRow } from "../../lib/erp/inventoryValuation";

type InventoryValuationTableProps = {
  rows: InventoryValuationRow[];
  showWarehouse: boolean;
  emptyMessage?: string;
};

export default function InventoryValuationTable({
  rows,
  showWarehouse,
  emptyMessage = "No inventory matches the current filters.",
}: InventoryValuationTableProps) {
  return (
    <section style={tableStyle}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={tableHeaderCellStyle}>SKU</th>
            <th style={tableHeaderCellStyle}>Title</th>
            <th style={tableHeaderCellStyle}>Size</th>
            <th style={tableHeaderCellStyle}>Color</th>
            <th style={tableHeaderCellStyle}>On Hand</th>
            <th style={tableHeaderCellStyle}>WAC</th>
            <th style={tableHeaderCellStyle}>Stock Value</th>
            {showWarehouse ? <th style={tableHeaderCellStyle}>Warehouse</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.warehouse_id}-${row.variant_id}`}>
              <td style={tableCellStyle}>{row.sku}</td>
              <td style={tableCellStyle}>{row.product_title || "—"}</td>
              <td style={tableCellStyle}>{row.size || "—"}</td>
              <td style={tableCellStyle}>{row.color || "—"}</td>
              <td style={{ ...tableCellStyle, fontWeight: 600 }}>{formatQty(row.on_hand)}</td>
              <td style={tableCellStyle}>
                {row.wac === null ? <span style={missingCostStyle}>Cost missing</span> : formatMoney(row.wac)}
              </td>
              <td style={tableCellStyle}>{row.stock_value === null ? "—" : formatMoney(row.stock_value)}</td>
              {showWarehouse ? (
                <td style={tableCellStyle}>{row.warehouse_name || "—"}</td>
              ) : null}
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={showWarehouse ? 8 : 7} style={emptyStateStyle}>
                {emptyMessage}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}

function formatQty(qty: number) {
  return Number.isFinite(qty) ? qty.toLocaleString() : "—";
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);
}

const emptyStateStyle: CSSProperties = {
  ...tableCellStyle,
  textAlign: "center",
  color: "#6b7280",
};

const missingCostStyle: CSSProperties = {
  ...badgeStyle,
  backgroundColor: "#fee2e2",
  color: "#991b1b",
};
