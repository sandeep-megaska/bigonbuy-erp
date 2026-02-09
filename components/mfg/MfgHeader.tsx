import Link from "next/link";
import { useRouter } from "next/router";
import { useMfgContext } from "./mfgContext";
import type { ReactNode } from "react";

function LogoBox({ url, fallback }: { url?: string | null; fallback: string }) {
  return (
    <div
      style={{
        width: 160,
        height: 52,
        border: "1px solid #e5e7eb",
        borderRadius: 10,
        background: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {url ? (
        <img
          src={url}
          alt={fallback}
          style={{ maxWidth: "95%", maxHeight: "90%", objectFit: "contain" }}
        />
      ) : (
        <span style={{ fontSize: 12, color: "#94a3b8" }}>{fallback}</span>
      )}
    </div>
  );
}

function NavButton({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        height: 34,
        borderRadius: 0,
        border: "none",
        borderBottom: active ? "2px solid #1d4ed8" : "2px solid transparent",
        padding: "0 4px",
        textDecoration: "none",
        fontSize: 14,
        fontWeight: active ? 700 : 600,
        color: active ? "#1d4ed8" : "#334155",
        background: "transparent",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </Link>
  );
}

type MfgHeaderProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
};

export default function MfgHeader({ title, subtitle, actions }: MfgHeaderProps) {
  const router = useRouter();
  const { vendorCode, vendorName, branding, loading, signOut } = useMfgContext();

  const dashboardPath = vendorCode ? `/mfg/v/${vendorCode}` : "/mfg/login";

  const productionPath = vendorCode ? `/mfg/v/${vendorCode}/production` : "/mfg/login";

  const navItems = [
    { label: "Dashboard", href: dashboardPath, active: router.pathname === "/mfg/v/[vendor_code]" },
    { label: "Production", href: productionPath, active: router.pathname === "/mfg/v/[vendor_code]/production" },
    { label: "Materials", href: "/mfg/materials", active: router.pathname === "/mfg/materials" },
    { label: "BOM", href: "/mfg/bom", active: router.pathname === "/mfg/bom" },
    { label: "ASN", href: "/mfg/asn", active: router.pathname === "/mfg/asn" },
  ];

  const uniqueNavItems = navItems.filter(
    (item, index, items) => items.findIndex((candidate) => candidate.href === item.href) === index
  );

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        borderBottom: "1px solid #e2e8f0",
        boxShadow: "0 1px 2px rgba(15, 23, 42, 0.06)",
        background: "#f8fafc",
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "12px 24px 8px",
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <LogoBox url={branding.vendor_logo_url} fallback={loading ? "Loading logo..." : "Vendor Logo"} />

          <div style={{ textAlign: "center", flex: 1, minWidth: 220 }}>
            <div style={{ color: "#64748b", fontSize: 12, letterSpacing: 0.4 }}>Manufacturer Portal</div>
            <div style={{ marginTop: 2, fontSize: 20, fontWeight: 700, color: "#0f172a" }}>
              {vendorName || (loading ? "Loading vendor..." : title)}
            </div>
            <div style={{ color: "#64748b", fontSize: 12 }}>
              {vendorCode || ""} {subtitle ? `• ${subtitle}` : ""}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, minWidth: 230 }}>
            <LogoBox url={branding.company_megaska_logo_url} fallback={loading ? "Loading logo..." : "Megaska"} />
            <button
              onClick={signOut}
              style={{
                height: 36,
                borderRadius: 8,
                border: "1px solid #cbd5e1",
                padding: "0 12px",
                background: "#fff",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                color: "#334155",
                whiteSpace: "nowrap",
                marginLeft: "auto",
              }}
            >
              Sign Out
            </button>
            {actions}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 24, marginTop: 2, flexWrap: "wrap" }}>
          {uniqueNavItems.map((item) => (
            <NavButton key={item.href} href={item.href} label={item.label} active={item.active} />
          ))}
        </div>
      </div>
    </header>
  );
}
