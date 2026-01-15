import type { CSSProperties } from "react";

export const pageContainerStyle: CSSProperties = {
  maxWidth: 1240,
  margin: "0 auto",
  padding: "24px",
  display: "flex",
  flexDirection: "column",
  gap: 24,
};

export const cardStyle: CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 20,
  backgroundColor: "#fff",
  boxShadow: "0 6px 16px rgba(15, 23, 42, 0.06)",
};

export const pageHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 16,
  flexWrap: "wrap",
  borderBottom: "1px solid #e5e7eb",
  paddingBottom: 16,
};

export const h1Style: CSSProperties = {
  margin: "6px 0 8px",
  fontSize: 28,
  color: "#111827",
};

export const h2Style: CSSProperties = {
  margin: "0 0 12px",
  fontSize: 20,
  color: "#111827",
};

export const subtitleStyle: CSSProperties = {
  margin: 0,
  color: "#4b5563",
  fontSize: 15,
};

export const eyebrowStyle: CSSProperties = {
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontSize: 12,
  color: "#6b7280",
  margin: 0,
};

export const primaryButtonStyle: CSSProperties = {
  padding: "10px 16px",
  backgroundColor: "#111827",
  color: "#fff",
  borderRadius: 8,
  border: "1px solid #111827",
  cursor: "pointer",
  fontWeight: 600,
};

export const secondaryButtonStyle: CSSProperties = {
  padding: "10px 16px",
  backgroundColor: "#fff",
  color: "#111827",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  cursor: "pointer",
  fontWeight: 600,
};
