import React from "react";

type TabItem = {
  id: string;
  label: string;
};

type TabsProps = {
  tabs: TabItem[];
  activeTab: string;
  onChange: (tabId: string) => void;
};

type SectionCardProps = {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
};

type PillProps = {
  label: string;
  tone?: "green" | "yellow" | "red" | "gray" | "blue";
};

type ModalProps = {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

export function Tabs({ tabs, activeTab, onChange }: TabsProps) {
  return (
    <div style={tabsContainerStyle}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          style={tab.id === activeTab ? activeTabStyle : tabStyle}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function SectionCard({ title, subtitle, actions, children }: SectionCardProps) {
  return (
    <section style={sectionStyle}>
      <div style={sectionHeaderStyle}>
        <div>
          <h3 style={{ margin: 0 }}>{title}</h3>
          {subtitle ? <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: 13 }}>{subtitle}</p> : null}
        </div>
        {actions ? <div>{actions}</div> : null}
      </div>
      <div style={{ marginTop: 16 }}>{children}</div>
    </section>
  );
}

export function Pill({ label, tone = "gray" }: PillProps) {
  const palette = {
    green: { bg: "#ecfdf3", border: "#bbf7d0", text: "#166534" },
    yellow: { bg: "#fffbeb", border: "#fde68a", text: "#92400e" },
    red: { bg: "#fef2f2", border: "#fecaca", text: "#991b1b" },
    gray: { bg: "#f3f4f6", border: "#e5e7eb", text: "#374151" },
    blue: { bg: "#eff6ff", border: "#bfdbfe", text: "#1e40af" },
  } as const;
  const toneStyle = palette[tone];

  return (
    <span
      style={{
        background: toneStyle.bg,
        border: `1px solid ${toneStyle.border}`,
        color: toneStyle.text,
        borderRadius: 999,
        padding: "4px 10px",
        fontSize: 12,
        fontWeight: 600,
        textTransform: "capitalize",
      }}
    >
      {label}
    </span>
  );
}

export function Modal({ title, onClose, children, footer }: ModalProps) {
  return (
    <div style={modalOverlayStyle}>
      <div style={modalStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>{title}</h2>
          <button onClick={onClose} style={linkButtonStyle}>Close</button>
        </div>
        <div style={{ marginTop: 16 }}>{children}</div>
        {footer ? <div style={{ marginTop: 20 }}>{footer}</div> : null}
      </div>
    </div>
  );
}

export function LabeledValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={fieldStyle}>
      <div style={{ fontSize: 12, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{ marginTop: 6, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

export const primaryButtonStyle: React.CSSProperties = {
  background: "#2563eb",
  border: "1px solid #1d4ed8",
  color: "white",
  borderRadius: 8,
  padding: "10px 16px",
  fontWeight: 600,
  cursor: "pointer",
};

export const buttonStyle: React.CSSProperties = {
  background: "white",
  border: "1px solid #d1d5db",
  color: "#111827",
  borderRadius: 8,
  padding: "10px 16px",
  fontWeight: 600,
  cursor: "pointer",
};

export const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  fontSize: 14,
};

export const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  marginBottom: 6,
};

export const gridStyle: React.CSSProperties = {
  display: "grid",
  gap: 16,
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
};

const tabsContainerStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  borderBottom: "1px solid #e5e7eb",
  paddingBottom: 8,
};

const tabStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid transparent",
  color: "#6b7280",
  padding: "8px 14px",
  borderRadius: 999,
  cursor: "pointer",
  fontWeight: 600,
};

const activeTabStyle: React.CSSProperties = {
  ...tabStyle,
  background: "#eff6ff",
  color: "#1d4ed8",
  border: "1px solid #bfdbfe",
};

const sectionStyle: React.CSSProperties = {
  borderRadius: 16,
  padding: 20,
  border: "1px solid #e5e7eb",
  background: "white",
  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
};

const sectionHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "flex-start",
  flexWrap: "wrap",
};

const fieldStyle: React.CSSProperties = {
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  padding: 12,
  background: "#f9fafb",
};

const modalOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
  zIndex: 40,
};

const modalStyle: React.CSSProperties = {
  background: "white",
  borderRadius: 16,
  padding: 20,
  width: "min(720px, 95vw)",
  boxShadow: "0 16px 40px rgba(15, 23, 42, 0.2)",
};

const linkButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#2563eb",
  cursor: "pointer",
  fontWeight: 600,
};
