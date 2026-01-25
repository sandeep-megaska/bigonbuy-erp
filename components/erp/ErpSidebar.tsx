import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { ErpModuleKey } from "./ErpTopBar";
import { getCompanyContext } from "../../lib/erpContext";
import { getFinanceNavGroups } from "../../lib/erp/financeNav";

export type SidebarItem = {
  label: string;
  href: string;
  icon?: string;
};

type SidebarGroup = {
  label: string;
  items: SidebarItem[];
};

const hrSidebarGroups: SidebarGroup[] = [
  {
    label: "HR Home",
    items: [{ label: "HR Home", href: "/erp/hr", icon: "HR" }],
  },
  {
    label: "Masters",
    items: [
      { label: "Designations", href: "/erp/hr/masters", icon: "DE" },
      { label: "Departments", href: "/erp/hr/masters", icon: "DP" },
      { label: "Grades", href: "/erp/hr/masters", icon: "GR" },
      { label: "Leave Types", href: "/erp/hr/leaves/types", icon: "LV" },
      { label: "Employee Titles", href: "/erp/hr/masters/employee-titles", icon: "ET" },
      { label: "Employee Genders", href: "/erp/hr/masters/employee-genders", icon: "EG" },
      { label: "Exit Types", href: "/erp/hr/masters/employee-exit-types", icon: "XT" },
      { label: "Exit Reasons", href: "/erp/hr/masters/employee-exit-reasons", icon: "XR" },
      { label: "Locations", href: "/erp/hr/masters", icon: "LO" },
      { label: "Cost Centers", href: "/erp/hr/masters", icon: "CC" },
      { label: "Weekly Off Rules", href: "/erp/hr/weekly-off", icon: "WO" },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Employees", href: "/erp/hr/employees", icon: "EM" },
      { label: "Employee Exits", href: "/erp/hr/exits", icon: "EX" },
      { label: "Attendance", href: "/erp/hr/attendance", icon: "AT" },
      { label: "Leave Requests", href: "/erp/hr/leaves/requests", icon: "LR" },
      { label: "Calendars", href: "/erp/hr/calendars", icon: "CA" },
      { label: "Salary Structures", href: "/erp/hr/salary", icon: "SS" },
      { label: "Payroll", href: "/erp/hr/payroll/runs", icon: "PR" },
    ],
  },
  {
    label: "Reports",
    items: [
      {
        label: "Attendance → Payroll Summary",
        href: "/erp/hr/reports/attendance-payroll-summary",
        icon: "PS",
      },
      { label: "Attendance Exceptions", href: "/erp/hr/reports/attendance-exceptions", icon: "EX" },
      { label: "Attendance Register", href: "/erp/hr/reports/attendance-register", icon: "AR" },
    ],
  },
];

const adminSidebarGroups: SidebarGroup[] = [
  {
    label: "Admin",
    items: [
      { label: "Company Users", href: "/erp/admin/company-users", icon: "CU" },
      { label: "Company Settings", href: "/erp/admin/company-settings", icon: "CS" },
    ],
  },
];

const workspaceSidebarGroups: SidebarGroup[] = [
  {
    label: "Workspace",
    items: [
      { label: "ERP Home", href: "/erp", icon: "ER" },
      { label: "Products", href: "/erp/products", icon: "PR" },
      { label: "Variants", href: "/erp/variants", icon: "VA" },
      { label: "Inventory", href: "/erp/inventory", icon: "IN" },
    ],
  },
  {
    label: "Inventory",
    items: [
      { label: "Dashboard", href: "/erp/inventory/dashboard", icon: "DB" },
      { label: "Vendors", href: "/erp/inventory/vendors", icon: "VE" },
      { label: "RFQs", href: "/erp/inventory/rfqs", icon: "RF" },
      { label: "Quotes", href: "/erp/inventory/quotes", icon: "QT" },
      { label: "Purchase Orders", href: "/erp/inventory/purchase-orders", icon: "PO" },
      { label: "GRNs", href: "/erp/inventory/grns", icon: "GR" },
      { label: "Products", href: "/erp/inventory/products", icon: "PR" },
      { label: "SKUs", href: "/erp/inventory/skus", icon: "SK" },
      { label: "Warehouses", href: "/erp/inventory/warehouses", icon: "WH" },
      { label: "Stock Movements", href: "/erp/inventory/movements", icon: "SM" },
      { label: "Health", href: "/erp/inventory/health", icon: "HL" },
    ],
  },
  {
    label: "External",
    items: [{ label: "Amazon Snapshot", href: "/erp/inventory/external/amazon", icon: "AM" }],
  },
];

const employeeSidebarGroups: SidebarGroup[] = [
  {
    label: "Employee",
    items: [{ label: "My Payslips", href: "/erp/my/payslips", icon: "PS" }],
  },
];

const omsSidebarGroups: SidebarGroup[] = [
  {
    label: "OMS",
    items: [
      { label: "Channels", href: "/erp/oms/channels", icon: "CH" },
      { label: "Shopify Orders", href: "/erp/oms/shopify/orders", icon: "SH" },
      { label: "Amazon Orders", href: "/erp/oms/amazon/orders", icon: "AM" },
      { label: "Myntra Orders", href: "/erp/oms/myntra/orders", icon: "MY" },
      { label: "Flipkart Orders", href: "/erp/oms/flipkart/orders", icon: "FK" },
    ],
  },
];

const moduleSidebarMap: Record<ErpModuleKey, SidebarGroup[]> = {
  workspace: workspaceSidebarGroups,
  hr: hrSidebarGroups,
  employee: employeeSidebarGroups,
  oms: omsSidebarGroups,
  admin: adminSidebarGroups,
  finance: [],
};

export default function ErpSidebar({
  activeModule,
  collapsed,
  onToggle,
}: {
  activeModule: ErpModuleKey;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const [roleKey, setRoleKey] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    (async () => {
      const context = await getCompanyContext();
      if (!active) return;
      setRoleKey(context.roleKey ?? null);
    })();

    return () => {
      active = false;
    };
  }, []);

  const groups = useMemo(() => {
    if (activeModule === "finance") {
      return getFinanceNavGroups(roleKey);
    }
    return moduleSidebarMap[activeModule];
  }, [activeModule, roleKey]);

  return (
    <aside style={{ ...sidebarStyle, width: collapsed ? 72 : 240 }} data-erp-sidebar>
      <button type="button" onClick={onToggle} style={collapseButtonStyle}>
        {collapsed ? "→" : "←"}
      </button>
      <div style={groupStackStyle}>
        {groups.map((group) => (
          <div key={group.label} style={groupStyle}>
            {!collapsed ? <div style={groupLabelStyle}>{group.label}</div> : null}
            <div style={itemStackStyle}>
              {group.items.map((item) => (
                <Link key={item.href} href={item.href} style={navItemStyle}>
                  <span style={iconBadgeStyle}>{item.icon || item.label.slice(0, 2)}</span>
                  {!collapsed ? <span>{item.label}</span> : null}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

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
