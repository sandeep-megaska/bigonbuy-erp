import { useState } from "react";
import type { CSSProperties } from "react";

type ErrorBannerProps = {
  message: string;
  details?: string | null;
  onRetry?: () => void;
};

export default function ErrorBanner({ message, details, onRetry }: ErrorBannerProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const text = details || message;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy error details", error);
    }
  };

  return (
    <div style={bannerStyle} role="alert">
      <div style={messageStyle}>{message}</div>
      {details ? <div style={detailsStyle}>{details}</div> : null}
      <div style={actionsStyle}>
        {onRetry ? (
          <button type="button" style={retryButtonStyle} onClick={onRetry}>
            Retry
          </button>
        ) : null}
        <button type="button" style={copyButtonStyle} onClick={handleCopy}>
          {copied ? "Copied" : "Copy technical details"}
        </button>
      </div>
    </div>
  );
}

const bannerStyle: CSSProperties = {
  border: "1px solid #fecaca",
  backgroundColor: "#fff1f2",
  color: "#991b1b",
  borderRadius: 12,
  padding: 16,
  display: "grid",
  gap: 8,
};

const messageStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
};

const detailsStyle: CSSProperties = {
  fontSize: 12,
  color: "#7f1d1d",
  backgroundColor: "rgba(255, 255, 255, 0.65)",
  borderRadius: 8,
  padding: "8px 10px",
  wordBreak: "break-word",
};

const actionsStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
};

const retryButtonStyle: CSSProperties = {
  borderRadius: 8,
  border: "1px solid #fecaca",
  backgroundColor: "#ef4444",
  color: "#fff",
  padding: "6px 12px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const copyButtonStyle: CSSProperties = {
  borderRadius: 8,
  border: "1px solid #fca5a5",
  backgroundColor: "#fff",
  color: "#991b1b",
  padding: "6px 12px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};
