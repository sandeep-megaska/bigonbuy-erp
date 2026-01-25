import Link from "next/link";
import ErpShell from "../../../../components/erp/ErpShell";
import {
  cardStyle,
  eyebrowStyle,
  h1Style,
  pageContainerStyle,
  pageHeaderStyle,
  secondaryButtonStyle,
  subtitleStyle,
} from "../../../../components/erp/uiStyles";

const healthLinks = [
  {
    title: "Available stock",
    description: "Review available inventory with optional problem-only focus.",
    href: "/erp/inventory/health/available",
  },
  {
    title: "Negative stock",
    description: "Monitor availability below zero by SKU and warehouse.",
    href: "/erp/inventory/health/negative",
  },
  {
    title: "Low stock",
    description: "Track SKUs at or below minimum stock thresholds.",
    href: "/erp/inventory/health/low-stock",
  },
];

export default function InventoryHealthIndexPage() {
  return (
    <ErpShell activeModule="workspace">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory · Health</p>
            <h1 style={h1Style}>Inventory Health</h1>
            <p style={subtitleStyle}>Choose a health lens to monitor inventory risks.</p>
          </div>
        </header>

        <section style={gridStyle}>
          {healthLinks.map((link) => (
            <div key={link.title} style={cardStyle}>
              <h2 style={cardTitleStyle}>{link.title}</h2>
              <p style={cardDescriptionStyle}>{link.description}</p>
              <Link href={link.href} style={secondaryButtonStyle}>
                Open {link.title}
              </Link>
            </div>
          ))}
        </section>
      </div>
    </ErpShell>
  );
}

const gridStyle = {
  display: "grid",
  gap: 16,
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
};

const cardTitleStyle = {
  margin: "0 0 8px",
  fontSize: 18,
  fontWeight: 600,
};

const cardDescriptionStyle = {
  margin: "0 0 16px",
  color: "#6b7280",
};
