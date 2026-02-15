import { createContext, useContext, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import ErpSidebar from "./ErpSidebar";
import ErpTopBar, { type ErpModuleKey } from "./ErpTopBar";
import { pageWrapperStyle } from "./ui/styles";
import { pageWrap, shellWrap } from "./tw";
import FinanceDiagnosticsBanner from "./FinanceDiagnosticsBanner";

export default function ErpShell({
  activeModule = "workspace",
  children,
}: {
  activeModule?: ErpModuleKey;
  children: ReactNode;
}) {
  const isNested = useContext(ErpShellContext);
  if (isNested) {
    return <>{children}</>;
  }

  const [collapsed, setCollapsed] = useState(false);
  const sidebarWidth = collapsed ? 72 : 240;

  return (
    <ErpShellContext.Provider value>
      <div className={shellWrap}>
        <ErpTopBar activeModule={activeModule} />
        <ErpSidebar
          activeModule={activeModule}
          collapsed={collapsed}
          onToggle={() => setCollapsed((prev) => !prev)}
        />
        <main className="erp-shell-main" style={{ ...mainStyle, marginLeft: sidebarWidth }}>
          <div className={pageWrap + " erp-shell-page"} style={pageWrapperStyle}>
            <div className="space-y-6">
              {activeModule === "finance" ? <FinanceDiagnosticsBanner /> : null}
              {children}
            </div>
          </div>
        </main>
      </div>
    </ErpShellContext.Provider>
  );
}


const mainStyle: CSSProperties = {
  paddingTop: 64,
  minHeight: "100vh",
  transition: "margin-left 150ms ease",
  background: "#f4f6fa",
};

const ErpShellContext = createContext(false);
