import type { NextApiRequest, NextApiResponse } from "next";
import { getEmployeeSession } from "../../../../lib/erp/employeeAuth";
import { createServiceRoleClient, getSupabaseEnv } from "../../../../lib/serverSupabase";

type PermissionRow = {
  perm_key?: string | null;
  module_key?: string | null;
};

type ModuleLink = {
  id: string;
  title: string;
  href: string;
  description: string;
};

type ModulePayload = {
  module_key: string;
  title: string;
  links: ModuleLink[];
};

type ModulesResponse =
  | {
      ok: true;
      permissions: { perm_key: string; module_key: string }[];
      modules: ModulePayload[];
    }
  | { ok: false; error: string };

const SELF_SERVICE_LINKS: Record<string, ModuleLink> = {
  hr_self_profile: {
    id: "employee-profile",
    title: "My Profile",
    href: "/erp/employee/profile",
    description: "View your personal and job details.",
  },
  hr_self_leave: {
    id: "employee-leaves",
    title: "Leave Requests",
    href: "/erp/employee/leaves",
    description: "Submit and track leave applications.",
  },
  hr_self_attendance: {
    id: "employee-attendance",
    title: "Attendance",
    href: "/erp/employee/attendance",
    description: "Review your attendance history.",
  },
  hr_self_exit: {
    id: "employee-exit",
    title: "Exit / Resignation",
    href: "/erp/employee/exit",
    description: "Submit an exit request for HR approval.",
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<ModulesResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  res.setHeader("Cache-Control", "no-store, max-age=0");

  const session = await getEmployeeSession(req);
  if (!session) {
    console.warn("Employee modules: missing session");
    return res.status(401).json({ ok: false, error: "not_authenticated" });
  }

  const { supabaseUrl, serviceRoleKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !serviceRoleKey || missing.length > 0) {
    return res.status(500).json({
      ok: false,
      error:
        "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const adminClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await adminClient.rpc("erp_employee_permissions_get_v2", {
    p_company_id: session.company_id,
    p_employee_id: session.employee_id,
  });

  if (error) {
    console.warn("Employee modules: permissions resolve failed", error.message);
    return res.status(500).json({ ok: false, error: "permissions_resolve_failed" });
  }

  const rows = Array.isArray(data) ? (data as PermissionRow[]) : [];
  const permissions = rows
    .map((row) => {
      const permKey = String(row.perm_key ?? "").trim();
      const moduleKey = String(row.module_key ?? "")
        .trim()
        .replace(/-/g, "_")
        .toLowerCase();
      return { perm_key: permKey, module_key: moduleKey };
    })
    .filter((row) => row.perm_key && row.module_key);

  const permissionKeys = new Set(permissions.map((permission) => permission.perm_key));

  const modules: ModulePayload[] = [];

  const selfServiceLinks = Object.entries(SELF_SERVICE_LINKS)
    .filter(([permKey]) => permissionKeys.has(permKey))
    .map(([, link]) => link);
  if (selfServiceLinks.length > 0) {
    modules.push({
      module_key: "self_service",
      title: "Self Service",
      links: selfServiceLinks,
    });
  }

  const hasInventoryRead = permissionKeys.has("inventory_read");
  const hasInventoryWrite = permissionKeys.has("inventory_write");
  const hasInventoryStocktake = permissionKeys.has("inventory_stocktake");
  const hasInventoryTransfer = permissionKeys.has("inventory_transfer");

  if (hasInventoryRead || hasInventoryWrite || hasInventoryStocktake || hasInventoryTransfer) {
    const inventoryLinks: ModuleLink[] = [];
    if (hasInventoryRead || hasInventoryWrite) {
      inventoryLinks.push({
        id: "inventory-home",
        title: "Inventory",
        href: "/erp/inventory",
        description: "Track stock levels across variants.",
      });
    }
    if (hasInventoryStocktake) {
      inventoryLinks.push({
        id: "inventory-stocktake",
        title: "Stocktakes",
        href: "/erp/inventory/stocktakes",
        description: "Plan and reconcile stocktake cycles.",
      });
    }
    if (hasInventoryTransfer) {
      inventoryLinks.push({
        id: "inventory-transfers",
        title: "Transfers",
        href: "/erp/inventory/transfers",
        description: "Move inventory between locations.",
      });
    }
    modules.push({
      module_key: "inventory",
      title: "Inventory",
      links: inventoryLinks,
    });
  }

  return res.status(200).json({ ok: true, permissions, modules });
}
