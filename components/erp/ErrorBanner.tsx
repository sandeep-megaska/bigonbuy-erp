import { type ReactNode } from "react";
import { primaryButtonStyle, secondaryButtonStyle } from "./uiStyles";

type ErrorBannerAction = {
  label: string;
  onClick: () => void;
  variant?: "primary" | "secondary";
};

type ErrorBannerProps = {
  message: ReactNode;
  actions?: ErrorBannerAction[];
};

const baseStyle = {
  border: "1px solid #fecaca",
  borderRadius: 12,
  padding: 16,
  background: "#fef2f2",
  color: "#991b1b",
  display: "grid",
  gap: 12,
};

export default function ErrorBanner({ message, actions }: ErrorBannerProps) {
  return (
    <div style={baseStyle}>
      <div>{message}</div>
      {actions && actions.length > 0 ? (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
              style={action.variant === "secondary" ? secondaryButtonStyle : primaryButtonStyle}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
