import Link from "next/link";
import { isManager } from "../../lib/erpContext";

const navSections = [
  {
    title: "Workspace",
    links: [
      { label: "ERP Home", href: "/erp" },
      { label: "HR Home", href: "/erp/hr", requireManager: true },
      { label: "Finance", href: "/erp/finance", requireManager: true },
    ],
  },
  {
    title: "Admin",
    links: [{ label: "Company Users", href: "/erp/admin/company-users", requireManager: true }],
  },
];

export default function ErpNavBar({ roleKey }) {
  const canManage = isManager(roleKey);
  const sections = navSections
    .map((section) => ({
      ...section,
      links: section.links.filter((link) => (link.requireManager ? canManage : true)),
    }))
    .filter((section) => section.links.length > 0);

  if (!sections.length) return null;

  return (
    <nav style={navContainerStyle}>
      {sections.map((section) => (
        <div key={section.title} style={sectionStyle}>
          <p style={sectionTitleStyle}>{section.title}</p>
          <div style={linkRowStyle}>
            {section.links.map((link) => (
              <Link key={link.href} href={link.href} style={linkStyle}>
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

const navContainerStyle = {
  display: "flex",
  gap: 18,
  padding: "10px 0 2px",
  borderBottom: "1px solid #e5e7eb",
  marginBottom: 24,
  flexWrap: "wrap",
};

const sectionStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const sectionTitleStyle = {
  margin: 0,
  fontSize: 12,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "#6b7280",
};

const linkRowStyle = {
  display: "flex",
  gap: 12,
  flexWrap: "wrap",
};

const linkStyle = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  background: "#f9fafb",
  textDecoration: "none",
  color: "#1f2937",
  fontWeight: 600,
};
