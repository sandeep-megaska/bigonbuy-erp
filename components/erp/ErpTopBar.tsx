import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useRef, useState } from "react";
import CommandPalette from "./CommandPalette";
import { getCompanyContext } from "../../lib/erpContext";
import type { CSSProperties } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useCompanyBranding } from "../../lib/erp/useCompanyBranding";
import { navLink, navLinkActive, shellHeader } from "./tw";

export type ErpModuleKey = "workspace" | "ops" | "hr" | "employee" | "finance" | "oms" | "admin";

type ModuleLink = {
  key: ErpModuleKey;
  label: string;
  href: string;
};

const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(" ");

const moduleLinks: ModuleLink[] = [
  { key: "workspace", label: "Workspace", href: "/erp" },
  { key: "ops", label: "Ops", href: "/erp/ops" },
  { key: "hr", label: "HR", href: "/erp/hr" },
  { key: "finance", label: "Finance", href: "/erp/finance" },
  { key: "oms", label: "OMS", href: "/erp/oms/channels" },
];

export default function ErpTopBar({ activeModule }: { activeModule: ErpModuleKey }) {
  const router = useRouter();
  const branding = useCompanyBranding();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [companyMenuOpen, setCompanyMenuOpen] = useState(false);
  const [showCompactSearch, setShowCompactSearch] = useState(false);
  const [paletteOpenNonce, setPaletteOpenNonce] = useState(0);
  const [companyContext, setCompanyContext] = useState<{ roleKey: string | null; companyId: string | null }>({
    roleKey: null,
    companyId: null,
  });
  const companyMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (active) setUserEmail(data.user?.email ?? null);
    });
    return () => {
      active = false;
    };
  }, []);


  useEffect(() => {
    let active = true;
    (async () => {
      const context = await getCompanyContext();
      if (!active) return;
      setCompanyContext({ roleKey: context.roleKey ?? null, companyId: context.companyId ?? null });
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const updateCompact = () => setShowCompactSearch(window.innerWidth < 840);
    updateCompact();
    window.addEventListener("resize", updateCompact);
    return () => window.removeEventListener("resize", updateCompact);
  }, []);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (!companyMenuRef.current) return;
      if (event.target instanceof Node && !companyMenuRef.current.contains(event.target)) {
        setCompanyMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, []);

  useEffect(() => {
    setCompanyMenuOpen(false);
  }, [router.asPath]);

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
          className={cx(navLink, activeModule === module.key && navLinkActive)}
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
    <header className={shellHeader} style={topBarStyle} data-erp-topbar>
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

        {branding?.megaskaLogoUrl ? (
          <img src={branding.megaskaLogoUrl} alt="Megaska logo" style={megaskaLogoStyle} />
        ) : null}
      </div>

      <nav style={navStyle}>{navLinks}</nav>

      <div style={rightBlockStyle}>
        <button type="button" className="erp-btn-focus" style={searchTriggerStyle} onClick={() => setPaletteOpenNonce((prev) => prev + 1)} aria-label="Open module search">
          <span style={searchIconButtonStyle}>⌘</span>
          {!showCompactSearch ? <span>Search modules</span> : null}
          {!showCompactSearch ? <span style={searchHintStyle}>Ctrl/⌘ K</span> : null}
        </button>
        <div style={companyMenuWrapperStyle} ref={companyMenuRef}>
          <button
            type="button"
            onClick={() => setCompanyMenuOpen((prev) => !prev)}
            className="erp-btn-focus" style={companyMenuButtonStyle}
            aria-expanded={companyMenuOpen}
            aria-haspopup="menu"
          >
            Company
            <span style={companyMenuCaretStyle}>{companyMenuOpen ? "▲" : "▼"}</span>
          </button>
          {companyMenuOpen ? (
            <div style={companyMenuStyle} role="menu">
              <Link href="/erp/company" style={companyMenuLinkStyle} role="menuitem">
                Company Settings Hub
              </Link>
              <Link href="/erp/admin/company-users" style={companyMenuLinkStyle} role="menuitem">
                Users &amp; Access
              </Link>
            </div>
          ) : null}
        </div>
        {userEmail ? <span style={userStyle}>{userEmail}</span> : null}
        <button type="button" onClick={handleSignOut} className="erp-btn-focus" style={signOutStyle}>
          Sign Out
        </button>
      </div>
      <CommandPalette
        roleKey={companyContext.roleKey}
        companyId={companyContext.companyId}
        openNonce={paletteOpenNonce}
      />
    </header>
  );
}

const topBarStyle: CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  height: 64,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  padding: "0 20px",
  backgroundColor: "rgba(255,255,255,0.95)",
  borderBottom: "1px solid #e2e8f0",
  zIndex: 30,
};

const brandBlockStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  minWidth: 260,
};

const logoStyle: CSSProperties = {
  height: 32,
  width: "auto",
  objectFit: "contain",
};

const megaskaLogoStyle: CSSProperties = {
  height: 20,
  width: "auto",
  objectFit: "contain",
  opacity: 0.9,
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

const companyMenuWrapperStyle: CSSProperties = {
  position: "relative",
};

const companyMenuButtonStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  backgroundColor: "#fff",
  color: "#111827",
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 13,
};

const companyMenuCaretStyle: CSSProperties = {
  fontSize: 10,
  opacity: 0.7,
};

const companyMenuStyle: CSSProperties = {
  position: "absolute",
  top: "calc(100% + 8px)",
  right: 0,
  minWidth: 200,
  borderRadius: 10,
  backgroundColor: "#fff",
  border: "1px solid #e5e7eb",
  boxShadow: "0 10px 24px rgba(15, 23, 42, 0.12)",
  padding: 6,
  display: "flex",
  flexDirection: "column",
  gap: 4,
  zIndex: 40,
};

const companyMenuLinkStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  textDecoration: "none",
  color: "#111827",
  fontSize: 13,
  fontWeight: 600,
  backgroundColor: "rgba(15, 23, 42, 0.02)",
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

const searchTriggerStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 10px",
  borderRadius: 8,
  border: "1px solid #dbe3ef",
  backgroundColor: "#f8fafc",
  color: "#0f172a",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
};

const searchIconButtonStyle: CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: 6,
  background: "#e2e8f0",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 11,
};

const searchHintStyle: CSSProperties = {
  color: "#64748b",
  fontSize: 11,
};
