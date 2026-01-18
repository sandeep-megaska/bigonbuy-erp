import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { inputStyle, secondaryButtonStyle } from "../erp/uiStyles";
import type { VariantSearchResult } from "./VariantTypeahead";

type ScanSkuAddBarProps = {
  onResolvedVariant: (variant: VariantSearchResult, scannedSku: string) => void;
  resolveVariantBySku: (sku: string) => Promise<VariantSearchResult | null>;
  placeholder?: string;
  disabled?: boolean;
  autoIncrement?: boolean;
  quantityStep?: number;
  mode?: "qty" | "counted_qty";
  showLastScan?: boolean;
};

type ScanStatus = "idle" | "ok" | "error";

const statusBadgeStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: 12,
  fontWeight: 600,
  padding: "4px 10px",
  borderRadius: 999,
};

const scanBarWrapperStyle = {
  display: "grid",
  gap: 8,
  padding: 12,
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  backgroundColor: "#f9fafb",
  marginBottom: 12,
};

export default function ScanSkuAddBar({
  onResolvedVariant,
  resolveVariantBySku,
  placeholder = "Scan SKU",
  disabled,
  autoIncrement = true,
  quantityStep = 1,
  mode = "qty",
  showLastScan = true,
}: ScanSkuAddBarProps) {
  const [inputValue, setInputValue] = useState("");
  const [lastScanStatus, setLastScanStatus] = useState<ScanStatus>("idle");
  const [lastMessage, setLastMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [autoAddEnabled, setAutoAddEnabled] = useState(autoIncrement);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const modeLabel = mode === "counted_qty" ? "counted qty" : "qty";

  const statusBadge = useMemo(() => {
    if (lastScanStatus === "ok") {
      return { label: "✅ Added", color: "#047857", background: "#ecfdf3" };
    }
    if (lastScanStatus === "error") {
      return { label: "❌ Error", color: "#b91c1c", background: "#fee2e2" };
    }
    return { label: "⏺ Ready", color: "#374151", background: "#e5e7eb" };
  }, [lastScanStatus]);

  useEffect(() => {
    if (!disabled) {
      inputRef.current?.focus();
    }
  }, [disabled]);

  const focusInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  const handleScan = useCallback(async () => {
    if (disabled || loading) return;

    const normalized = inputValue.trim().toUpperCase();
    if (!normalized) return;

    setLoading(true);
    setLastScanStatus("idle");
    setLastMessage("Looking up SKU…");

    try {
      const variant = await resolveVariantBySku(normalized);
      if (!variant) {
        setLastScanStatus("error");
        setLastMessage(`SKU not found: ${normalized}`);
        return;
      }

      if (autoAddEnabled) {
        onResolvedVariant(variant, normalized);
        setLastMessage(`Added ${variant.sku} (${modeLabel} +${quantityStep}).`);
      } else {
        setLastMessage(`SKU ready: ${variant.sku} (auto-add off).`);
      }

      setLastScanStatus("ok");
      setInputValue("");
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("SKU lookup failed", error);
      setLastScanStatus("error");
      setLastMessage("Lookup failed. Check network.");
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [
    autoAddEnabled,
    disabled,
    inputValue,
    loading,
    modeLabel,
    onResolvedVariant,
    quantityStep,
    resolveVariantBySku,
  ]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleScan();
      }
    },
    [handleScan]
  );

  return (
    <div style={scanBarWrapperStyle}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          ref={inputRef}
          style={{ ...inputStyle, flex: "1 1 240px" }}
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          aria-label="Scan SKU"
        />
        <button type="button" style={secondaryButtonStyle} onClick={focusInput} disabled={disabled}>
          Focus
        </button>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#374151" }}>
          <input
            type="checkbox"
            checked={autoAddEnabled}
            onChange={(event) => setAutoAddEnabled(event.target.checked)}
            disabled={disabled}
          />
          Auto-add {modeLabel} +{quantityStep}
        </label>
        <span style={{ ...statusBadgeStyle, color: statusBadge.color, backgroundColor: statusBadge.background }}>
          {statusBadge.label}
        </span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "#6b7280" }}>Scan and press Enter.</span>
        {showLastScan && lastMessage ? (
          <span style={{ fontSize: 12, color: lastScanStatus === "error" ? "#b91c1c" : "#111827" }}>
            {loading ? "Looking up SKU…" : lastMessage}
          </span>
        ) : null}
      </div>
    </div>
  );
}
