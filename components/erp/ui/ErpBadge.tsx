import type { CSSProperties, ReactNode } from "react";
import { badgeStyle } from "./styles";

type ErpBadgeProps = {
  tone?: "default" | "success" | "warning" | "danger";
  children: ReactNode;
};

const toneStyle: Record<NonNullable<ErpBadgeProps["tone"]>, CSSProperties> = {
  default: {},
  success: { backgroundColor: "#ecfdf3", color: "#166534" },
  warning: { backgroundColor: "#fffbeb", color: "#92400e" },
  danger: { backgroundColor: "#fff1f2", color: "#b42318" },
};

export default function ErpBadge({ tone = "default", children }: ErpBadgeProps) {
  return <span style={{ ...badgeStyle, ...toneStyle[tone] }}>{children}</span>;
}
