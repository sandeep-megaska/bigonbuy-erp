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
    id: "finance",
    label: "Finance",
    href: "/erp/finance",
    section: "Finance",
    description: "Track expenses, categories, and spend totals.",
    access: "manager",
  },
  {
    id: "company-users",
    label: "Company Users",
    href: "/erp/admin/company-users",
    section: "Admin",
    description: "Invite staff, assign roles, and manage access.",
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
