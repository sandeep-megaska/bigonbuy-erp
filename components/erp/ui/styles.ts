import type { CSSProperties } from "react";
import * as tw from "../tw";

export const pageWrapperStyle: CSSProperties = {
  maxWidth: 1240,
  margin: "0 auto",
  padding: 24,
  width: "100%",
};

export const pageContainerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 24,
};

export const pageHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
  flexWrap: "wrap",
  borderBottom: "1px solid #e5e7eb",
  paddingBottom: 12,
};

export const h1Style: CSSProperties = {
  margin: "4px 0 6px",
  fontSize: 30,
  lineHeight: 1.2,
  fontWeight: 700,
  color: "#0f172a",
};

export const h2Style: CSSProperties = {
  margin: "0 0 12px",
  fontSize: 20,
  color: "#111827",
};

export const subtitleStyle: CSSProperties = {
  margin: 0,
  color: "#64748b",
  fontSize: 14,
};

export const eyebrowStyle: CSSProperties = {
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontSize: 12,
  color: "#6b7280",
  margin: 0,
};

export const cardStyle: CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 14,
  padding: 16,
  backgroundColor: "#fff",
  boxShadow: "0 8px 20px rgba(15, 23, 42, 0.05)",
};

export const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  borderRadius: 12,
  overflow: "hidden",
  backgroundColor: "#fff",
  boxShadow: "none",
};

export const tableHeaderCellStyle: CSSProperties = {
  textAlign: "left",
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "#64748b",
  padding: "11px 14px",
  backgroundColor: "#f8fafc",
  borderBottom: "1px solid #e2e8f0",
};

export const tableCellStyle: CSSProperties = {
  padding: "11px 14px",
  borderBottom: "1px solid #eef2f7",
  color: "#111827",
  fontSize: 14,
};

export const primaryButtonStyle: CSSProperties = {
  padding: "9px 14px",
  backgroundColor: "#2563eb",
  color: "#fff",
  borderRadius: 8,
  border: "1px solid #2563eb",
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 13,
};

export const secondaryButtonStyle: CSSProperties = {
  padding: "9px 14px",
  backgroundColor: "#fff",
  color: "#111827",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 13,
};

export const ghostButtonStyle: CSSProperties = {
  ...secondaryButtonStyle,
  backgroundColor: "#f8fafc",
  border: "1px solid #e2e8f0",
};

export const inputStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  backgroundColor: "#fff",
  fontSize: 14,
  color: "#111827",
};

export const badgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  borderRadius: 999,
  padding: "4px 10px",
  backgroundColor: "#eef2ff",
  color: "#4338ca",
  fontSize: 12,
  fontWeight: 600,
};

export const cardClassName = tw.card;
export const cardHeaderClassName = tw.cardHeader;
export const cardTitleClassName = tw.cardTitle;
export const cardSubClassName = tw.cardSub;
export const tableWrapClassName = tw.tableWrap;
export const tableClassName = tw.table;
export const tableHeaderCellClassName = tw.th;
export const tableCellClassName = tw.td;
export const tableRowHoverClassName = tw.trHover;
export const badgeClassName = tw.badgeBase;
