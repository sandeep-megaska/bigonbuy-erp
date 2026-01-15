import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import ErpSidebar from "./ErpSidebar";
import ErpTopBar, { type ErpModuleKey } from "./ErpTopBar";

export default function ErpShell({
  activeModule,
  children,
}: {
  activeModule: ErpModuleKey;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const sidebarWidth = collapsed ? 72 : 240;

  return (
    <div style={shellStyle}>
      <ErpTopBar activeModule={activeModule} />
      <ErpSidebar
        activeModule={activeModule}
        collapsed={collapsed}
        onToggle={() => setCollapsed((prev) => !prev)}
      />
      <main style={{ ...mainStyle, marginLeft: sidebarWidth }}>
        {children}
      </main>
    </div>
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
