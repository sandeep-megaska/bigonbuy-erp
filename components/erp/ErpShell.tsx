import { createContext, useContext, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import ErpSidebar from "./ErpSidebar";
import ErpTopBar, { type ErpModuleKey } from "./ErpTopBar";
import { pageWrapperStyle } from "./ui/styles";
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
      <div style={shellStyle}>
        <ErpTopBar activeModule={activeModule} />
        <ErpSidebar
          activeModule={activeModule}
          collapsed={collapsed}
          onToggle={() => setCollapsed((prev) => !prev)}
        />
        <main style={{ ...mainStyle, marginLeft: sidebarWidth }}>
          <div style={pageWrapperStyle}>
            {activeModule === "finance" ? <FinanceDiagnosticsBanner /> : null}
            {children}
          </div>
        </main>
      </div>
    </ErpShellContext.Provider>
  );
}

const shellStyle: CSSProperties = {
  minHeight: "100vh",
  backgroundColor: "#f8fafc",
};

const mainStyle: CSSProperties = {
  paddingTop: 56,
  minHeight: "100vh",
  transition: "margin-left 150ms ease",
};

const ErpShellContext = createContext(false);
