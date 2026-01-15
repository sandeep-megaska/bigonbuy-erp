import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import type { CSSProperties } from "react";
import ErpShell from "../../../components/erp/ErpShell";
import {
  cardStyle as sharedCardStyle,
  eyebrowStyle,
  h1Style,
  pageContainerStyle,
  pageHeaderStyle,
  subtitleStyle,
} from "../../../components/erp/uiStyles";
import { getCompanyContext, isAdmin, requireAuthRedirectHome } from "../../../lib/erpContext";
import { getCurrentErpAccess } from "../../../lib/erp/nav";

export default function HrHomePage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [access, setAccess] = useState({
    isAuthenticated: false,
    isManager: false,
    roleKey: undefined as string | undefined,
  });
  const canGovern = useMemo(
    () => isAdmin(ctx?.roleKey || access.roleKey),
    [access.roleKey, ctx?.roleKey]
  );
  const navItems = useMemo(() => buildNavItems(canGovern), [canGovern]);

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

      setAccess({
        ...accessState,
        roleKey: accessState.roleKey ?? context.roleKey ?? undefined,
      });
      setCtx(context);
      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found for this user.");
      }
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  if (loading) {
    return (
      <ErpShell activeModule="hr">
        <div style={pageContainerStyle}>Loading HR…</div>
      </ErpShell>
    );
  }

  if (!ctx?.companyId) {
    return (
      <ErpShell activeModule="hr">
        <div style={pageContainerStyle}>
          <h1 style={{ ...h1Style, marginTop: 0 }}>HR</h1>
          <p style={{ color: "#b91c1c" }}>{error || "Unable to load company context."}</p>
          <p style={{ color: "#555" }}>
            You are signed in as {ctx?.email || "unknown user"}, but no company is linked to your
            account.
          </p>
          <Link href="/" style={linkStyle}>Return to sign in</Link>
        </div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="hr">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>HR</p>
            <h1 style={h1Style}>Human Resources</h1>
            <p style={subtitleStyle}>
              Enterprise-ready HR and payroll operations for your India workforce.
            </p>
            <p style={{ margin: "8px 0 0", color: "#4b5563" }}>
              Signed in as <strong>{ctx.email}</strong> · Role:{" "}
              <strong>{ctx.roleKey || access.roleKey || "member"}</strong>
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
            <Link href="/erp" style={linkStyle}>
              ← Back to ERP Home
            </Link>
          </div>
        </header>

        <div style={sectionStackStyle}>
          {navItems.map((section) => (
            <section key={section.title} style={sectionStyle}>
              <div style={sectionHeaderStyle}>
                <div>
                  <h2 style={sectionTitleStyle}>{section.title}</h2>
                  <p style={sectionDescriptionStyle}>{section.description}</p>
                </div>
                <span style={sectionMetaStyle}>{section.meta}</span>
              </div>
              <div style={cardGridStyle}>
                {section.items.map((item) => (
                  <ModuleCard key={item.title} item={item} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </ErpShell>
  );
}

const linkStyle: CSSProperties = { color: "#2563eb", textDecoration: "none", fontWeight: 600 };

const sectionStackStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 28,
};

const sectionStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

const sectionHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexWrap: "wrap",
  gap: 12,
};

const sectionTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 20,
  color: "#111827",
};

const sectionDescriptionStyle: CSSProperties = {
  margin: "6px 0 0",
  color: "#6b7280",
  fontSize: 14,
};

const sectionMetaStyle: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 8,
  backgroundColor: "#eef2ff",
  color: "#3730a3",
  fontSize: 12,
  fontWeight: 700,
};

const cardGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: 18,
};

const cardStyle: CSSProperties = {
  ...sharedCardStyle,
  display: "flex",
  gap: 14,
  alignItems: "flex-start",
  textAlign: "left",
  textDecoration: "none",
  color: "#111827",
};

const cardIconStyle: CSSProperties = {
  width: 42,
  height: 42,
  borderRadius: 10,
  display: "grid",
  placeItems: "center",
  backgroundColor: "#eef2ff",
  color: "#4338ca",
  fontWeight: "bold",
  fontSize: 18,
};

const cardTitleStyle: CSSProperties = {
  margin: "2px 0 6px",
  fontSize: 17,
  color: "#111827",
};

const cardDescriptionStyle: CSSProperties = {
  margin: 0,
  color: "#4b5563",
  fontSize: 14,
  lineHeight: 1.5,
};

const cardMetaStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginTop: 12,
  gap: 12,
};

const statusBadgeStyle: CSSProperties = {
  padding: "4px 10px",
  borderRadius: 8,
  backgroundColor: "#ecfeff",
  color: "#0e7490",
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const disabledStatusBadgeStyle: CSSProperties = {
  backgroundColor: "#fef3c7",
  color: "#92400e",
};

const cardCtaStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  color: "#2563eb",
  fontWeight: 700,
  textDecoration: "none",
  fontSize: 13,
};

const disabledCardStyle: CSSProperties = {
  backgroundColor: "#f8fafc",
  color: "#9ca3af",
  borderColor: "#e5e7eb",
  boxShadow: "none",
};

type ModuleItem = {
  title: string;
  description: string;
  href: string;
  icon: string;
  status: string;
  ctaLabel?: string;
  disabled?: boolean;
};

function ModuleCard({ item }: { item: ModuleItem }) {
  const content = (
    <div style={{ display: "flex", gap: 14 }}>
      <div style={cardIconStyle}>{item.icon}</div>
      <div style={{ flex: 1 }}>
        <h3 style={cardTitleStyle}>{item.title}</h3>
        <p style={cardDescriptionStyle}>{item.description}</p>
        <div style={cardMetaStyle}>
          <span
            style={{
              ...statusBadgeStyle,
              ...(item.status === "Coming Soon" ? disabledStatusBadgeStyle : null),
            }}
          >
            {item.status}
          </span>
          {item.ctaLabel ? <span style={cardCtaStyle}>{item.ctaLabel} →</span> : null}
        </div>
      </div>
    </div>
  );

  if (item.disabled) {
    return <div style={{ ...cardStyle, ...disabledCardStyle }}>{content}</div>;
  }

  return (
    <Link href={item.href} style={cardStyle}>
      {content}
    </Link>
  );
}

function buildNavItems(canGovern: boolean) {
  const sections = [
    {
      title: "HR Masters",
      description: "Create foundations for departments, grades, locations, and cost centers.",
      meta: "Foundation",
      items: [
        {
          title: "Designations",
          description: "Standardize job titles and grading levels.",
          href: "/erp/hr/masters",
          icon: "🏷️",
          status: "Active",
          ctaLabel: "Manage",
        },
        {
          title: "Departments",
          description: "Organize business units and reporting structures.",
          href: "/erp/hr/masters",
          icon: "🏢",
          status: "Coming Soon",
          disabled: true,
        },
        {
          title: "Grades",
          description: "Define compensation grades and bands.",
          href: "/erp/hr/masters",
          icon: "📈",
          status: "Coming Soon",
          disabled: true,
        },
        {
          title: "Locations",
          description: "Maintain branches and statutory locations.",
          href: "/erp/hr/masters",
          icon: "📍",
          status: "Coming Soon",
          disabled: true,
        },
        {
          title: "Cost Centers",
          description: "Align payroll and HR costs to centers.",
          href: "/erp/hr/masters",
          icon: "🧾",
          status: "Coming Soon",
          disabled: true,
        },
        {
          title: "Leave Types",
          description: "Configure paid and unpaid leave categories.",
          href: "/erp/hr/leaves/types",
          icon: "🌴",
          status: "Active",
          ctaLabel: "Configure",
        },
        {
          title: "Weekly Off Rules",
          description: "Define weekly off patterns by location and employee overrides.",
          href: "/erp/hr/weekly-off",
          icon: "📆",
          status: "Active",
          ctaLabel: "Configure",
        },
      ],
    },
    {
      title: "HR Operations",
      description: "Run day-to-day HR, payroll, and employee lifecycle workflows.",
      meta: "Operations",
      items: [
        {
          title: "Employees",
          description: "Maintain employee profiles, lifecycle, and compliance details.",
          href: "/erp/hr/employees",
          icon: "🧑‍💼",
          status: "Active",
          ctaLabel: "Manage",
        },
        {
          title: "Salary Structures",
          description: "Maintain salary structures and payroll components.",
          href: "/erp/hr/salary",
          icon: "💰",
          status: "Active",
          ctaLabel: "Review",
        },
        {
          title: "Payroll",
          description: "Run payroll cycles, approvals, and payouts.",
          href: "/erp/hr/payroll/runs",
          icon: "📄",
          status: "Active",
          ctaLabel: "Run payroll",
        },
        {
          title: "Leave Requests",
          description: "Review and approve employee leave requests.",
          href: "/erp/hr/leaves/requests",
          icon: "📝",
          status: "Active",
          ctaLabel: "Review",
        },
        {
          title: "Attendance",
          description: "Mark attendance days and manage daily status.",
          href: "/erp/hr/attendance",
          icon: "🗓️",
          status: "Active",
          ctaLabel: "Mark days",
        },
        {
          title: "Calendars",
          description: "Manage attendance calendars, holidays, and work location mappings.",
          href: "/erp/hr/calendars",
          icon: "📅",
          status: "Active",
          ctaLabel: "Manage",
        },
      ],
    },
    {
      title: "Access & Governance",
      description: "Control HR roles, permissions, and employee logins.",
      meta: "Administration",
      items: [
        {
          title: "Company Users",
          description: "Invite employees and manage role-based access.",
          href: "/erp/admin/company-users",
          icon: "🛂",
          status: "Active",
          ctaLabel: "Manage",
        },
        {
          title: "Roles & Permissions",
          description: "Define HR roles and permission sets.",
          href: "/erp/hr/roles",
          icon: "🛡️",
          status: "Active",
          ctaLabel: "Assign",
        },
      ],
    },
  ];

  if (!canGovern) {
    sections.pop();
  }

  return sections;
}
