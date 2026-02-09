import { ERP_NAV_ITEMS, type ErpNavItem, type ErpNavGroupId } from "./erpNavRegistry";

export type CommandPaletteGroup =
  | "Inventory"
  | "Finance"
  | "HR"
  | "Ops"
  | "MFG"
  | "Analytics"
  | "Marketing";

export type CommandPaletteRoute = {
  id: string;
  title: string;
  href: string;
  group: CommandPaletteGroup;
  keywords: string[];
  icon?: string;
};

const groupMap: Partial<Record<ErpNavGroupId, CommandPaletteGroup>> = {
  inventory: "Inventory",
  procurement: "Inventory",
  finance: "Finance",
  hr: "HR",
  "self-service": "HR",
  operations: "Ops",
  oms: "Ops",
  analytics: "Analytics",
  marketing: "Marketing",
  reports: "Analytics",
  integrations: "Analytics",
};

const extraRoutes: CommandPaletteRoute[] = [
  {
    id: "mfg-plan",
    title: "MFG Plan",
    href: "/mfg/plan",
    group: "MFG",
    icon: "MF",
    keywords: ["mfg", "manufacturing", "plan", "production"],
  },
  {
    id: "mfg-bom",
    title: "MFG BOM",
    href: "/mfg/bom",
    group: "MFG",
    icon: "BM",
    keywords: ["mfg", "bom", "bill of materials"],
  },
  {
    id: "mfg-asn",
    title: "MFG ASN",
    href: "/mfg/asn",
    group: "MFG",
    icon: "AS",
    keywords: ["mfg", "asn", "advanced shipment"],
  },
  {
    id: "mfg-materials",
    title: "MFG Materials",
    href: "/mfg/materials",
    group: "MFG",
    icon: "MT",
    keywords: ["mfg", "materials", "raw", "inventory"],
  },
  {
    id: "mfg-performance",
    title: "MFG Performance",
    href: "/mfg/performance",
    group: "MFG",
    icon: "PF",
    keywords: ["mfg", "performance", "vendor"],
  },
];

const navRoutes: CommandPaletteRoute[] = ERP_NAV_ITEMS.filter(
  (item) => item.status === "active" && groupMap[item.groupId]
).map((item: ErpNavItem) => ({
  id: item.id,
  title: item.label,
  href: item.href,
  group: groupMap[item.groupId] as CommandPaletteGroup,
  icon: item.icon,
  keywords: [item.label, item.groupId, ...(item.description ? [item.description] : [])]
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean),
}));

export const COMMAND_PALETTE_ROUTES: CommandPaletteRoute[] = [...navRoutes, ...extraRoutes].filter(
  (route, index, all) => all.findIndex((entry) => entry.href === route.href) === index
);
