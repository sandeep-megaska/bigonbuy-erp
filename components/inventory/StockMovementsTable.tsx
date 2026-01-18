import type { CSSProperties } from "react";
import { tableCellStyle, tableHeaderCellStyle, tableStyle } from "../erp/uiStyles";
import type { StockMovementsRow } from "../../lib/erp/inventoryStock";

type StockMovementsTableProps = {
  rows: StockMovementsRow[];
  emptyMessage?: string;
};

export default function StockMovementsTable({
  rows,
  emptyMessage = "No stock movements found.",
}: StockMovementsTableProps) {
  return (
    <section style={tableStyle}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={tableHeaderCellStyle}>Date/Time</th>
            <th style={tableHeaderCellStyle}>Source Type</th>
            <th style={tableHeaderCellStyle}>Reference</th>
            <th style={tableHeaderCellStyle}>Qty Delta</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td style={tableCellStyle}>{formatDateTime(row.created_at)}</td>
              <td style={tableCellStyle}>{row.source_type}</td>
              <td style={tableCellStyle}>{row.reference || row.reason || "—"}</td>
              <td style={{ ...tableCellStyle, fontWeight: 600, color: qtyColor(row.qty_delta) }}>
                {formatQtyDelta(row.qty_delta)}
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} style={emptyStateStyle}>
                {emptyMessage}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatQtyDelta(qty: number) {
  const formatted = Number.isFinite(qty) ? qty.toLocaleString() : "—";
  return qty > 0 ? `+${formatted}` : formatted;
}

function qtyColor(qty: number) {
  if (qty > 0) return "#047857";
  if (qty < 0) return "#b91c1c";
  return "#111827";
}

const emptyStateStyle: CSSProperties = {
  ...tableCellStyle,
  textAlign: "center",
  color: "#6b7280",
};
