import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  cardStyle,
  eyebrowStyle,
  h1Style,
  h2Style,
  pageContainerStyle,
  pageHeaderStyle,
  subtitleStyle,
} from "../../../components/erp/uiStyles";
import { getCompanyContext, isAdmin, requireAuthRedirectHome } from "../../../lib/erpContext";
import { getCurrentErpAccess } from "../../../lib/erp/nav";

const sectionData = [
  {
    id: "company",
    title: "Company",
    description: "Company profile, compliance, and access management.",
    links: [
      {
        label: "Company Profile",
        href: "/erp/admin/company-settings",
        description: "Branding, legal name, and contact details.",
      },
      {
        label: "GST & Registrations",
        href: "/erp/admin/company-settings",
        description: "GSTIN and statutory registration details.",
      },
      {
        label: "Users & Access",
        href: "/erp/admin/company-users",
        description: "Invite staff and assign roles.",
      },
    ],
  },
  {
    id: "hr",
    title: "HR Settings",
    description: "Maintain HR masters and workforce configuration.",
    adminOnly: true,
    links: [
      {
        label: "HR Masters",
        href: "/erp/hr/masters",
        description: "Departments, locations, and employment setup.",
      },
      {
        label: "Designations",
        href: "/erp/hr/rbac/designations",
        description: "Designation access and role mapping.",
      },
      {
        label: "Leave Types",
        href: "/erp/hr/leaves/types",
        description: "Paid and unpaid leave categories.",
      },
      {
        label: "Calendars",
        href: "/erp/hr/calendars",
        description: "Holiday calendars and policy windows.",
      },
      {
        label: "Weekly Off",
        href: "/erp/hr/weekly-off",
        description: "Weekly off rules by roster and location.",
      },
      {
        label: "Salary Structures",
        href: "/erp/hr/salary",
        description: "Salary components and default structures.",
      },
    ],
  },
  {
    id: "finance",
    title: "Finance Settings",
    description: "Chart of accounts, postings, and reporting links.",
    links: [
      {
        label: "Chart of Accounts",
        href: "/erp/finance/masters/gl-accounts",
        description: "Maintain GL accounts and groups.",
      },
      {
        label: "Payroll Posting",
        href: "/erp/finance/settings/payroll-posting",
        description: "Map payroll runs to finance.",
      },
      {
        label: "Shopify Sales Posting",
        href: "/erp/finance/settings/sales-posting",
        description: "Post Shopify sales into finance.",
      },
      {
        label: "COA Control Roles",
        href: "/erp/finance/settings/coa-roles",
        description: "Map chart of accounts control roles.",
      },
      {
        label: "Cost Seeds",
        href: "/erp/inventory/cost-seeds",
        description: "Seed cost prices for SKU valuations.",
      },
      {
        label: "Journals",
        href: "/erp/finance/journals",
        description: "Review journal entries.",
      },
      {
        label: "Trial Balance",
        href: "/erp/finance/reports/trial-balance",
        description: "Balance snapshot by account.",
      },
      {
        label: "Account Ledger",
        href: "/erp/finance/reports/account-ledger",
        description: "Ledger drill-down by account.",
      },
    ],
  },
  {
    id: "inventory",
    title: "Inventory & Warehouse Settings",
    description: "Warehouse structure and inventory controls.",
    links: [
      {
        label: "Warehouses",
        href: "/erp/inventory/warehouses",
        description: "Define warehouses and storage sites.",
      },
      {
        label: "Stock Adjustments",
        href: "/erp/inventory/movements",
        description: "Manual adjustments and transfers.",
      },
      {
        label: "Stocktakes",
        href: "/erp/inventory/stocktakes",
        description: "Cycle counts and reconciliations.",
      },
      {
        label: "Write-offs",
        href: "/erp/inventory/writeoffs",
        description: "Inventory write-off tracking.",
      },
    ],
  },
  {
    id: "oms",
    title: "OMS & Integrations",
    description: "Marketplace connections and OMS workflows.",
    links: [
      {
        label: "Channel Accounts",
        href: "/erp/oms/channels",
        description: "Manage Shopify, Amazon, and more.",
      },
      {
        label: "OMS Orders",
        href: "/erp/oms/orders",
        description: "Unified OMS order list.",
      },
      {
        label: "Shopify Orders",
        href: "/erp/oms/shopify/orders",
        description: "Shopify order management.",
      },
      {
        label: "Amazon Orders",
        href: "/erp/oms/amazon/orders",
        description: "Amazon order management.",
      },
    ],
  },
];

export default function CompanySettingsHubPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const [accessState, context] = await Promise.all([
        getCurrentErpAccess(session),
        getCompanyContext(session),
      ]);
      if (!active) return;

      setCtx({ ...context, roleKey: accessState.roleKey ?? context.roleKey ?? undefined });
      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found for this user.");
      }
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const sections = useMemo(() => {
    const adminUser = isAdmin(ctx?.roleKey);
    return sectionData
      .filter((section) => !section.adminOnly || adminUser)
      .map((section) => ({ ...section, links: section.links.filter(Boolean) }))
      .filter((section) => section.links.length > 0);
  }, [ctx?.roleKey]);

  if (loading) {
    return (
      <>
        <div style={pageContainerStyle}>Loading Company settings…</div>
      </>
    );
  }

  if (!ctx?.companyId) {
    return (
      <>
        <div style={pageContainerStyle}>
          <header style={pageHeaderStyle}>
            <div>
              <p style={eyebrowStyle}>Company</p>
              <h1 style={h1Style}>Company</h1>
              <p style={subtitleStyle}>Company profile &amp; module settings</p>
            </div>
          </header>
          <p style={{ color: "#b91c1c" }}>{error || "Unable to load company context."}</p>
        </div>
      </>
    );
  }

  return (
    <>
      <div style={pageContainerStyle}>
        <nav style={breadcrumbStyle} aria-label="Breadcrumb">
          <span style={breadcrumbCurrentStyle}>Company</span>
          <span style={breadcrumbSeparatorStyle}>/</span>
          <span style={breadcrumbMutedStyle}>Settings</span>
        </nav>

        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Company</p>
            <h1 style={h1Style}>Company</h1>
            <p style={subtitleStyle}>Company profile &amp; module settings</p>
          </div>
        </header>

        <section style={cardGridStyle}>
          {sections.map((section) => (
            <div key={section.id} style={cardStyle}>
              <div style={cardHeaderStyle}>
                <h2 style={h2Style}>{section.title}</h2>
                <p style={cardDescriptionStyle}>{section.description}</p>
              </div>
              <ul style={linkListStyle}>
                {section.links.map((link) => (
                  <li key={link.href} style={linkItemStyle}>
                    <Link href={link.href} style={linkStyle}>
                      <div style={linkTextStyle}>
                        <span style={linkLabelStyle}>{link.label}</span>
                        <span style={linkDescriptionStyle}>{link.description}</span>
                      </div>
                      <span style={linkArrowStyle}>→</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}

const breadcrumbStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 13,
  color: "#6b7280",
};

const breadcrumbSeparatorStyle: CSSProperties = {
  color: "#9ca3af",
};

const breadcrumbCurrentStyle: CSSProperties = {
  color: "#111827",
  fontWeight: 600,
};

const breadcrumbMutedStyle: CSSProperties = {
  color: "#6b7280",
};

const cardGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: 18,
};

const cardHeaderStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  marginBottom: 12,
};

const cardDescriptionStyle: CSSProperties = {
  margin: 0,
  color: "#4b5563",
  fontSize: 14,
};

const linkListStyle: CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  display: "grid",
  gap: 10,
};

const linkItemStyle: CSSProperties = {
  margin: 0,
};

const linkStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "10px 12px",
  borderRadius: 10,
  textDecoration: "none",
  border: "1px solid #e5e7eb",
  backgroundColor: "#f9fafb",
  color: "#111827",
};

const linkTextStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

const linkLabelStyle: CSSProperties = {
  fontWeight: 600,
  fontSize: 14,
};

const linkDescriptionStyle: CSSProperties = {
  fontSize: 12,
  color: "#6b7280",
};

const linkArrowStyle: CSSProperties = {
  fontSize: 16,
  color: "#9ca3af",
};
