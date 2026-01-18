import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { inputStyle } from "../uiStyles";
import { supabase } from "../../../lib/supabaseClient";

export type VariantTypeaheadValue = {
  variant_id: string;
  sku: string;
  style_code?: string | null;
  title?: string | null;
  color?: string | null;
  size?: string | null;
};

type VariantTypeaheadProps = {
  companyId: string;
  value?: VariantTypeaheadValue | null;
  onChange: (value: VariantTypeaheadValue | null) => void;
  placeholder?: string;
  disabled?: boolean;
};

const dropdownStyle: CSSProperties = {
  position: "absolute",
  zIndex: 50,
  top: "calc(100% + 6px)",
  left: 0,
  right: 0,
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  backgroundColor: "#fff",
  boxShadow: "0 12px 24px rgba(15, 23, 42, 0.12)",
  maxHeight: 280,
  overflowY: "auto",
  padding: 6,
};

const dropdownItemStyle: CSSProperties = {
  borderRadius: 8,
  padding: "8px 10px",
  cursor: "pointer",
  border: "1px solid transparent",
};

export default function VariantTypeahead({
  companyId,
  value,
  onChange,
  placeholder,
  disabled = false,
}: VariantTypeaheadProps) {
  const [inputValue, setInputValue] = useState(value?.sku ?? "");
  const [options, setOptions] = useState<VariantTypeaheadValue[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!isDirty) {
      setInputValue(value?.sku ?? "");
    }
  }, [value?.variant_id, value?.sku, isDirty]);

  const searchValue = inputValue.trim();

  useEffect(() => {
    if (!companyId) return;
    if (!searchValue || (!isDirty && value?.sku === searchValue)) {
      setOptions([]);
      setOpen(false);
      setLoading(false);
      setError("");
      return;
    }

    const currentRequestId = ++requestIdRef.current;
    setLoading(true);
    setError("");

    const timeout = setTimeout(async () => {
      const { data, error: queryError } = await supabase
        .from("erp_inventory_variant_search_v")
        .select("variant_id, sku, style_code, title, color, size")
        .eq("company_id", companyId)
        .or(`sku.ilike.%${searchValue}%,style_code.ilike.%${searchValue}%,title.ilike.%${searchValue}%`)
        .limit(20);

      if (requestIdRef.current !== currentRequestId) return;

      if (queryError) {
        setOptions([]);
        setError(queryError.message);
        setLoading(false);
        setOpen(true);
        return;
      }

      const sorted = sortVariants((data || []) as VariantTypeaheadValue[], searchValue);
      setOptions(sorted);
      setLoading(false);
      setOpen(true);
    }, 250);

    return () => clearTimeout(timeout);
  }, [companyId, isDirty, searchValue, value?.sku]);

  const helperText = useMemo(() => {
    if (!value) return "";
    const detail = [value.style_code, value.title].filter(Boolean).join(" — ");
    const variantDetail = [value.color, value.size].filter(Boolean).join(" / ");
    return [detail, variantDetail].filter(Boolean).join(" · ");
  }, [value]);

  const handleSelect = (option: VariantTypeaheadValue) => {
    setInputValue(option.sku);
    setIsDirty(false);
    setOpen(false);
    setOptions([]);
    onChange(option);
  };

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <input
        style={{ ...inputStyle, width: "100%" }}
        value={inputValue}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => {
          const nextValue = event.target.value;
          setInputValue(nextValue);
          setIsDirty(true);
          setOpen(true);
          if (value?.variant_id) {
            onChange(null);
          }
        }}
        onFocus={() => {
          if (options.length > 0) setOpen(true);
        }}
        onBlur={() => {
          setTimeout(() => setOpen(false), 120);
        }}
      />
      {helperText ? <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>{helperText}</div> : null}
      {open && (loading || options.length > 0 || error || searchValue) ? (
        <div style={dropdownStyle}>
          {loading ? (
            <div style={{ padding: "8px 10px", color: "#6b7280", fontSize: 13 }}>Searching…</div>
          ) : null}
          {!loading && options.length === 0 ? (
            <div style={{ padding: "8px 10px", color: "#6b7280", fontSize: 13 }}>No matches found.</div>
          ) : null}
          {options.map((option) => {
            const detail = [option.color, option.size].filter(Boolean).join(" / ");
            const subtitle = [option.style_code, option.title].filter(Boolean).join(" — ");
            return (
              <div
                key={option.variant_id}
                style={dropdownItemStyle}
                role="button"
                tabIndex={-1}
                onMouseDown={(event) => {
                  event.preventDefault();
                  handleSelect(option);
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.backgroundColor = "#f8fafc";
                  event.currentTarget.style.borderColor = "#e5e7eb";
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.backgroundColor = "transparent";
                  event.currentTarget.style.borderColor = "transparent";
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontWeight: 600 }}>{option.sku}</span>
                  {detail ? <span style={{ fontSize: 12, color: "#6b7280" }}>{detail}</span> : null}
                </div>
                {subtitle ? <div style={{ fontSize: 12, color: "#6b7280" }}>{subtitle}</div> : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {error ? <div style={{ marginTop: 6, fontSize: 12, color: "#b91c1c" }}>{error}</div> : null}
    </div>
  );
}

function sortVariants(options: VariantTypeaheadValue[], query: string) {
  const normalizedQuery = query.toLowerCase();
  const score = (option: VariantTypeaheadValue) => {
    const sku = option.sku.toLowerCase();
    const style = (option.style_code || "").toLowerCase();
    const title = (option.title || "").toLowerCase();

    if (sku === normalizedQuery) return 0;
    if (sku.startsWith(normalizedQuery)) return 1;
    if (style === normalizedQuery) return 2;
    if (style.startsWith(normalizedQuery)) return 3;
    if (sku.includes(normalizedQuery) || style.includes(normalizedQuery) || title.includes(normalizedQuery)) return 4;
    return 5;
  };

  return [...options].sort((a, b) => {
    const scoreA = score(a);
    const scoreB = score(b);
    if (scoreA !== scoreB) return scoreA - scoreB;
    return a.sku.localeCompare(b.sku);
  });
}
