import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { badgeStyle, inputStyle, tableCellStyle, tableHeaderCellStyle, tableStyle } from "../erp/uiStyles";

export type InventoryHealthDisplayRow = {
  warehouse_id: string;
  variant_id: string;
  internal_sku?: string | null;
  on_hand: number;
  reserved: number;
  available: number;
  min_level?: number | null;
  shortage?: number | null;
  status?: "ok" | "low" | "negative";
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
  showStatus?: boolean;
  minLevelEditable?: boolean;
  onMinLevelCommit?: (row: InventoryHealthDisplayRow, nextValue: number) => Promise<void> | void;
  emptyMessage?: string;
};

export default function InventoryHealthTable({
  rows,
  showMinLevel = false,
  showShortage = false,
  showStatus = true,
  minLevelEditable = false,
  onMinLevelCommit,
  emptyMessage = "No inventory health rows to display.",
}: InventoryHealthTableProps) {
  const rowKeys = useMemo(() => rows.map((row) => getRowKey(row)), [rows]);
  const [minLevelInputs, setMinLevelInputs] = useState<Record<string, number>>({});
  const [savingKeys, setSavingKeys] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setMinLevelInputs((prev) => {
      const next = { ...prev };
      rows.forEach((row) => {
        const key = getRowKey(row);
        if (next[key] === undefined) {
          next[key] = Number(row.min_level ?? 0);
        }
      });
      return next;
    });
  }, [rowKeys, rows]);

  async function commitMinLevel(row: InventoryHealthDisplayRow, key: string) {
    if (!onMinLevelCommit) return;
    const nextValue = Number(minLevelInputs[key] ?? 0);
    if (Number(row.min_level ?? 0) === nextValue) {
      return;
    }
    setSavingKeys((prev) => ({ ...prev, [key]: true }));
    try {
      await onMinLevelCommit(row, nextValue);
    } finally {
      setSavingKeys((prev) => ({ ...prev, [key]: false }));
    }
  }

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
            {showStatus ? <th style={tableHeaderCellStyle}>Status</th> : null}
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
                <td style={tableCellStyle}>
                  {minLevelEditable ? (
                    <input
                      type="number"
                      min={0}
                      value={minLevelInputs[getRowKey(row)] ?? 0}
                      onChange={(event) =>
                        setMinLevelInputs((prev) => ({
                          ...prev,
                          [getRowKey(row)]: Math.max(0, Number(event.target.value || 0)),
                        }))
                      }
                      onBlur={() => commitMinLevel(row, getRowKey(row))}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.currentTarget.blur();
                        }
                      }}
                      style={minLevelInputStyle}
                      disabled={savingKeys[getRowKey(row)]}
                    />
                  ) : (
                    formatQty(row.min_level ?? null)
                  )}
                </td>
              ) : null}
              {showShortage ? <td style={tableCellStyle}>{formatQty(row.shortage ?? null)}</td> : null}
              {showStatus ? (
                <td style={tableCellStyle}>
                  <span style={{ ...badgeStyle, ...statusBadgeStyle(row.status) }}>
                    {formatStatus(row.status)}
                  </span>
                </td>
              ) : null}
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={10 + (showMinLevel ? 1 : 0) + (showShortage ? 1 : 0) + (showStatus ? 1 : 0)}
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

function formatStatus(status?: "ok" | "low" | "negative") {
  if (status === "negative") return "Negative";
  if (status === "low") return "Low";
  return "OK";
}

function statusBadgeStyle(status?: "ok" | "low" | "negative"): CSSProperties {
  if (status === "negative") {
    return { backgroundColor: "#fee2e2", color: "#b91c1c" };
  }
  if (status === "low") {
    return { backgroundColor: "#fef9c3", color: "#92400e" };
  }
  return { backgroundColor: "#dcfce7", color: "#166534" };
}

function getRowKey(row: InventoryHealthDisplayRow) {
  return `${row.variant_id}-${row.warehouse_id || "all"}`;
}

const emptyStateStyle: CSSProperties = {
  ...tableCellStyle,
  textAlign: "center",
  color: "#6b7280",
};

const minLevelInputStyle: CSSProperties = {
  ...inputStyle,
  padding: "6px 8px",
  width: 100,
};
