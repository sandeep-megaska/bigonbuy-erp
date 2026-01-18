import type { CSSProperties } from "react";
import {
  secondaryButtonStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../erp/uiStyles";
import type { StockOnHandRow } from "../../lib/erp/inventoryStock";

type StockOnHandTableProps = {
  rows: StockOnHandRow[];
  showWarehouse: boolean;
  onMovements: (row: StockOnHandRow) => void;
  emptyMessage?: string;
};

export default function StockOnHandTable({
  rows,
  showWarehouse,
  onMovements,
  emptyMessage = "No stock matches the current filters.",
}: StockOnHandTableProps) {
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
            <th style={tableHeaderCellStyle}>Qty</th>
            {showWarehouse ? <th style={tableHeaderCellStyle}>Warehouse</th> : null}
            <th style={tableHeaderCellStyle}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.warehouse_id}-${row.variant_id}`}>
              <td style={tableCellStyle}>{row.sku}</td>
              <td style={tableCellStyle}>{row.style_code || "—"}</td>
              <td style={tableCellStyle}>{row.product_title || "—"}</td>
              <td style={tableCellStyle}>{row.size || "—"}</td>
              <td style={tableCellStyle}>{row.color || "—"}</td>
              <td style={tableCellStyle}>{row.hsn || "—"}</td>
              <td style={{ ...tableCellStyle, fontWeight: 600 }}>{formatQty(row.qty)}</td>
              {showWarehouse ? (
                <td style={tableCellStyle}>{row.warehouse_name || row.warehouse_code || "—"}</td>
              ) : null}
              <td style={{ ...tableCellStyle, textAlign: "right" }}>
                <button type="button" style={smallButtonStyle} onClick={() => onMovements(row)}>
                  Movements
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={showWarehouse ? 9 : 8} style={emptyStateStyle}>
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

const smallButtonStyle: CSSProperties = {
  ...secondaryButtonStyle,
  padding: "6px 10px",
  fontSize: 12,
};

const emptyStateStyle: CSSProperties = {
  ...tableCellStyle,
  textAlign: "center",
  color: "#6b7280",
};
