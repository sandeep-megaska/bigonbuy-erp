import type { CSSProperties } from "react";
import VariantTypeahead, { type VariantSearchResult } from "./VariantTypeahead";
import { inputStyle, secondaryButtonStyle } from "../erp/uiStyles";

export type InventoryLine = {
  id: string;
  variant_id: string;
  qty: string;
  variant: VariantSearchResult | null;
  condition?: string;
};

type InventoryLinesEditorProps = {
  lines: InventoryLine[];
  lineErrors?: Record<string, string>;
  disabled?: boolean;
  showCondition?: boolean;
  onAddLine: () => void;
  onRemoveLine: (id: string) => void;
  onUpdateLine: (id: string, updates: Partial<InventoryLine>) => void;
  onVariantError?: (message: string) => void;
};

const lineGridStyle: CSSProperties = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "2.3fr 0.8fr auto",
  alignItems: "end",
};

const lineGridWithConditionStyle: CSSProperties = {
  ...lineGridStyle,
  gridTemplateColumns: "2fr 0.8fr 0.8fr auto",
};

const metaRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  fontSize: 12,
  color: "#4b5563",
};

const errorTextStyle: CSSProperties = {
  color: "#b91c1c",
  fontSize: 12,
  marginTop: 6,
};

export default function InventoryLinesEditor({
  lines,
  lineErrors,
  disabled,
  showCondition,
  onAddLine,
  onRemoveLine,
  onUpdateLine,
  onVariantError,
}: InventoryLinesEditorProps) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {lines.map((line) => {
        const error = lineErrors?.[line.id];
        const gridStyle = showCondition ? lineGridWithConditionStyle : lineGridStyle;

        return (
          <div key={line.id} style={{ display: "grid", gap: 4 }}>
            <div style={gridStyle}>
              <label style={{ display: "grid", gap: 6 }}>
                SKU
                <VariantTypeahead
                  value={line.variant}
                  onSelect={(variant) =>
                    onUpdateLine(line.id, {
                      variant_id: variant?.variant_id || "",
                      variant,
                    })
                  }
                  onError={onVariantError}
                  disabled={disabled}
                />
                <div style={metaRowStyle}>
                  <span>Style: {line.variant?.style_code || "—"}</span>
                  <span>HSN: {line.variant?.hsn_code || "—"}</span>
                  <span>Item: {line.variant?.title || "—"}</span>
                  <span>Size: {line.variant?.size || "—"}</span>
                  <span>Color: {line.variant?.color || "—"}</span>
                </div>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                Qty
                <input
                  style={inputStyle}
                  type="number"
                  min="1"
                  value={line.qty}
                  onChange={(event) => onUpdateLine(line.id, { qty: event.target.value })}
                  disabled={disabled}
                />
              </label>
              {showCondition ? (
                <label style={{ display: "grid", gap: 6 }}>
                  Condition
                  <select
                    style={inputStyle}
                    value={line.condition ?? ""}
                    onChange={(event) => onUpdateLine(line.id, { condition: event.target.value })}
                    disabled={disabled}
                  >
                    <option value="">Select</option>
                    <option value="good">Good</option>
                    <option value="damaged">Damaged</option>
                  </select>
                </label>
              ) : null}
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => onRemoveLine(line.id)}
                disabled={disabled || lines.length === 1}
              >
                Remove
              </button>
            </div>
            {error ? <div style={errorTextStyle}>{error}</div> : null}
          </div>
        );
      })}
      <div>
        <button type="button" style={secondaryButtonStyle} onClick={onAddLine} disabled={disabled}>
          Add Line
        </button>
      </div>
    </div>
  );
}
