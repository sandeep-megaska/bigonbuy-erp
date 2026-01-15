import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useCompanyBranding } from "../../lib/erp/useCompanyBranding";
import { useCompanyBranding } from "../../lib/erp/useCompanyBranding";

export type ErpModuleKey = "workspace" | "hr" | "employee" | "finance" | "admin";

type ModuleLink = {
  key: ErpModuleKey;
  label: string;
  href: string;
};

const moduleLinks: ModuleLink[] = [
  { key: "workspace", label: "Workspace", href: "/erp" },
  { key: "hr", label: "HR", href: "/erp/hr" },
  { key: "employee", label: "Employee", href: "/erp/my/payslips" },
  { key: "finance", label: "Finance", href: "/erp/finance" },
  { key: "admin", label: "Admin", href: "/erp/admin/company-users" },
];

export default function ErpTopBar({ activeModule }: { activeModule: ErpModuleKey }) {
  const router = useRouter();
  const branding = useCompanyBranding();
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (active) {
        setUserEmail(data.user?.email ?? null);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const companyName = branding?.companyName || "Company";

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };

  const navLinks = useMemo(
    () =>
      moduleLinks.map((module) => (
        <Link
          key={module.key}
          href={module.href}
          style={{
            ...navLinkStyle,
            ...(activeModule === module.key ? activeNavLinkStyle : null),
          }}
        >
          {module.label}
        </Link>
      )),
    [activeModule]
  );

  return (
    <header style={topBarStyle}>
      <div style={brandBlockStyle}>
        {branding?.bigonbuyLogoUrl ? (
          <img src={branding.bigonbuyLogoUrl} alt="Bigonbuy logo" style={logoStyle} />
        ) : (
          <div style={logoFallbackStyle}>BIGONBUY</div>
        )}
        <div>
          <div style={brandNameStyle}>BIGONBUY ERP</div>
          <div style={companyNameStyle}>{companyName}</div>
        </div>
      </div>

      <nav style={navStyle}>{navLinks}</nav>

      <div style={rightBlockStyle}>
        {userEmail ? <span style={userStyle}>{userEmail}</span> : null}
        <button type="button" onClick={handleSignOut} style={signOutStyle}>
          Sign Out
        </button>
      </div>
    </header>
  );
}

const topBarStyle: CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  height: 56,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  padding: "0 20px",
  backgroundColor: "#ffffff",
  borderBottom: "1px solid #e5e7eb",
  zIndex: 30,
};

const brandBlockStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  minWidth: 220,
};

const logoStyle: CSSProperties = {
  height: 32,
  width: "auto",
  objectFit: "contain",
};

const logoFallbackStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  height: 32,
  padding: "0 10px",
  borderRadius: 8,
  backgroundColor: "#111827",
  color: "#fff",
  fontSize: 11,
  letterSpacing: "0.12em",
  fontWeight: 700,
};

const brandNameStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "#111827",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const companyNameStyle: CSSProperties = {
  fontSize: 12,
  color: "#6b7280",
};

const navStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  flex: 1,
  justifyContent: "center",
};

const navLinkStyle: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 6,
  textDecoration: "none",
  color: "#111827",
  fontSize: 14,
  fontWeight: 600,
};

const activeNavLinkStyle: CSSProperties = {
  color: "#2563eb",
  backgroundColor: "#eff6ff",
};

const rightBlockStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
};

const userStyle: CSSProperties = {
  fontSize: 12,
  color: "#6b7280",
  maxWidth: 180,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const signOutStyle: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  backgroundColor: "#fff",
  color: "#111827",
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 13,
};
