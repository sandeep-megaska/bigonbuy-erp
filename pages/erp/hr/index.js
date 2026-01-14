import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpNavBar from "../../../components/erp/ErpNavBar";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../lib/erpContext";
import { getCurrentErpAccess } from "../../../lib/erp/nav";
import { supabase } from "../../../lib/supabaseClient";

export default function HrHomePage() {
  const router = useRouter();
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [access, setAccess] = useState({
    isAuthenticated: false,
    isManager: false,
    roleKey: undefined,
  });
  const canManage = useMemo(() => access.isManager || isHr(ctx?.roleKey), [access.isManager, ctx]);
  const navItems = useMemo(() => buildNavItems(canManage), [canManage]);

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

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };

  if (loading) {
    return <div style={containerStyle}>Loading HR…</div>;
  }

  if (!ctx?.companyId) {
    return (
      <div style={containerStyle}>
        <h1 style={{ marginTop: 0 }}>HR</h1>
        <p style={{ color: "#b91c1c" }}>{error || "Unable to load company context."}</p>
        <p style={{ color: "#555" }}>You are signed in as {ctx?.email || "unknown user"}, but no company is linked to your account.</p>
        <button onClick={handleSignOut} style={buttonStyle}>Sign Out</button>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <ErpNavBar access={access} roleKey={ctx?.roleKey} />
      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>HR</p>
          <h1 style={titleStyle}>Human Resources</h1>
          <p style={subtitleStyle}>Enterprise-ready HR and payroll operations for your India workforce.</p>
          <p style={{ margin: "8px 0 0", color: "#4b5563" }}>
            Signed in as <strong>{ctx.email}</strong> · Role:{" "}
            <strong>{ctx.roleKey || access.roleKey || "member"}</strong>
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <Link href="/erp" style={{ color: "#2563eb", textDecoration: "none" }}>← Back to ERP Home</Link>
          <button type="button" onClick={handleSignOut} style={buttonStyle}>Sign Out</button>
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
      <style jsx>{`
        .module-card {
          transition: transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease;
        }
        .module-card:hover {
          transform: translateY(-2px);
          border-color: #c7d2fe;
          box-shadow: 0 10px 18px rgba(15, 23, 42, 0.08);
        }
        .module-card.disabled {
          cursor: not-allowed;
        }
        .module-card.disabled:hover {
          transform: none;
          border-color: #e5e7eb;
          box-shadow: none;
        }
      `}</style>
    </div>
  );
}

const containerStyle = {
  maxWidth: 1120,
  margin: "72px auto",
  padding: "48px 56px 56px",
  borderRadius: 12,
  border: "1px solid #e7eaf0",
  fontFamily: "Arial, sans-serif",
  boxShadow: "0 14px 32px rgba(15, 23, 42, 0.08)",
  backgroundColor: "#fff",
};

const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 24,
  flexWrap: "wrap",
  borderBottom: "1px solid #eef1f6",
  paddingBottom: 24,
  marginBottom: 28,
};

const buttonStyle = {
  padding: "10px 16px",
  backgroundColor: "#dc2626",
  border: "none",
  color: "#fff",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 15,
};

const eyebrowStyle = {
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontSize: 12,
  color: "#6b7280",
  margin: 0,
};

const titleStyle = {
  margin: "6px 0 8px",
  fontSize: 34,
  color: "#111827",
};

const subtitleStyle = {
  margin: 0,
  color: "#4b5563",
  fontSize: 16,
  maxWidth: 540,
  lineHeight: 1.5,
};

const sectionStackStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 28,
};

const sectionStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

const sectionHeaderStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexWrap: "wrap",
  gap: 12,
};

const sectionTitleStyle = {
  margin: 0,
  fontSize: 20,
  color: "#111827",
};

const sectionDescriptionStyle = {
  margin: "6px 0 0",
  color: "#6b7280",
  fontSize: 14,
};

const sectionMetaStyle = {
  padding: "6px 12px",
  borderRadius: 999,
  backgroundColor: "#eef2ff",
  color: "#3730a3",
  fontSize: 12,
  fontWeight: 700,
};

const cardGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: 18,
};

const cardStyle = {
  display: "flex",
  gap: 14,
  alignItems: "flex-start",
  border: "1px solid #e6e9ef",
  borderRadius: 12,
  padding: 18,
  backgroundColor: "#fbfcff",
  textAlign: "left",
  textDecoration: "none",
  color: "#111827",
  boxShadow: "0 6px 16px rgba(15, 23, 42, 0.06)",
};

const cardIconStyle = {
  width: 42,
  height: 42,
  borderRadius: 12,
  display: "grid",
  placeItems: "center",
  backgroundColor: "#eef2ff",
  color: "#4338ca",
  fontWeight: "bold",
  fontSize: 18,
};

const cardTitleStyle = {
  margin: "2px 0 6px",
  fontSize: 17,
  color: "#111827",
};

const cardDescriptionStyle = {
  margin: 0,
  color: "#4b5563",
  fontSize: 14,
  lineHeight: 1.5,
};

const cardMetaStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginTop: 12,
  gap: 12,
};

const statusBadgeStyle = {
  padding: "4px 10px",
  borderRadius: 999,
  backgroundColor: "#ecfeff",
  color: "#0e7490",
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const disabledStatusBadgeStyle = {
  backgroundColor: "#fef3c7",
  color: "#92400e",
};

const cardCtaStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  color: "#1d4ed8",
  fontWeight: 700,
  textDecoration: "none",
  fontSize: 13,
};

const disabledCardStyle = {
  backgroundColor: "#f8fafc",
  color: "#9ca3af",
  borderColor: "#e5e7eb",
  boxShadow: "none",
};

function ModuleCard({ item }) {
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
              ...(item.status === "Coming Soon" ? disabledStatusBadgeStyle : {}),
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
    return (
      <div className="module-card disabled" style={{ ...cardStyle, ...disabledCardStyle }}>
        {content}
      </div>
    );
  }

  return (
    <Link className="module-card" href={item.href} style={cardStyle}>
      {content}
    </Link>
  );
}

function buildNavItems(canManage) {
  const sections = [
    {
      title: "HR Masters",
      description: "Create foundations for departments, grades, locations, and cost centers.",
      meta: "Foundation",
      items: [
        {
          title: "HR Masters",
          description:
            "Manage departments, designations, grades, locations, and cost centers in one place.",
          href: "/erp/hr/masters",
          icon: "📚",
          status: "Active",
          ctaLabel: "Open",
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
          title: "Designations",
          description: "Standardize job titles and grading levels.",
          href: "/erp/hr/masters",
          icon: "🏷️",
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
          title: "Leave Types",
          description: "Configure paid and unpaid leave categories.",
          href: "/erp/hr/leaves/types",
          icon: "🌴",
          status: "Active",
          ctaLabel: "Configure",
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
      ],
    },
    {
      title: "Access & Governance",
      description: "Control HR roles, permissions, and employee logins.",
      meta: "Administration",
      items: [
        {
          title: "Roles",
          description: "Define HR roles and permission sets.",
          href: "/erp/hr/roles",
          icon: "🛡️",
          status: "Active",
          ctaLabel: "Assign",
        },
        {
          title: "Employee Logins",
          description: "Provision employee logins and identity mapping.",
          href: "/erp/hr/employee-logins",
          icon: "🔗",
          status: "Active",
          ctaLabel: "Connect",
        },
      ],
    },
  ];

  if (canManage) {
    sections[2].items.push({
      title: "Company Users & Access",
      description: "Invite employees and manage role-based access.",
      href: "/erp/admin/company-users",
      icon: "🛂",
      status: "Active",
      ctaLabel: "Manage",
    });
  }

  return sections;
}
