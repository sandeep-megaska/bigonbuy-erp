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

type FinanceGlobalSettingsItem = {
  label: string;
  href?: string;
  icon?: string;
  roles?: string[];
  disabled?: boolean;
};

const FINANCE_ROLE_KEYS = ["owner", "admin", "finance"];

const FINANCE_NAV_ITEMS: FinanceNavItem[] = [
  {
    id: "finance-home",
    label: "Finance Dashboard",
    href: "/erp/finance",
    description: "Track spend, categories, and simple month totals.",
    group: "Dashboard",
    sidebarIcon: "FI",
    cardIcon: "🏦",
    showInSidebar: true,
    showInCards: false,
  },
  {
    id: "finance-invoices",
    label: "Sales Posting",
    href: "/erp/finance/sales-posting",
    description: "Open channel-specific sales posting workflows and invoice links.",
    group: "Operations",
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
    group: "Operations",
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
    group: "Operations",
    sidebarIcon: "EX",
    cardIcon: "🧾",
    showInSidebar: true,
    showInCards: true,
  },
  {
    id: "finance-shopify-sales-posting",
    label: "Shopify Sales Posting",
    href: "/erp/finance/sales/shopify",
    description: "Review Shopify order posting coverage and post missing journals.",
    group: "Operations",
    roles: FINANCE_ROLE_KEYS,
    sidebarIcon: "SP",
    cardIcon: "🛒",
    showInSidebar: false,
    showInCards: true,
  },
  {
    id: "finance-amazon-settlement-posting",
    label: "Amazon Settlement Posting",
    href: "/erp/finance/amazon/settlement-posting",
    description: "Review Amazon settlement batch posting coverage and post missing journals.",
    group: "Operations",
    roles: FINANCE_ROLE_KEYS,
    sidebarIcon: "AZ",
    cardIcon: "🧾",
    showInSidebar: false,
    showInCards: true,
  },
  {
    id: "finance-recurring-expenses",
    label: "Recurring Expenses",
    href: "/erp/finance/expenses/recurring",
    description: "Template recurring expense records and auto-generate runs.",
    group: "Operations",
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
    group: "Operations",
    sidebarIcon: "AP",
    cardIcon: "🧾",
    showInSidebar: true,
    showInCards: false,
  },
  {
    id: "finance-ap-vendor-ledger",
    label: "Vendor Ledger",
    href: "/erp/finance/ap/vendor-ledger",
    description: "Review vendor ledger timelines across bills, advances, and payments.",
    group: "Reports",
    sidebarIcon: "VL",
    cardIcon: "📒",
    showInSidebar: true,
    showInCards: false,
  },
  {
    id: "finance-ap-vendor-bills",
    label: "Vendor Bills",
    href: "/erp/finance/ap/vendor-bills",
    description: "Capture vendor bills, apply advances, and post AP journals.",
    group: "Operations",
    sidebarIcon: "VB",
    cardIcon: "🧾",
    showInSidebar: true,
    showInCards: false,
  },
  {
    id: "finance-ap-vendor-advances",
    label: "Vendor Advances",
    href: "/erp/finance/ap/vendor-advances",
    description: "Record vendor advances and post AP prepayments.",
    group: "Operations",
    sidebarIcon: "VA",
    cardIcon: "💸",
    showInSidebar: true,
    showInCards: false,
  },
  {
    id: "finance-recon",
    label: "Recon Dashboard",
    href: "/erp/finance/recon",
    description: "Monitor bank matches, vendor payments, and AP allocations.",
    group: "Recon",
    sidebarIcon: "RC",
    cardIcon: "🧭",
    showInSidebar: true,
    showInCards: false,
  },
  {
    id: "finance-recon-payouts",
    label: "Payout Reconciliation",
    href: "/erp/finance/recon/payouts",
    description: "Review payout-level matching and reconciliation status.",
    group: "Recon",
    roles: FINANCE_ROLE_KEYS,
    sidebarIcon: "PR",
    cardIcon: "🧭",
    showInSidebar: true,
    showInCards: false,
  },
  {
    id: "finance-vendor-payments",
    label: "Vendor Payments",
    href: "/erp/finance/vendor-payments",
    description: "Create, match, and void vendor payments.",
    group: "Operations",
    sidebarIcon: "VP",
    cardIcon: "💸",
    showInSidebar: true,
    showInCards: false,
  },
  {
    id: "finance-journals",
    label: "Journals",
    href: "/erp/finance/journals",
    description: "Review payroll-posted finance journals and void if needed.",
    group: "Operations",
    roles: FINANCE_ROLE_KEYS,
    sidebarIcon: "JR",
    cardIcon: "📒",
    showInSidebar: true,
    showInCards: false,
  },
  {
    id: "finance-loans",
    label: "Loan Payments",
    href: "/erp/finance/loans",
    description: "Manage loan masters, EMI setup, and repayment tracking.",
    group: "Operations",
    roles: FINANCE_ROLE_KEYS,
    sidebarIcon: "LN",
    cardIcon: "🏦",
    showInSidebar: true,
    showInCards: false,
  },
  {
    id: "finance-period-locks",
    label: "Period Lock",
    href: "/erp/finance/control/period-lock",
    description: "Lock fiscal months to prevent new finance postings.",
    group: "Control",
    roles: FINANCE_ROLE_KEYS,
    sidebarIcon: "PL",
    cardIcon: "🔒",
    showInSidebar: true,
    showInCards: true,
  },
  {
    id: "finance-approvals",
    label: "Approvals",
    href: "/erp/finance/control/approvals",
    description: "Review submitted finance approvals.",
    group: "Control",
    roles: FINANCE_ROLE_KEYS,
    sidebarIcon: "AP",
    cardIcon: "✅",
    showInSidebar: true,
    showInCards: true,
  },
  {
    id: "finance-month-close",
    label: "Month Close",
    href: "/erp/finance/control/month-close",
    description: "Run the month close checklist and lock the period.",
    group: "Control",
    roles: FINANCE_ROLE_KEYS,
    sidebarIcon: "MC",
    cardIcon: "✅",
    showInSidebar: true,
    showInCards: true,
  },
  {
    id: "finance-account-ledger",
    label: "Account Ledger",
    href: "/erp/finance/reports/account-ledger",
    description: "Review ledger movements for a single account.",
    group: "Reports",
    roles: FINANCE_ROLE_KEYS,
    sidebarIcon: "AL",
    cardIcon: "📓",
    showInSidebar: true,
    showInCards: false,
  },
  {
    id: "finance_ar_outstanding",
    label: "Outstanding Receivables",
    href: "/erp/finance/ar/outstanding",
    description: "Allocate customer credit notes against open customer invoices.",
    group: "Reports",
    roles: FINANCE_ROLE_KEYS,
    sidebarIcon: "ledger",
    cardIcon: "📒",
    showInSidebar: true,
    showInCards: false,
  },
  {
    id: "finance-trial-balance",
    label: "Trial Balance",
    href: "/erp/finance/reports/trial-balance",
    description: "Summarize debits and credits across accounts.",
    group: "Reports",
    roles: FINANCE_ROLE_KEYS,
    sidebarIcon: "TB",
    cardIcon: "🧾",
    showInSidebar: true,
    showInCards: false,
  },
  {
    id: "finance-pnl",
    label: "Profit & Loss",
    href: "/erp/finance/reports/pnl",
    description: "Review revenue, expenses, and net performance.",
    group: "Reports",
    roles: FINANCE_ROLE_KEYS,
    sidebarIcon: "PL",
    cardIcon: "📊",
    showInSidebar: true,
    showInCards: false,
  },
  {
    id: "finance-balance-sheet",
    label: "Balance Sheet",
    href: "/erp/finance/reports/balance-sheet",
    description: "Snapshot assets, liabilities, and equity.",
    group: "Reports",
    roles: FINANCE_ROLE_KEYS,
    sidebarIcon: "BS",
    cardIcon: "📘",
    showInSidebar: true,
    showInCards: false,
  },
  {
    id: "finance-cash-flow",
    label: "Cash Flow",
    href: "/erp/finance/reports/cash-flow",
    description: "Track cash movement by operating, investing, and financing.",
    group: "Reports",
    roles: FINANCE_ROLE_KEYS,
    sidebarIcon: "CF",
    cardIcon: "💧",
    showInSidebar: true,
    showInCards: false,
  },
  {
    id: "finance-expense-reports",
    label: "Expense Reports",
    href: "/erp/finance/expenses/reports",
    description: "Analyze expense totals by vendor, category, or month.",
    group: "Reports",
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
    group: "Control",
    sidebarIcon: "FB",
    cardIcon: "🧩",
    showInSidebar: true,
    showInCards: true,
  },
  {
    id: "finance-razorpay-settlements",
    label: "Razorpay Settlements",
    href: "/erp/finance/razorpay/settlements",
    description: "Sync Razorpay settlements and post bank clearing journals.",
    group: "Operations",
    roles: FINANCE_ROLE_KEYS,
    sidebarIcon: "RZ",
    cardIcon: "💳",
    showInSidebar: true,
    showInCards: true,
  },
  {
    id: "finance-razorpay-settlements-ledger",
    label: "Settlement Ledger",
    href: "/erp/finance/settlements",
    description: "Review marketplace settlement events and bank matching status.",
    group: "Operations",
    roles: FINANCE_ROLE_KEYS,
    sidebarIcon: "SL",
    cardIcon: "📒",
    showInSidebar: true,
    showInCards: false,
  },
  {
    id: "finance-shopify-sync",
    label: "Shopify Sync (Moved to OMS)",
    href: "/erp/finance/shopify-sync",
    description: "Moved to OMS → Shopify. Backfill Shopify orders into the ERP ledger.",
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
    group: "Compliance",
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
    group: "Compliance",
    roles: FINANCE_ROLE_KEYS,
    sidebarIcon: "SM",
    cardIcon: "🏷️",
    showInSidebar: false,
    showInCards: false,
  },
  {
    id: "finance-gst-purchases",
    label: "GST Purchase",
    href: "/erp/finance/gst/purchases",
    description: "Import vendor GST invoices and export purchase registers.",
    group: "Compliance",
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
    group: "Reports",
    sidebarIcon: "MM",
    cardIcon: "📊",
    showInSidebar: true,
    showInCards: true,
  },
  {
    id: "finance-amazon-settlements",
    label: "Amazon Payouts",
    href: "/erp/finance/amazon/payouts",
    description: "Preview Amazon payout flat-file reports without importing data.",
    group: "Operations",
    sidebarIcon: "AS",
    cardIcon: "🧾",
    showInSidebar: true,
    showInCards: false,
  },
  {
    id: "finance-settings",
    label: "Finance Settings",
    href: "/erp/finance/settings",
    description: "Configure finance posting and controls.",
    group: "Finance Settings",
    roles: FINANCE_ROLE_KEYS,
    sidebarIcon: "ST",
    cardIcon: "⚙️",
    showInSidebar: false,
    showInCards: false,
  },
  {
    id: "finance-payroll-posting-settings",
    label: "Posting Settings · Payroll",
    href: "/erp/finance/settings/payroll-posting",
    description: "Configure accounts for payroll finance posting previews.",
    group: "Finance Settings",
    roles: FINANCE_ROLE_KEYS,
    sidebarIcon: "PP",
    cardIcon: "🧾",
    showInSidebar: false,
    showInCards: false,
  },
  {
    id: "finance-sales-posting-settings",
    label: "Posting Settings · Sales",
    href: "/erp/finance/settings/sales-posting",
    description: "Configure accounts for Shopify sales revenue posting.",
    group: "Finance Settings",
    roles: FINANCE_ROLE_KEYS,
    sidebarIcon: "SP",
    cardIcon: "🧾",
    showInSidebar: false,
    showInCards: false,
  },
  {
    id: "finance-coa-control-roles",
    label: "COA Control Roles",
    href: "/erp/finance/settings/coa-roles",
    description: "Map chart of accounts control roles for finance posting.",
    group: "Finance Settings",
    roles: FINANCE_ROLE_KEYS,
    sidebarIcon: "CR",
    cardIcon: "🧩",
    showInSidebar: false,
    showInCards: false,
  },
  {
    id: "finance-gl-accounts",
    label: "Chart of Accounts",
    href: "/erp/finance/masters/gl-accounts",
    description: "Maintain ledger accounts for payroll and finance workflows.",
    group: "Finance Settings",
    roles: FINANCE_ROLE_KEYS,
    sidebarIcon: "CO",
    cardIcon: "📚",
    showInSidebar: false,
    showInCards: false,
  },
  {
    id: "finance-bank-import",
    label: "Bank Import",
    href: "/erp/finance/bank/import",
    description: "Import bank transactions from XLS files.",
    group: "Operations",
    roles: FINANCE_ROLE_KEYS,
    sidebarIcon: "BI",
    cardIcon: "🏦",
    showInSidebar: true,
    showInCards: true,
  },
  {
    id: "finance-settlements",
    label: "Settlements",
    href: "/erp/finance/settlements",
    description: "Reconcile Amazon settlements through Indifi to bank credits.",
    group: "Operations",
    sidebarIcon: "ST",
    cardIcon: "🧾",
    showInSidebar: false,
    showInCards: true,
  },
  {
    id: "finance-loan-settings",
    label: "Loan Settings",
    href: "/erp/finance/settings/loan-posting",
    description: "Configure account mappings for finance loan posting entries.",
    group: "Finance Settings",
    roles: FINANCE_ROLE_KEYS,
    sidebarIcon: "LN",
    cardIcon: "⚙️",
    showInSidebar: false,
    showInCards: false,
  },
];

const FINANCE_GROUP_ORDER = [
  "Dashboard",
  "Operations",
  "Recon",
  "Control",
  "Compliance",
  "Reports",
  "Finance Settings",
  "Settings",
];

const GLOBAL_SETTINGS_ITEMS: FinanceGlobalSettingsItem[] = [
  {
    label: "Finance Settings",
    href: "/erp/finance/settings",
    icon: "FI",
    roles: FINANCE_ROLE_KEYS,
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

  const globalSettings = GLOBAL_SETTINGS_ITEMS.filter(
    (item) => !item.roles || Boolean(roleKey && item.roles.includes(roleKey))
  );

  if (globalSettings.length > 0) {
    groups.push({
      label: "Settings",
      items: globalSettings.map((item) => ({
        label: item.disabled ? `${item.label} (Coming soon)` : item.label,
        href: item.href ?? "#",
        icon: item.icon,
      })),
    });
  }

  groups.sort(
    (a, b) => FINANCE_GROUP_ORDER.indexOf(a.label) - FINANCE_GROUP_ORDER.indexOf(b.label)
  );

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
