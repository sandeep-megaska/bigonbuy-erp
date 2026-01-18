import type { CSSProperties } from "react";
import VariantTypeahead, { type VariantSearchResult } from "./VariantTypeahead";
import { inputStyle, secondaryButtonStyle } from "../erp/uiStyles";

export type StocktakeLine = {
  id: string;
  variant_id: string;
  counted_qty: string;
  variant: VariantSearchResult | null;
};

type StocktakeLinesEditorProps = {
  lines: StocktakeLine[];
  lineErrors?: Record<string, string>;
  disabled?: boolean;
  onAddLine: () => void;
  onRemoveLine: (id: string) => void;
  onUpdateLine: (id: string, updates: Partial<StocktakeLine>) => void;
  onVariantError?: (message: string) => void;
};

const lineGridStyle: CSSProperties = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "2.3fr 0.8fr auto",
  alignItems: "end",
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

export default function StocktakeLinesEditor({
  lines,
  lineErrors,
  disabled,
  onAddLine,
  onRemoveLine,
  onUpdateLine,
  onVariantError,
}: StocktakeLinesEditorProps) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {lines.map((line) => {
        const error = lineErrors?.[line.id];

        return (
          <div key={line.id} style={{ display: "grid", gap: 4 }}>
            <div style={lineGridStyle}>
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
                Counted Qty
                <input
                  style={inputStyle}
                  type="number"
                  min="0"
                  value={line.counted_qty}
                  onChange={(event) => onUpdateLine(line.id, { counted_qty: event.target.value })}
                  disabled={disabled}
                />
              </label>
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
