import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { supabase } from "../../lib/supabaseClient";
import { badgeStyle, inputStyle } from "../erp/uiStyles";

export type VariantSearchResult = {
  variant_id: string;
  sku: string;
  size: string | null;
  color: string | null;
  product_id: string;
  style_code: string | null;
  title: string | null;
  hsn_code: string | null;
};

type VariantTypeaheadProps = {
  value?: VariantSearchResult | null;
  onSelect: (variant: VariantSearchResult | null) => void;
  disabled?: boolean;
  placeholder?: string;
  onError?: (message: string) => void;
};

const pillStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  backgroundColor: "#eef2ff",
  color: "#3730a3",
  borderRadius: 999,
  padding: "4px 10px",
  fontSize: 12,
  fontWeight: 600,
};

const pillButtonStyle = {
  border: "none",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
};

const typeaheadWrapperStyle = {
  position: "relative" as const,
  width: "100%",
};

const inputWrapperStyle = {
  ...inputStyle,
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap" as const,
  padding: "6px 10px",
};

const inputFieldStyle = {
  border: "none",
  outline: "none",
  fontSize: 14,
  flex: 1,
  minWidth: 120,
};

const dropdownStyle = {
  position: "absolute" as const,
  top: "100%",
  left: 0,
  right: 0,
  marginTop: 6,
  backgroundColor: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  boxShadow: "0 12px 24px rgba(15, 23, 42, 0.12)",
  zIndex: 30,
  maxHeight: 320,
  overflowY: "auto" as const,
};

const resultRowStyle = {
  padding: "10px 12px",
  display: "grid",
  gap: 6,
  cursor: "pointer",
};

const resultSkuStyle = {
  fontWeight: 700,
  color: "#111827",
};

const resultMetaStyle = {
  fontSize: 12,
  color: "#6b7280",
};

const chipStyle = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  borderRadius: 999,
  backgroundColor: "#f1f5f9",
  color: "#0f172a",
  fontSize: 11,
  fontWeight: 600,
};

const hsnBadgeStyle = {
  ...badgeStyle,
  padding: "2px 8px",
  fontSize: 11,
};

const emptyStateStyle = {
  padding: "12px 14px",
  fontSize: 12,
  color: "#6b7280",
};

export default function VariantTypeahead({
  value,
  onSelect,
  disabled,
  placeholder = "Search SKU, style, or title",
  onError,
}: VariantTypeaheadProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VariantSearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const queryRef = useRef("");

  const selectedSku = value?.sku || value?.variant_id || "";

  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setActiveIndex(-1);
      setLoading(false);
      return;
    }

    const timer = window.setTimeout(async () => {
      const trimmed = queryRef.current.trim();
      if (!trimmed) return;
      setLoading(true);
      setError("");

      const { data, error: rpcError } = await supabase.rpc("erp_variant_search", {
        p_query: trimmed,
        p_limit: 20,
      });

      if (rpcError) {
        const message = rpcError.message || "Failed to search variants.";
        setError(message);
        if (onError) onError(message);
        setResults([]);
      } else {
        setResults(((data || []) as VariantSearchResult[]).slice(0, 20));
      }

      setLoading(false);
      setActiveIndex(-1);
      setIsOpen(true);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [query, onError]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent | globalThis.MouseEvent) {
      if (!wrapperRef.current) return;
      if (event.target instanceof Node && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const showDropdown = isOpen && (results.length > 0 || loading || (!!query.trim() && !loading));

  const visibleResults = useMemo(() => results.slice(0, 20), [results]);

  function handleSelect(result: VariantSearchResult | null) {
    onSelect(result);
    setQuery("");
    setIsOpen(false);
    setResults([]);
    setActiveIndex(-1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!showDropdown || visibleResults.length === 0) {
      if (event.key === "ArrowDown" && query.trim()) {
        setIsOpen(true);
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((prev) => (prev + 1) % visibleResults.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((prev) => (prev <= 0 ? visibleResults.length - 1 : prev - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const active = visibleResults[activeIndex];
      if (active) {
        handleSelect(active);
      }
    } else if (event.key === "Escape") {
      setIsOpen(false);
    }
  }

  function handleResultMouseDown(event: MouseEvent<HTMLDivElement>, result: VariantSearchResult) {
    event.preventDefault();
    handleSelect(result);
  }

  return (
    <div style={typeaheadWrapperStyle} ref={wrapperRef}>
      <div
        style={{
          ...inputWrapperStyle,
          backgroundColor: disabled ? "#f9fafb" : "#fff",
          opacity: disabled ? 0.7 : 1,
        }}
      >
        {selectedSku ? (
          <span style={pillStyle}>
            {selectedSku}
            {!disabled ? (
              <button type="button" style={pillButtonStyle} onClick={() => handleSelect(null)} aria-label="Clear SKU">
                ✕
              </button>
            ) : null}
          </span>
        ) : null}
        <input
          style={inputFieldStyle}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => {
            if (query.trim()) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={selectedSku ? "Search to replace" : placeholder}
          disabled={disabled}
        />
      </div>

      {showDropdown ? (
        <div style={dropdownStyle}>
          {loading ? <div style={emptyStateStyle}>Searching…</div> : null}
          {!loading && visibleResults.length === 0 ? (
            <div style={emptyStateStyle}>No results found.</div>
          ) : null}
          {!loading && visibleResults.length > 0
            ? visibleResults.map((result, index) => {
                const isActive = index === activeIndex;
                const detailText = [result.style_code, result.title].filter(Boolean).join(" · ");
                return (
                  <div
                    key={result.variant_id}
                    style={{
                      ...resultRowStyle,
                      backgroundColor: isActive ? "#eef2ff" : "transparent",
                    }}
                    onMouseDown={(event) => handleResultMouseDown(event, result)}
                  >
                    <div style={resultSkuStyle}>{result.sku}</div>
                    <div style={resultMetaStyle}>{detailText || "—"}</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {result.size ? <span style={chipStyle}>{result.size}</span> : null}
                      {result.color ? <span style={chipStyle}>{result.color}</span> : null}
                      {result.hsn_code ? <span style={hsnBadgeStyle}>HSN {result.hsn_code}</span> : null}
                    </div>
                  </div>
                );
              })
            : null}
        </div>
      ) : null}

      {error ? <div style={{ marginTop: 6, fontSize: 12, color: "#b91c1c" }}>{error}</div> : null}
    </div>
  );
}
