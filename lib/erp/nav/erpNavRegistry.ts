import { isAdmin, isAnalyticsReader, isInventoryWriter, isManager } from "../../erpContext";

export type ErpNavStatus = "active" | "hidden" | "deprecated";

export type ErpNavGuard =
  | "authenticated"
  | "analytics_reader"
  | "finance_reader"
  | "hr_reader"
  | "inventory_reader"
  | "admin"
  | "manager";

export type ErpNavGroupId =
  | "analytics"
  | "marketing"
  | "oms"
  | "inventory"
  | "procurement"
  | "operations"
  | "finance"
  | "hr"
  | "self-service"
  | "admin"
  | "integrations"
  | "reports"
  | "settings";

export type ErpModuleKey = "workspace" | "marketing" | "ops" | "hr" | "employee" | "finance" | "oms" | "admin";

export type ErpNavItem = {
  id: string;
  label: string;
  href: string;
  icon?: string;
  groupId: ErpNavGroupId;
  requiredGuard?: ErpNavGuard;
  status: ErpNavStatus;
  showDeprecatedInNav?: boolean;
  deprecatedTo?: string;
  description?: string;
  moduleKeys?: ErpModuleKey[];
  companyScoped?: boolean;
};

export type ErpNavGroup = {
  id: ErpNavGroupId;
  label: string;
};

const FINANCE_ROLE_KEYS = ["owner", "admin", "finance"];

const isFinanceReader = (roleKey?: string | null) =>
  Boolean(roleKey && FINANCE_ROLE_KEYS.includes(roleKey));

const isGuardAllowed = (guard: ErpNavGuard | undefined, roleKey?: string | null) => {
  if (!guard) return true;
  switch (guard) {
    case "authenticated":
      return Boolean(roleKey);
    case "analytics_reader":
      return isAnalyticsReader(roleKey);
    case "finance_reader":
      return isFinanceReader(roleKey);
    case "hr_reader":
      return isManager(roleKey);
    case "inventory_reader":
      return isInventoryWriter(roleKey);
    case "admin":
      return isAdmin(roleKey);
    case "manager":
      return isManager(roleKey);
    default:
      return false;
  }
};

export const canAccessErpNavItem = ({
  item,
  roleKey,
  companyId,
  activeModule,
  includeDeprecated = false,
}: {
  item: ErpNavItem;
  roleKey?: string | null;
  companyId?: string | null;
  activeModule?: ErpModuleKey;
  includeDeprecated?: boolean;
}) => {
  if (item.status === "hidden") return false;
  if (item.status === "deprecated" && !includeDeprecated && !item.showDeprecatedInNav) return false;
  if (item.companyScoped !== false && !companyId) return false;
  if (activeModule && item.moduleKeys && !item.moduleKeys.includes(activeModule)) return false;
  return isGuardAllowed(item.requiredGuard, roleKey);
};

const groupOrder: ErpNavGroupId[] = [
  "analytics",
  "marketing",
  "oms",
  "inventory",
  "procurement",
  "operations",
  "finance",
  "hr",
  "self-service",
  "reports",
  "integrations",
  "admin",
  "settings",
];

export const ERP_NAV_GROUPS: ErpNavGroup[] = [
  { id: "analytics", label: "Analytics" },
  { id: "marketing", label: "Marketing" },
  { id: "oms", label: "OMS / Channels" },
  { id: "inventory", label: "Inventory" },
  { id: "procurement", label: "Procurement" },
  { id: "operations", label: "Operations" },
  { id: "finance", label: "Finance" },
  { id: "hr", label: "HR" },
  { id: "self-service", label: "Self Service" },
  { id: "reports", label: "Reports" },
  { id: "integrations", label: "Integrations" },
  { id: "admin", label: "Admin" },
  { id: "settings", label: "Settings" },
];

export const ERP_NAV_ITEMS: ErpNavItem[] = [
  {
    id: "erp-home",
    label: "ERP Home",
    href: "/erp",
    icon: "ER",
    groupId: "inventory",
    requiredGuard: "authenticated",
    status: "active",
    description: "Overview of your ERP workspace.",
    moduleKeys: ["workspace"],
  },
  {
    id: "ops-dashboard",
    label: "Ops Dashboard",
    href: "/erp/ops",
    icon: "OP",
    groupId: "operations",
    requiredGuard: "authenticated",
    status: "active",
    description: "Daily operational counts and tasks.",
    moduleKeys: ["ops"],
  },
  {
    id: "inventory-products",
    label: "Products",
    href: "/erp/products",
    icon: "PR",
    groupId: "inventory",
    requiredGuard: "authenticated",
    status: "deprecated",
    deprecatedTo: "/erp/inventory/products",
    description: "Create and manage your product catalog.",
    moduleKeys: ["workspace"],
  },
  {
    id: "inventory-variants",
    label: "Variants",
    href: "/erp/variants",
    icon: "VA",
    groupId: "inventory",
    requiredGuard: "authenticated",
    status: "deprecated",
    deprecatedTo: "/erp/inventory/skus",
    description: "Organize options and product variations.",
    moduleKeys: ["workspace"],
  },
  {
    id: "inventory-home",
    label: "Inventory",
    href: "/erp/inventory",
    icon: "IN",
    groupId: "inventory",
    requiredGuard: "authenticated",
    status: "deprecated",
    deprecatedTo: "/erp/inventory/dashboard",
    description: "Track stock levels across variants.",
    moduleKeys: ["workspace"],
  },
  {
    id: "inventory-dashboard",
    label: "Dashboard",
    href: "/erp/inventory/dashboard",
    icon: "DB",
    groupId: "inventory",
    requiredGuard: "inventory_reader",
    status: "active",
    moduleKeys: ["workspace"],
  },
  {
    id: "inventory-vendors",
    label: "Vendors",
    href: "/erp/inventory/vendors",
    icon: "VE",
    groupId: "procurement",
    requiredGuard: "inventory_reader",
    status: "active",
    moduleKeys: ["workspace"],
  },
  {
    id: "vendor-readiness",
    label: "Vendor Readiness",
    href: "/erp/vendors/readiness",
    icon: "VR",
    groupId: "procurement",
    requiredGuard: "inventory_reader",
    status: "active",
    moduleKeys: ["workspace"],
  },
  {
    id: "inventory-rfqs",
    label: "RFQs",
    href: "/erp/inventory/rfqs",
    icon: "RF",
    groupId: "procurement",
    requiredGuard: "inventory_reader",
    status: "active",
    moduleKeys: ["workspace"],
  },
  {
    id: "inventory-quotes",
    label: "Quotes",
    href: "/erp/inventory/quotes",
    icon: "QT",
    groupId: "procurement",
    requiredGuard: "inventory_reader",
    status: "active",
    moduleKeys: ["workspace"],
  },
  {
    id: "inventory-purchase-orders",
    label: "Purchase Orders",
    href: "/erp/inventory/purchase-orders",
    icon: "PO",
    groupId: "procurement",
    requiredGuard: "inventory_reader",
    status: "active",
    moduleKeys: ["workspace"],
  },
  {
    id: "inventory-grns",
    label: "GRNs",
    href: "/erp/inventory/grns",
    icon: "GR",
    groupId: "procurement",
    requiredGuard: "inventory_reader",
    status: "active",
    moduleKeys: ["workspace"],
  },
  {
    id: "inventory-products-catalog",
    label: "Products",
    href: "/erp/inventory/products",
    icon: "PR",
    groupId: "inventory",
    requiredGuard: "inventory_reader",
    status: "active",
    moduleKeys: ["workspace"],
  },
  {
    id: "inventory-skus",
    label: "SKUs",
    href: "/erp/inventory/skus",
    icon: "SK",
    groupId: "inventory",
    requiredGuard: "inventory_reader",
    status: "active",
    moduleKeys: ["workspace"],
  },
  {
    id: "inventory-cost-seeds",
    label: "Cost Seeds",
    href: "/erp/inventory/cost-seeds",
    icon: "CS",
    groupId: "inventory",
    requiredGuard: "inventory_reader",
    status: "active",
    moduleKeys: ["workspace"],
  },
  {
    id: "inventory-warehouses",
    label: "Warehouses",
    href: "/erp/inventory/warehouses",
    icon: "WH",
    groupId: "inventory",
    requiredGuard: "inventory_reader",
    status: "active",
    moduleKeys: ["workspace"],
  },
  {
    id: "inventory-movements",
    label: "Stock Movements",
    href: "/erp/inventory/movements",
    icon: "SM",
    groupId: "inventory",
    requiredGuard: "inventory_reader",
    status: "active",
    moduleKeys: ["workspace"],
  },
  {
    id: "inventory-health",
    label: "Health",
    href: "/erp/inventory/health",
    icon: "HL",
    groupId: "inventory",
    requiredGuard: "inventory_reader",
    status: "active",
    moduleKeys: ["workspace"],
  },
  {
    id: "inventory-amazon-snapshot",
    label: "Marketplace Snapshot",
    href: "/erp/inventory/external/amazon",
    icon: "AM",
    groupId: "integrations",
    requiredGuard: "analytics_reader",
    status: "active",
    moduleKeys: ["workspace"],
  },
  {
    id: "analytics-amazon",
    label: "Marketplace Analytics",
    href: "/erp/analytics/amazon",
    icon: "AN",
    groupId: "analytics",
    requiredGuard: "analytics_reader",
    status: "active",
    moduleKeys: ["workspace"],
  },
  {
    id: "marketing-meta-settings",
    label: "Meta Settings",
    href: "/app/marketing/meta-settings",
    icon: "MT",
    groupId: "marketing",
    requiredGuard: "manager",
    status: "active",
    moduleKeys: ["marketing"],
  },
  {
    id: "marketing-capi-events",
    label: "CAPI Events",
    href: "/app/marketing/capi-events",
    icon: "CE",
    groupId: "marketing",
    requiredGuard: "manager",
    status: "active",
    moduleKeys: ["marketing"],
  },
  {
    id: "marketing-audiences",
    label: "Audiences",
    href: "/erp/marketing/audiences",
    icon: "AU",
    groupId: "marketing",
    requiredGuard: "manager",
    status: "active",
    moduleKeys: ["marketing"],
  },
  {
    id: "marketing-intelligence-growth-cockpit",
    label: "Growth Cockpit",
    href: "/erp/marketing/intelligence/growth-cockpit",
    icon: "GC",
    groupId: "marketing",
    requiredGuard: "manager",
    status: "active",
    moduleKeys: ["marketing"],
  },
  {
    id: "marketing-intelligence-demand-steering",
    label: "Demand Steering",
    href: "/erp/marketing/intelligence/demand-steering",
    icon: "DS",
    groupId: "marketing",
    requiredGuard: "manager",
    status: "active",
    moduleKeys: ["marketing"],
  },
  {
    id: "marketing-intelligence-budget-allocator",
    label: "Budget Allocator",
    href: "/erp/marketing/intelligence/budget-allocator",
    icon: "BA",
    groupId: "marketing",
    requiredGuard: "manager",
    status: "active",
    moduleKeys: ["marketing"],
  },
  {
    id: "marketing-intelligence-amazon-alerts",
    label: "Amazon Alerts",
    href: "/erp/marketing/intelligence/amazon-alerts",
    icon: "AA",
    groupId: "marketing",
    requiredGuard: "manager",
    status: "active",
    moduleKeys: ["marketing"],
  },
  {
    id: "marketing-intelligence-audience-exports",
    label: "Audience Exports",
    href: "/erp/marketing/intelligence/audiences",
    icon: "AX",
    groupId: "marketing",
    requiredGuard: "manager",
    status: "active",
    moduleKeys: ["marketing"],
  },
  {
    id: "oms-channels",
    label: "Channels",
    href: "/erp/oms/channels",
    icon: "CH",
    groupId: "oms",
    requiredGuard: "manager",
    status: "active",
    moduleKeys: ["oms"],
  },
  {
    id: "oms-shopify-orders",
    label: "Store Orders",
    href: "/erp/oms/shopify/orders",
    icon: "SH",
    groupId: "oms",
    requiredGuard: "manager",
    status: "active",
    moduleKeys: ["oms"],
  },
  {
    id: "oms-sync-backfill",
    label: "Sync / Backfill",
    href: "/erp/finance/shopify-sync",
    icon: "SY",
    groupId: "oms",
    requiredGuard: "manager",
    status: "deprecated",
    deprecatedTo: "/erp/oms/shopify/orders",
    description: "Backfill store orders into the ERP ledger.",
    moduleKeys: ["oms"],
  },
  {
    id: "oms-amazon-orders",
    label: "Orders (Marketplace)",
    href: "/erp/oms/amazon/orders",
    icon: "AM",
    groupId: "oms",
    requiredGuard: "manager",
    status: "active",
    moduleKeys: ["oms"],
  },
  {
    id: "oms-myntra-orders",
    label: "Myntra Orders",
    href: "/erp/oms/myntra/orders",
    icon: "MY",
    groupId: "oms",
    requiredGuard: "manager",
    status: "active",
    moduleKeys: ["oms"],
  },
  {
    id: "oms-flipkart-orders",
    label: "Flipkart Orders",
    href: "/erp/oms/flipkart/orders",
    icon: "FK",
    groupId: "oms",
    requiredGuard: "manager",
    status: "active",
    moduleKeys: ["oms"],
  },
  {
    id: "finance-home",
    label: "Finance Home",
    href: "/erp/finance",
    icon: "FI",
    groupId: "finance",
    requiredGuard: "finance_reader",
    status: "active",
    moduleKeys: ["finance"],
  },
  {
    id: "finance-invoices",
    label: "Invoices",
    href: "/erp/finance/invoices",
    icon: "IN",
    groupId: "finance",
    requiredGuard: "finance_reader",
    status: "active",
    moduleKeys: ["finance"],
  },
  {
    id: "finance-notes",
    label: "Credit / Debit Notes",
    href: "/erp/finance/notes",
    icon: "NT",
    groupId: "finance",
    requiredGuard: "finance_reader",
    status: "active",
    moduleKeys: ["finance"],
  },
  {
    id: "finance-expenses",
    label: "Expenses",
    href: "/erp/finance/expenses",
    icon: "EX",
    groupId: "finance",
    requiredGuard: "finance_reader",
    status: "active",
    moduleKeys: ["finance"],
  },
  {
    id: "finance-recurring-expenses",
    label: "Recurring Expenses",
    href: "/erp/finance/expenses/recurring",
    icon: "RE",
    groupId: "finance",
    requiredGuard: "finance_reader",
    status: "active",
    moduleKeys: ["finance"],
  },
  {
    id: "finance-ap-outstanding",
    label: "AP Outstanding",
    href: "/erp/finance/ap/outstanding",
    icon: "AP",
    groupId: "finance",
    requiredGuard: "finance_reader",
    status: "active",
    moduleKeys: ["finance"],
  },
  {
    id: "finance-ap-vendor-advances",
    label: "Vendor Advances",
    href: "/erp/finance/ap/vendor-advances",
    icon: "VA",
    groupId: "finance",
    requiredGuard: "finance_reader",
    status: "active",
    moduleKeys: ["finance"],
  },
  {
    id: "finance-recon",
    label: "Recon Dashboard",
    href: "/erp/finance/recon",
    icon: "RC",
    groupId: "finance",
    requiredGuard: "finance_reader",
    status: "active",
    moduleKeys: ["finance"],
  },
  {
    id: "finance-vendor-payments",
    label: "Vendor Payments",
    href: "/erp/finance/vendor-payments",
    icon: "VP",
    groupId: "finance",
    requiredGuard: "finance_reader",
    status: "active",
    moduleKeys: ["finance"],
  },
  {
    id: "finance-vendor-ledger",
    label: "Vendor Ledger",
    href: "/erp/finance/ap/vendor-ledger",
    icon: "VL",
    groupId: "finance",
    requiredGuard: "finance_reader",
    status: "active",
    moduleKeys: ["finance"],
  },
  {
    id: "finance-report-trial-balance",
    label: "Trial Balance",
    href: "/erp/finance/reports/trial-balance",
    icon: "TB",
    groupId: "reports",
    requiredGuard: "finance_reader",
    status: "active",
    description: "Summarize debits and credits across accounts.",
    moduleKeys: ["finance"],
  },
  {
    id: "finance-report-account-ledger",
    label: "Account Ledger",
    href: "/erp/finance/reports/account-ledger",
    icon: "AL",
    groupId: "reports",
    requiredGuard: "finance_reader",
    status: "active",
    description: "Review ledger movements for a single account.",
    moduleKeys: ["finance"],
  },
  {
    id: "finance-expense-reports",
    label: "Expense Reports",
    href: "/erp/finance/expenses/reports",
    icon: "ER",
    groupId: "finance",
    requiredGuard: "finance_reader",
    status: "active",
    moduleKeys: ["finance"],
  },
  {
    id: "finance-bridge",
    label: "Finance Bridge",
    href: "/erp/finance/bridge",
    icon: "FB",
    groupId: "finance",
    requiredGuard: "finance_reader",
    status: "active",
    moduleKeys: ["finance"],
  },
  {
    id: "finance-gst",
    label: "GST (Shop)",
    href: "/erp/finance/gst",
    icon: "GS",
    groupId: "finance",
    requiredGuard: "finance_reader",
    status: "active",
    moduleKeys: ["finance"],
  },
  {
    id: "finance-gst-sku-master",
    label: "SKU Master",
    href: "/erp/finance/gst/sku-master",
    icon: "SM",
    groupId: "finance",
    requiredGuard: "finance_reader",
    status: "active",
    moduleKeys: ["finance"],
  },
  {
    id: "finance-gst-purchases",
    label: "Purchases",
    href: "/erp/finance/gst/purchases",
    icon: "PU",
    groupId: "finance",
    requiredGuard: "finance_reader",
    status: "active",
    moduleKeys: ["finance"],
  },
  {
    id: "finance-marketplace-margin",
    label: "Marketplace Margin",
    href: "/erp/finance/marketplace-margin",
    icon: "MM",
    groupId: "finance",
    requiredGuard: "finance_reader",
    status: "active",
    moduleKeys: ["finance"],
  },
  {
    id: "finance-amazon-settlement-posting",
    label: "Amazon Settlement Posting",
    href: "/erp/finance/amazon/settlement-posting",
    icon: "AP",
    groupId: "finance",
    requiredGuard: "finance_reader",
    status: "active",
    moduleKeys: ["finance"],
  },
  {
    id: "finance-amazon-settlements",
    label: "Amazon Payouts",
    href: "/erp/finance/amazon/payouts",
    icon: "AS",
    groupId: "finance",
    requiredGuard: "finance_reader",
    status: "active",
    moduleKeys: ["finance"],
  },
  {
    id: "finance-bank-import",
    label: "Bank Import",
    href: "/erp/finance/bank/import",
    icon: "BI",
    groupId: "finance",
    requiredGuard: "finance_reader",
    status: "active",
    moduleKeys: ["finance"],
  },
  {
    id: "finance-gl-accounts",
    label: "Chart of Accounts",
    href: "/erp/finance/masters/gl-accounts",
    icon: "CO",
    groupId: "finance",
    requiredGuard: "finance_reader",
    status: "active",
    moduleKeys: ["finance"],
  },
  {
    id: "finance-coa-control-roles",
    label: "COA Control Roles",
    href: "/erp/finance/settings/coa-roles",
    icon: "CR",
    groupId: "finance",
    requiredGuard: "finance_reader",
    status: "active",
    moduleKeys: ["finance"],
  },
  {
    id: "hr-home",
    label: "HR Home",
    href: "/erp/hr",
    icon: "HR",
    groupId: "hr",
    requiredGuard: "hr_reader",
    status: "active",
    moduleKeys: ["hr"],
  },
  {
    id: "hr-masters",
    label: "HR Masters",
    href: "/erp/hr/masters",
    icon: "DE",
    groupId: "hr",
    requiredGuard: "hr_reader",
    status: "active",
    moduleKeys: ["hr"],
  },
  {
    id: "hr-rbac-designations",
    label: "Designation Access",
    href: "/erp/hr/rbac/designations",
    icon: "RA",
    groupId: "hr",
    requiredGuard: "hr_reader",
    status: "active",
    moduleKeys: ["hr"],
  },
  {
    id: "hr-employees",
    label: "Employees",
    href: "/erp/hr/employees",
    icon: "EM",
    groupId: "hr",
    requiredGuard: "hr_reader",
    status: "active",
    moduleKeys: ["hr"],
  },
  {
    id: "hr-leave-types",
    label: "Leave Types",
    href: "/erp/hr/leaves/types",
    icon: "LV",
    groupId: "hr",
    requiredGuard: "hr_reader",
    status: "active",
    moduleKeys: ["hr"],
  },
  {
    id: "hr-leave-requests",
    label: "Leave Requests",
    href: "/erp/hr/leaves/requests",
    icon: "LR",
    groupId: "hr",
    requiredGuard: "hr_reader",
    status: "active",
    moduleKeys: ["hr"],
  },
  {
    id: "hr-attendance",
    label: "Attendance",
    href: "/erp/hr/attendance",
    icon: "AT",
    groupId: "hr",
    requiredGuard: "hr_reader",
    status: "active",
    moduleKeys: ["hr"],
  },
  {
    id: "hr-calendars",
    label: "Calendars",
    href: "/erp/hr/calendars",
    icon: "CA",
    groupId: "hr",
    requiredGuard: "hr_reader",
    status: "active",
    moduleKeys: ["hr"],
  },
  {
    id: "hr-employee-exits",
    label: "Employee Exits",
    href: "/erp/hr/exits",
    icon: "EX",
    groupId: "hr",
    requiredGuard: "hr_reader",
    status: "active",
    moduleKeys: ["hr"],
  },
  {
    id: "hr-final-settlements",
    label: "Final Settlements",
    href: "/erp/hr/final-settlements",
    icon: "FS",
    groupId: "hr",
    requiredGuard: "hr_reader",
    status: "active",
    moduleKeys: ["hr"],
  },
  {
    id: "hr-weekly-off",
    label: "Weekly Off Rules",
    href: "/erp/hr/weekly-off",
    icon: "WO",
    groupId: "hr",
    requiredGuard: "hr_reader",
    status: "active",
    moduleKeys: ["hr"],
  },
  {
    id: "hr-salary-structures",
    label: "Salary Structures",
    href: "/erp/hr/salary",
    icon: "SS",
    groupId: "hr",
    requiredGuard: "hr_reader",
    status: "active",
    moduleKeys: ["hr"],
  },
  {
    id: "hr-payroll",
    label: "Payroll",
    href: "/erp/hr/payroll/runs",
    icon: "PR",
    groupId: "hr",
    requiredGuard: "hr_reader",
    status: "active",
    moduleKeys: ["hr"],
  },
  {
    id: "hr-self-service-payslips",
    label: "Payslips",
    href: "/erp/hr/self-service/payslips",
    icon: "PS",
    groupId: "self-service",
    requiredGuard: "authenticated",
    status: "active",
    moduleKeys: ["hr"],
    description: "Review your personal payslips and downloads.",
  },
  {
    id: "hr-report-attendance-summary",
    label: "Attendance → Payroll Summary",
    href: "/erp/hr/reports/attendance-payroll-summary",
    icon: "PS",
    groupId: "reports",
    requiredGuard: "hr_reader",
    status: "active",
    moduleKeys: ["hr"],
  },
  {
    id: "hr-report-attendance-exceptions",
    label: "Attendance Exceptions",
    href: "/erp/hr/reports/attendance-exceptions",
    icon: "EX",
    groupId: "reports",
    requiredGuard: "hr_reader",
    status: "active",
    moduleKeys: ["hr"],
  },
  {
    id: "hr-report-attendance-register",
    label: "Attendance Register",
    href: "/erp/hr/reports/attendance-register",
    icon: "AR",
    groupId: "reports",
    requiredGuard: "hr_reader",
    status: "active",
    moduleKeys: ["hr"],
  },
  {
    id: "employee-payslips",
    label: "My Payslips",
    href: "/erp/my/payslips",
    icon: "PS",
    groupId: "hr",
    requiredGuard: "authenticated",
    status: "active",
    moduleKeys: ["employee"],
    description: "View your finalized payslips and downloads.",
  },
  {
    id: "admin-company-users",
    label: "Company Users",
    href: "/erp/admin/company-users",
    icon: "CU",
    groupId: "admin",
    requiredGuard: "admin",
    status: "active",
    moduleKeys: ["admin"],
  },
  {
    id: "admin-route-diagnostics",
    label: "Route Diagnostics",
    href: "/erp/admin/diagnostics/route-hits",
    icon: "RD",
    groupId: "admin",
    requiredGuard: "admin",
    status: "hidden",
    moduleKeys: ["admin"],
  },
  {
    id: "settings-finance",
    label: "Finance Settings",
    href: "/erp/finance/settings",
    icon: "FI",
    groupId: "settings",
    requiredGuard: "finance_reader",
    status: "active",
  },
  {
    id: "settings-company",
    label: "Company Settings",
    href: "/erp/company/settings",
    icon: "CS",
    groupId: "settings",
    requiredGuard: "admin",
    status: "active",
  },
];

export type ErpNavContext = {
  roleKey?: string | null;
  companyId?: string | null;
  activeModule: ErpModuleKey;
};

export type ErpNavGroupWithItems = {
  label: string;
  items: ErpNavItem[];
};

export const getErpNavGroups = ({
  roleKey,
  companyId,
  activeModule,
}: ErpNavContext): ErpNavGroupWithItems[] => {
  const items = ERP_NAV_ITEMS.filter((item) =>
    canAccessErpNavItem({ item, roleKey, companyId, activeModule })
  );

  const groupsWithItems = ERP_NAV_GROUPS.map((group) => ({
    label: group.label,
    items: items.filter((item) => item.groupId === group.id),
  })).filter((group) => group.items.length > 0);

  groupsWithItems.sort(
    (a, b) => groupOrder.indexOf(a.items[0].groupId) - groupOrder.indexOf(b.items[0].groupId)
  );

  return groupsWithItems;
};

export const getAccessibleErpNavItems = ({
  roleKey,
  companyId,
  activeModule,
  includeDeprecated,
}: {
  roleKey?: string | null;
  companyId?: string | null;
  activeModule?: ErpModuleKey;
  includeDeprecated?: boolean;
}) =>
  ERP_NAV_ITEMS.filter((item) =>
    canAccessErpNavItem({ item, roleKey, companyId, activeModule, includeDeprecated })
  );
