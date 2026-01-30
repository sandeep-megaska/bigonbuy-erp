import type { Session } from "@supabase/supabase-js";
import { supabase } from "../supabaseClient";

export type NavAccess = "publicAuth" | "manager" | "adminHR";

export type NavItem = {
  id: string;
  label: string;
  href: string;
  section: string;
  description?: string;
  access: NavAccess;
};

export type ErpAccessState = {
  isAuthenticated: boolean;
  isManager: boolean;
  roleKey?: string | null;
};

// When adding a new module, add one item to ERP_NAV and it will show in the sidebar + ERP home.
export const ERP_NAV: NavItem[] = [
  {
    id: "erp-home",
    label: "ERP Home",
    href: "/erp",
    section: "Workspace",
    description: "Overview of your ERP workspace.",
    access: "publicAuth",
  },
  {
    id: "products",
    label: "Products",
    href: "/erp/products",
    section: "Workspace",
    description: "Create and manage your product catalog.",
    access: "publicAuth",
  },
  {
    id: "variants",
    label: "Variants",
    href: "/erp/variants",
    section: "Workspace",
    description: "Organize options and product variations.",
    access: "publicAuth",
  },
  {
    id: "inventory",
    label: "Inventory",
    href: "/erp/inventory",
    section: "Workspace",
    description: "Track stock levels across variants.",
    access: "publicAuth",
  },
  {
    id: "hr-home",
    label: "Human Resources",
    href: "/erp/hr",
    section: "HR",
    description: "Employees, salary, leave, and payroll.",
    access: "manager",
  },
  {
    id: "hr-masters",
    label: "HR Masters",
    href: "/erp/hr/masters",
    section: "HR",
    description: "Departments, job titles, locations, and employment types.",
    access: "manager",
  },
  {
    id: "hr-employees",
    label: "Employees",
    href: "/erp/hr/employees",
    section: "HR",
    description: "Employee directory and profiles.",
    access: "manager",
  },
  {
    id: "hr-leave-types",
    label: "Leave Types",
    href: "/erp/hr/leaves/types",
    section: "HR",
    description: "Configure leave types and policies.",
    access: "manager",
  },
  {
    id: "hr-leave-requests",
    label: "Leave Requests",
    href: "/erp/hr/leaves/requests",
    section: "HR",
    description: "Review and approve leave requests.",
    access: "manager",
  },
  {
    id: "hr-attendance",
    label: "Attendance",
    href: "/erp/hr/attendance",
    section: "HR",
    description: "Mark and review attendance days.",
    access: "manager",
  },
  {
    id: "hr-calendars",
    label: "Calendars",
    href: "/erp/hr/calendars",
    section: "HR",
    description: "Manage attendance calendars and holidays.",
    access: "manager",
  },
  {
    id: "hr-report-attendance-summary",
    label: "Attendance → Payroll Summary",
    href: "/erp/hr/reports/attendance-payroll-summary",
    section: "HR Reports",
    description: "Align attendance totals with payroll runs.",
    access: "manager",
  },
  {
    id: "hr-report-attendance-exceptions",
    label: "Attendance Exceptions",
    href: "/erp/hr/reports/attendance-exceptions",
    section: "HR Reports",
    description: "Flag payroll and attendance mismatches.",
    access: "manager",
  },
  {
    id: "hr-report-attendance-register",
    label: "Attendance Register",
    href: "/erp/hr/reports/attendance-register",
    section: "HR Reports",
    description: "Daily attendance register for HR audits.",
    access: "manager",
  },
  {
    id: "my-payslips",
    label: "Payslips",
    href: "/erp/hr/self-service/payslips",
    section: "Self Service",
    description: "View your finalized payslips and downloads.",
    access: "publicAuth",
  },
  {
    id: "finance",
    label: "Finance",
    href: "/erp/finance",
    section: "Finance",
    description: "Track expenses, categories, and spend totals.",
    access: "manager",
  },
  {
    id: "oms-channels",
    label: "Channels",
    href: "/erp/oms/channels",
    section: "OMS",
    description: "Configure marketplace and store channels.",
    access: "manager",
  },
  {
    id: "oms-orders",
    label: "Orders",
    href: "/erp/oms/orders",
    section: "OMS",
    description: "Review OMS orders and inventory actions.",
    access: "manager",
  },
  {
    id: "oms-shopify-orders",
    label: "Shopify Orders",
    href: "/erp/oms/shopify/orders",
    section: "OMS",
    description: "Review Shopify orders synced into OMS.",
    access: "manager",
  },
  {
    id: "oms-shopify-sync",
    label: "Sync / Backfill",
    href: "/erp/finance/shopify-sync",
    section: "OMS",
    description: "Backfill Shopify orders into the ERP ledger.",
    access: "manager",
  },
  {
    id: "oms-amazon-orders",
    label: "Amazon Orders",
    href: "/erp/oms/amazon/orders",
    section: "OMS",
    description: "Amazon OMS orders (reports-backed).",
    access: "manager",
  },
  {
    id: "analytics-amazon",
    label: "Amazon Analytics",
    href: "/erp/analytics/amazon",
    section: "Analytics",
    description: "Sales, geo, and cohort analytics from Amazon reports.",
    access: "manager",
  },
  {
    id: "oms-myntra-orders",
    label: "Myntra Orders",
    href: "/erp/oms/myntra/orders",
    section: "OMS",
    description: "Myntra OMS orders (coming soon).",
    access: "manager",
  },
  {
    id: "oms-flipkart-orders",
    label: "Flipkart Orders",
    href: "/erp/oms/flipkart/orders",
    section: "OMS",
    description: "Flipkart OMS orders (coming soon).",
    access: "manager",
  },
  {
    id: "company-users",
    label: "Users & Access",
    href: "/erp/admin/company-users",
    section: "Company",
    description: "Invite staff, assign roles, and manage access.",
    access: "adminHR",
  },
  {
    id: "company-settings",
    label: "Company Settings",
    href: "/erp/admin/company-settings",
    section: "Company",
    description: "Branding, organization details, and setup checklist.",
    access: "adminHR",
  },
];

export function isNavItemAllowed(item: NavItem, access: ErpAccessState): boolean {
  switch (item.access) {
    case "publicAuth":
      return access.isAuthenticated;
    case "manager":
    case "adminHR":
      return access.isManager;
    default:
      return false;
  }
}

export async function getCurrentErpAccess(
  existingSession?: Session | null
): Promise<ErpAccessState> {
  const session = existingSession ?? (await supabase.auth.getSession()).data?.session ?? null;
  if (!session) {
    return { isAuthenticated: false, isManager: false, roleKey: undefined };
  }

  const userId = session.user.id;

  const [{ data: membership, error: membershipError }, { data: rpcIsManager, error: rpcError }] =
    await Promise.all([
      supabase
        .from("erp_company_users")
        .select("role_key, is_active")
        .eq("user_id", userId)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle(),
      supabase.rpc("is_erp_manager", { uid: userId }),
    ]);

  if (membershipError) {
    console.error("Failed to load ERP membership", membershipError.message);
  }

  if (rpcError) {
    console.error("Failed to resolve ERP access", rpcError.message);
  }

  return {
    isAuthenticated: true,
    isManager: Boolean(rpcIsManager),
    roleKey: membership?.role_key ?? undefined,
  };
}
