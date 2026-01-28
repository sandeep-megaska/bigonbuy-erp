import { useState } from "react";
import type { CSSProperties } from "react";

type ErpTooltipProps = {
  content: string;
  ariaLabel?: string;
};

const tooltipWrapperStyle: CSSProperties = {
  position: "relative",
  display: "inline-flex",
  alignItems: "center",
};

const tooltipButtonStyle: CSSProperties = {
  border: "none",
  background: "transparent",
  padding: 0,
  cursor: "pointer",
  color: "#9ca3af",
  fontSize: 12,
  lineHeight: 1,
};

const tooltipBubbleStyle: CSSProperties = {
  position: "absolute",
  top: "100%",
  left: "50%",
  transform: "translate(-50%, 8px)",
  background: "#111827",
  color: "#f9fafb",
  padding: "8px 10px",
  borderRadius: 8,
  fontSize: 12,
  whiteSpace: "pre-line",
  minWidth: 220,
  maxWidth: 320,
  zIndex: 30,
  boxShadow: "0 10px 20px rgba(0, 0, 0, 0.15)",
};

const tooltipCaretStyle: CSSProperties = {
  position: "absolute",
  top: -6,
  left: "50%",
  transform: "translateX(-50%)",
  width: 0,
  height: 0,
  borderLeft: "6px solid transparent",
  borderRight: "6px solid transparent",
  borderBottom: "6px solid #111827",
};

export default function ErpTooltip({ content, ariaLabel = "More info" }: ErpTooltipProps) {
  const [open, setOpen] = useState(false);

  return (
    <span style={tooltipWrapperStyle}>
      <button
        type="button"
        aria-label={ariaLabel}
        style={tooltipButtonStyle}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        ⓘ
      </button>
      {open ? (
        <span role="tooltip" style={tooltipBubbleStyle}>
          <span style={tooltipCaretStyle} />
          {content}
        </span>
      ) : null}
    </span>
  );
}
