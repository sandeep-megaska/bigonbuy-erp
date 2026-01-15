import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import { ERP_NAV, isNavItemAllowed } from "../../lib/erp/nav";
import { isManager } from "../../lib/erpContext";
import { getCompanyLogosSignedUrlsIfNeeded } from "../../lib/erp/companySettings";

export default function ErpNavBar({ access, roleKey }) {
  const router = useRouter();
  const [logos, setLogos] = useState({ bigonbuyUrl: null, megaskaUrl: null });
  const resolvedAccess =
    access ||
    {
      isAuthenticated: Boolean(roleKey),
      isManager: isManager(roleKey),
      roleKey,
    };
  const items = ERP_NAV.filter((item) => isNavItemAllowed(item, resolvedAccess));

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const { bigonbuyUrl, megaskaUrl } = await getCompanyLogosSignedUrlsIfNeeded();
        if (!active) return;
        setLogos({ bigonbuyUrl, megaskaUrl });
      } catch (error) {
        console.error("Failed to load company logos", error);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const sections = items.reduce((acc, item) => {
    acc[item.section] = acc[item.section] || [];
    acc[item.section].push(item);
    return acc;
  }, {});

  const sectionEntries = useMemo(() => Object.entries(sections), [sections]);
  if (!sectionEntries.length) return null;

  return (
    <nav style={navContainerStyle}>
      <div style={brandRowStyle}>
        <div style={brandLeftStyle}>
          {logos.bigonbuyUrl ? (
            <img
              src={logos.bigonbuyUrl}
              alt="Bigonbuy logo"
              style={bigonbuyLogoStyle}
            />
          ) : (
            <div style={logoFallbackStyle}>BIGONBUY</div>
          )}
          {logos.megaskaUrl ? (
            <img
              src={logos.megaskaUrl}
              alt="Megaska logo"
              style={megaskaLogoStyle}
            />
          ) : null}
        </div>
        <div style={brandTitleStyle}>ERP Navigation</div>
      </div>
      <div style={navSectionsStyle}>
        {sectionEntries.map(([section, links]) => (
          <div key={section} style={sectionStyle}>
            <p style={sectionTitleStyle}>{section}</p>
            <div style={linkColumnStyle}>
              {links.map((link) => {
                const isActive =
                  router.pathname === link.href || router.pathname.startsWith(`${link.href}/`);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    style={{ ...linkStyle, ...(isActive ? activeLinkStyle : {}) }}
                  >
                    <span>{link.label}</span>
                    {isActive ? <span style={activePillStyle}>Active</span> : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </nav>
  );
}

const navContainerStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: "16px 0 12px",
  borderBottom: "1px solid #e5e7eb",
  marginBottom: 24,
};

const brandRowStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  flexWrap: "wrap",
};

const brandLeftStyle = {
  display: "flex",
  alignItems: "center",
  gap: 12,
};

const brandTitleStyle = {
  fontSize: 12,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "#6b7280",
  fontWeight: 700,
};

const bigonbuyLogoStyle = {
  height: 36,
  width: "auto",
  objectFit: "contain",
};

const megaskaLogoStyle = {
  height: 26,
  width: "auto",
  objectFit: "contain",
};

const logoFallbackStyle = {
  padding: "6px 10px",
  borderRadius: 999,
  backgroundColor: "#111827",
  color: "#fff",
  fontSize: 12,
  letterSpacing: "0.08em",
  fontWeight: 700,
};

const navSectionsStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: 16,
};

const sectionStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const sectionTitleStyle = {
  margin: 0,
  fontSize: 12,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "#6b7280",
};

const linkColumnStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const linkStyle = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  background: "#f9fafb",
  textDecoration: "none",
  color: "#1f2937",
  fontWeight: 600,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const activeLinkStyle = {
  borderColor: "#2563eb",
  background: "#eef2ff",
  color: "#1e3a8a",
};

const activePillStyle = {
  padding: "4px 8px",
  borderRadius: 999,
  background: "#1e3a8a",
  color: "#fff",
  fontSize: 11,
  fontWeight: 700,
};
