import type { ReactNode } from "react";
import ErpCard from "./ErpCard";

type ErpStatCardProps = {
  label: ReactNode;
  value: ReactNode;
  meta?: ReactNode;
};

export default function ErpStatCard({ label, value, meta }: ErpStatCardProps) {
  return (
    <ErpCard subtitle={label}>
      <div style={{ fontSize: 26, fontWeight: 700, color: "#0f172a", lineHeight: 1.25 }}>{value}</div>
      {meta ? <div style={{ marginTop: 6, color: "#64748b", fontSize: 12 }}>{meta}</div> : null}
    </ErpCard>
  );
}
