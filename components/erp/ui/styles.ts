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
  gap: 16,
  flexWrap: "wrap",
  borderBottom: "1px solid #e2e8f0",
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

export const cardStyle: CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 14,
  padding: 16,
  backgroundColor: "#fff",
  boxShadow: "0 8px 24px rgba(15, 23, 42, 0.06)",
};

export const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  borderRadius: 14,
  overflow: "hidden",
  backgroundColor: "#fff",
  boxShadow: "0 8px 24px rgba(15, 23, 42, 0.06)",
};

export const tableHeaderCellStyle: CSSProperties = {
  textAlign: "left",
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "#6b7280",
  padding: "12px 14px",
  backgroundColor: "#f8fafc",
  borderBottom: "1px solid #e2e8f0",
};

export const tableCellStyle: CSSProperties = {
  padding: "12px 14px",
  borderBottom: "1px solid #e2e8f0",
  color: "#111827",
  fontSize: 14,
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
  backgroundColor: "#e0f2fe",
  color: "#0369a1",
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
