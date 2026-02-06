import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { ErpModuleKey } from "./ErpTopBar";
import { getCompanyContext } from "../../lib/erpContext";
import { getErpNavGroups } from "../../lib/erp/nav/erpNavRegistry";
import { getFinanceNavGroups } from "../../lib/erp/financeNav";

export default function ErpSidebar({
  activeModule,
  collapsed,
  onToggle,
}: {
  activeModule: ErpModuleKey;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();
  const [companyContext, setCompanyContext] = useState<{
    roleKey: string | null;
    companyId: string | null;
  }>({ roleKey: null, companyId: null });

  useEffect(() => {
    let active = true;

    (async () => {
      const context = await getCompanyContext();
      if (!active) return;
      setCompanyContext({
        roleKey: context.roleKey ?? null,
        companyId: context.companyId ?? null,
      });
    })();

    return () => {
      active = false;
    };
  }, []);

  const groups = useMemo(() => {
    if (activeModule === "finance") {
      return getFinanceNavGroups(companyContext.roleKey);
    }
    return getErpNavGroups({
      roleKey: companyContext.roleKey,
      companyId: companyContext.companyId,
      activeModule,
    });
  }, [activeModule, companyContext]);

  const mainGroups = useMemo(() => groups.filter((group) => group.label !== "Settings"), [groups]);
  const settingsGroups = useMemo(
    () => groups.filter((group) => group.label === "Settings"),
    [groups]
  );

  const isActiveRoute = (href: string) => {
    if (href === "/erp") {
      return router.asPath === "/erp";
    }
    return router.asPath === href || router.asPath.startsWith(`${href}/`);
  };

  return (
    <aside style={{ ...sidebarStyle, width: collapsed ? 72 : 240 }} data-erp-sidebar>
      <button type="button" onClick={onToggle} style={collapseButtonStyle}>
        {collapsed ? "→" : "←"}
      </button>
      <div style={groupStackStyle}>
        {mainGroups.map((group) => (
          <div key={group.label} style={groupStyle}>
            {!collapsed ? <div style={groupLabelStyle}>{group.label}</div> : null}
            <div style={itemStackStyle}>
              {group.items.map((item) => {
                const isActive = isActiveRoute(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    style={{ ...navItemStyle, ...(isActive ? activeNavItemStyle : null) }}
                  >
                    <span style={iconBadgeStyle}>{item.icon || item.label.slice(0, 2)}</span>
                    {!collapsed ? <span>{item.label}</span> : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {settingsGroups.length > 0 ? (
        <div style={settingsDockStyle}>
          {settingsGroups.map((group) => (
            <div key={group.label} style={groupStyle}>
              {!collapsed ? <div style={groupLabelStyle}>{group.label}</div> : null}
              <div style={itemStackStyle}>
                {group.items.map((item) => {
                  const isActive = isActiveRoute(item.href);
                  const isDisabled = item.href === "#";
                  return (
                    <Link
                      key={item.href + item.label}
                      href={item.href}
                      aria-disabled={isDisabled}
                      style={{
                        ...navItemStyle,
                        ...(isActive ? activeNavItemStyle : null),
                        ...(isDisabled ? disabledNavItemStyle : null),
                      }}
                    >
                      <span style={iconBadgeStyle}>{item.icon || item.label.slice(0, 2)}</span>
                      {!collapsed ? <span>{item.label}</span> : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </aside>
  );
}

const settingsDockStyle: CSSProperties = {
  marginTop: "auto",
  paddingTop: 12,
  borderTop: "1px solid rgba(255,255,255,0.12)",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const sidebarStyle: CSSProperties = {
  position: "fixed",
  top: 56,
  left: 0,
  bottom: 0,
  backgroundColor: "#111827",
  color: "#fff",
  padding: "16px 12px",
  display: "flex",
  flexDirection: "column",
  gap: 16,
  overflowY: "auto",
  transition: "width 150ms ease",
  zIndex: 20,
};

const collapseButtonStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.15)",
  backgroundColor: "transparent",
  color: "#fff",
  borderRadius: 8,
  padding: "6px 8px",
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 12,
  alignSelf: "flex-end",
};

const groupStackStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 18,
};

const groupStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const groupLabelStyle: CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  color: "rgba(255,255,255,0.6)",
  paddingLeft: 8,
};

const itemStackStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const navItemStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 10px",
  borderRadius: 8,
  textDecoration: "none",
  color: "#e5e7eb",
  fontSize: 13,
  fontWeight: 600,
  backgroundColor: "rgba(255,255,255,0.04)",
};

const activeNavItemStyle: CSSProperties = {
  backgroundColor: "rgba(59,130,246,0.2)",
  color: "#ffffff",
};

const disabledNavItemStyle: CSSProperties = {
  opacity: 0.65,
  pointerEvents: "none",
};

const iconBadgeStyle: CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 8,
  backgroundColor: "rgba(255,255,255,0.15)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.02em",
};
