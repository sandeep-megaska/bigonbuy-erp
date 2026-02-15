import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import CommandPalette from "./CommandPalette";
import { getCompanyContext } from "../../lib/erpContext";
import { supabase } from "../../lib/supabaseClient";
import { useCompanyBranding } from "../../lib/erp/useCompanyBranding";

export type ErpModuleKey =
  | "workspace"
  | "marketing"
  | "ops"
  | "hr"
  | "employee"
  | "finance"
  | "oms"
  | "admin";

type ModuleLink = { key: ErpModuleKey; label: string; href: string };

const moduleLinks: ModuleLink[] = [
  { key: "workspace", label: "Workspace", href: "/erp" },
  { key: "marketing", label: "Marketing", href: "/erp/marketing/intelligence/growth-cockpit" },
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
    const updateCompact = () => setShowCompactSearch(window.innerWidth < 980);
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
    return () => document.removeEventListener("mousedown", handleOutsideClick);
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
      moduleLinks.map((m) => {
        const active = activeModule === m.key;
        return (
          <Link
            key={m.key}
            href={m.href}
            style={{ ...navLinkStyle, ...(active ? activeNavLinkStyle : null) }}
          >
            {m.label}
          </Link>
        );
      }),
    [activeModule]
  );

  return (
    <header style={topBarStyle} data-erp-topbar>
      <div style={topBarContentStyle}>
        {/* LEFT: logos + company */}
        <div style={brandBlockStyle}>
          {branding?.bigonbuyLogoUrl ? (
            <img src={branding.bigonbuyLogoUrl} alt="Bigonbuy logo" style={logoStyle} />
          ) : (
            <div style={logoFallbackStyle}>BIGONBUY</div>
          )}

          <div style={{ minWidth: 0 }}>
            <div style={brandNameStyle}>BIGONBUY ERP</div>
            <div style={companyNameStyle}>{companyName}</div>
          </div>

          {branding?.megaskaLogoUrl ? (
            <img src={branding.megaskaLogoUrl} alt="Megaska logo" style={megaskaLogoStyle} />
          ) : null}
        </div>

        {/* MIDDLE: module nav */}
        <nav style={navStyle} aria-label="ERP modules">
          <div style={navPillWrapStyle}>{navLinks}</div>
        </nav>

        {/* RIGHT: utilities */}
        <div style={rightBlockStyle}>
          <button
            type="button"
            style={utilityButtonStyle}
            onClick={() => setPaletteOpenNonce((p) => p + 1)}
            aria-label="Open module search"
          >
            <span style={kbdStyle}>⌘</span>
            {!showCompactSearch ? <span>Search modules</span> : null}
            {!showCompactSearch ? <span style={hintStyle}>Ctrl/⌘ K</span> : null}
          </button>

          <div style={{ position: "relative" }} ref={companyMenuRef}>
            <button
              type="button"
              onClick={() => setCompanyMenuOpen((p) => !p)}
              style={utilityButtonStyle}
              aria-expanded={companyMenuOpen}
              aria-haspopup="menu"
            >
              Company <span style={caretStyle}>{companyMenuOpen ? "▲" : "▼"}</span>
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

          <button type="button" onClick={handleSignOut} style={signOutStyle}>
            Sign Out
          </button>
        </div>
      </div>

      <CommandPalette roleKey={companyContext.roleKey} companyId={companyContext.companyId} openNonce={paletteOpenNonce} />
    </header>
  );
}

/** ---------- styles ---------- */

const topBarStyle: CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  zIndex: 30,
  height: 64,
  background: "#ffffff",
  borderBottom: "1px solid #e5e7eb",
};

const topBarContentStyle: CSSProperties = {
  height: 64,
  display: "grid",
  gridTemplateColumns: "auto 1fr auto",
  alignItems: "center",
  gap: 12,
  padding: "0 16px",
};

const brandBlockStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  minWidth: 260,
  overflow: "hidden",
};

const logoStyle: CSSProperties = { height: 32, width: "auto", objectFit: "contain" };
const megaskaLogoStyle: CSSProperties = { height: 20, width: "auto", objectFit: "contain", opacity: 0.95 };

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
  fontWeight: 800,
  color: "#111827",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  lineHeight: 1.1,
};

const companyNameStyle: CSSProperties = { fontSize: 12, color: "#6b7280", lineHeight: 1.1 };

const navStyle: CSSProperties = { display: "flex", justifyContent: "center", minWidth: 0 };
const navPillWrapStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: 6,
  borderRadius: 12,
  background: "#f8fafc",
  border: "1px solid #e5e7eb",
  overflowX: "auto",
  maxWidth: "100%",
};

const navLinkStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 34,
  padding: "0 12px",
  borderRadius: 10,
  textDecoration: "none",
  fontSize: 13,
  fontWeight: 700,
  color: "#475569",
  border: "1px solid transparent",
  whiteSpace: "nowrap",
};

const activeNavLinkStyle: CSSProperties = {
  color: "#0f172a",
  background: "#ffffff",
  border: "1px solid #e5e7eb",
  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.06)",
};

const rightBlockStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 8, justifySelf: "end" };

const utilityButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  height: 36,
  padding: "0 10px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  background: "#f8fafc",
  color: "#0f172a",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 700,
};

const kbdStyle: CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: 6,
  background: "#e2e8f0",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 11,
  fontWeight: 800,
};

const hintStyle: CSSProperties = { color: "#64748b", fontSize: 11, fontWeight: 600 };
const caretStyle: CSSProperties = { fontSize: 10, opacity: 0.7 };

const companyMenuStyle: CSSProperties = {
  position: "absolute",
  top: "calc(100% + 8px)",
  right: 0,
  minWidth: 220,
  borderRadius: 12,
  backgroundColor: "#fff",
  border: "1px solid #e5e7eb",
  boxShadow: "0 10px 24px rgba(15, 23, 42, 0.12)",
  padding: 6,
  display: "flex",
  flexDirection: "column",
  gap: 6,
  zIndex: 40,
};

const companyMenuLinkStyle: CSSProperties = {
  padding: "10px 10px",
  borderRadius: 10,
  textDecoration: "none",
  color: "#0f172a",
  fontSize: 13,
  fontWeight: 700,
  backgroundColor: "#f8fafc",
};

const userStyle: CSSProperties = {
  fontSize: 12,
  color: "#6b7280",
  maxWidth: 220,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const signOutStyle: CSSProperties = {
  height: 36,
  padding: "0 10px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  backgroundColor: "#fff",
  color: "#0f172a",
  cursor: "pointer",
  fontWeight: 800,
  fontSize: 13,
};
