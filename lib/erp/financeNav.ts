export type FinanceNavItem = {
  id: string;
  label: string;
  href: string;
  description?: string;
  group: string;
  roles?: string[];
  sidebarIcon?: string;
  cardIcon?: string;
  showInSidebar?: boolean;
  showInCards?: boolean;
};

type FinanceNavGroup = {
  label: string;
  items: { label: string; href: string; icon?: string }[];
};

const FINANCE_ROLE_KEYS = ["owner", "admin", "finance"];

const FINANCE_NAV_ITEMS: FinanceNavItem[] = [
  {
    id: "finance-home",
    label: "Finance Home",
    href: "/erp/finance",
    description: "Track spend, categories, and simple month totals.",
    group: "Finance",
    sidebarIcon: "FI",
    cardIcon: "🏦",
    showInSidebar: true,
    showInCards: false,
  },
  {
    id: "finance-invoices",
    label: "Invoices",
    href: "/erp/finance/invoices",
    description: "Create draft invoices and issue FY-based document numbers.",
    group: "Finance",
    sidebarIcon: "IN",
    cardIcon: "🧾",
    showInSidebar: true,
    showInCards: true,
  },
  {
    id: "finance-notes",
    label: "Credit / Debit Notes",
    href: "/erp/finance/notes",
    description: "Issue customer and vendor credit/debit notes.",
    group: "Finance",
    sidebarIcon: "NT",
    cardIcon: "📝",
    showInSidebar: true,
    showInCards: true,
  },
  {
    id: "finance-expenses",
    label: "Expenses",
    href: "/erp/finance/expenses",
    description: "Record expenses, categories, and monthly totals.",
    group: "Finance",
    sidebarIcon: "EX",
    cardIcon: "🧾",
    showInSidebar: true,
    showInCards: true,
  },
  {
    id: "finance-recurring-expenses",
    label: "Recurring Expenses",
    href: "/erp/finance/expenses/recurring",
    description: "Template recurring expense records and auto-generate runs.",
    group: "Finance",
    sidebarIcon: "RE",
    cardIcon: "🔁",
    showInSidebar: true,
    showInCards: false,
  },
  {
    id: "finance-ap-outstanding",
    label: "AP Outstanding",
    href: "/erp/finance/ap/outstanding",
    description: "Review vendor outstanding balances and aging buckets.",
    group: "Finance",
    sidebarIcon: "AP",
    cardIcon: "🧾",
    showInSidebar: true,
    showInCards: false,
  },
  {
    id: "finance-ap-payments",
    label: "AP Payments",
    href: "/erp/finance/ap/payments",
    description: "Record and manage vendor payments.",
    group: "Finance",
    sidebarIcon: "PY",
    cardIcon: "💸",
    showInSidebar: true,
    showInCards: false,
  },
  {
    id: "finance-expense-reports",
    label: "Expense Reports",
    href: "/erp/finance/expenses/reports",
    description: "Analyze expense totals by vendor, category, or month.",
    group: "Finance",
    sidebarIcon: "ER",
    cardIcon: "📈",
    showInSidebar: true,
    showInCards: false,
  },
  {
    id: "finance-bridge",
    label: "Finance Bridge",
    href: "/erp/finance/bridge",
    description: "Inventory + GRN exports ready for CA/GST review.",
    group: "Finance",
    sidebarIcon: "FB",
    cardIcon: "🧩",
    showInSidebar: true,
    showInCards: true,
  },
  {
    id: "finance-shopify-sync",
    label: "Shopify Sync",
    href: "/erp/finance/shopify-sync",
    description: "Backfill Shopify orders into the ERP ledger.",
    group: "Finance",
    sidebarIcon: "SS",
    cardIcon: "🛒",
    showInSidebar: false,
    showInCards: true,
  },
  {
    id: "finance-gst",
    label: "GST (Shopify)",
    href: "/erp/finance/gst",
    description: "Generate GST register rows and export reports.",
    group: "GST",
    roles: FINANCE_ROLE_KEYS,
    sidebarIcon: "GS",
    cardIcon: "🧾",
    showInSidebar: true,
    showInCards: true,
  },
  {
    id: "finance-gst-sku-master",
    label: "SKU Master",
    href: "/erp/finance/gst/sku-master",
    description: "Maintain style → HSN + GST rate mappings.",
    group: "GST",
    roles: FINANCE_ROLE_KEYS,
    sidebarIcon: "SM",
    cardIcon: "🏷️",
    showInSidebar: true,
    showInCards: false,
  },
  {
    id: "finance-gst-purchases",
    label: "Purchases",
    href: "/erp/finance/gst/purchases",
    description: "Import vendor GST invoices and export purchase registers.",
    group: "GST",
    roles: FINANCE_ROLE_KEYS,
    sidebarIcon: "PU",
    cardIcon: "🧾",
    showInSidebar: true,
    showInCards: true,
  },
  {
    id: "finance-marketplace-margin",
    label: "Marketplace Margin",
    href: "/erp/finance/marketplace-margin",
    description: "Upload settlement files and analyze SKU/order profitability.",
    group: "Finance",
    sidebarIcon: "MM",
    cardIcon: "📊",
    showInSidebar: true,
    showInCards: true,
  },
  {
    id: "finance-settlements",
    label: "Settlements",
    href: "/erp/finance/settlements",
    description: "Reconcile Amazon settlements through Indifi to bank credits.",
    group: "Finance",
    sidebarIcon: "ST",
    cardIcon: "🧾",
    showInSidebar: false,
    showInCards: true,
  },
];

const isRoleAllowed = (item: FinanceNavItem, roleKey?: string | null) =>
  !item.roles || Boolean(roleKey && item.roles.includes(roleKey));

export const getFinanceNavGroups = (roleKey?: string | null): FinanceNavGroup[] => {
  const groups: FinanceNavGroup[] = [];

  FINANCE_NAV_ITEMS.forEach((item) => {
    if (!item.showInSidebar || !isRoleAllowed(item, roleKey)) {
      return;
    }

    const existing = groups.find((group) => group.label === item.group);
    const target = existing || { label: item.group, items: [] };
    if (!existing) {
      groups.push(target);
    }
    target.items.push({ label: item.label, href: item.href, icon: item.sidebarIcon });
  });

  return groups;
};

export const getFinanceNavCards = (roleKey?: string | null) =>
  FINANCE_NAV_ITEMS.filter((item) => item.showInCards && isRoleAllowed(item, roleKey)).map(
    (item) => ({
      title: item.label,
      description: item.description ?? "",
      href: item.href,
      icon: item.cardIcon ?? item.sidebarIcon ?? "•",
    })
  );
