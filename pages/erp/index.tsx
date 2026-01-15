import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import ErpShell from "../../components/erp/ErpShell";
import {
  cardStyle as sharedCardStyle,
  eyebrowStyle,
  h1Style,
  pageContainerStyle,
  pageHeaderStyle,
  secondaryButtonStyle,
  subtitleStyle,
} from "../../components/erp/uiStyles";
import { getCompanyContext, isAdmin, requireAuthRedirectHome } from "../../lib/erpContext";
import { getCurrentErpAccess } from "../../lib/erp/nav";

const buttonStyle: CSSProperties = {
  ...secondaryButtonStyle,
  borderColor: "#dc2626",
  color: "#dc2626",
};

type ModuleItem = {
  title: string;
  description: string;
  href: string;
  status: string;
  cta?: string;
  disabled?: boolean;
};

type ModuleSection = {
  title: string;
  description: string;
  items: ModuleItem[];
};

export default function ErpHomePage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [access, setAccess] = useState({
    isAuthenticated: false,
    isManager: false,
    roleKey: undefined as string | undefined,
  });

  const sections = useMemo<ModuleSection[]>(() => {
    const canAdmin = isAdmin(ctx?.roleKey || access.roleKey);
    const canManage = access.isManager;

    const baseSections: ModuleSection[] = [
      {
        title: "Workspace",
        description: "Core catalog and stock workflows.",
        items: [
          {
            title: "Products",
            description: "Create and manage your product catalog.",
            href: "/erp/products",
            status: "Active",
            cta: "Manage",
          },
          {
            title: "Variants",
            description: "Organize options and product variations.",
            href: "/erp/variants",
            status: "Active",
            cta: "Review",
          },
          {
            title: "Inventory",
            description: "Track stock levels across variants.",
            href: "/erp/inventory",
            status: "Active",
            cta: "Open",
          },
        ],
      },
      {
        title: "HR",
        description: "Employees, salary, leave, and payroll operations.",
        items: [
          {
            title: "Human Resources",
            description: "Payroll, attendance, and HR masters.",
            href: "/erp/hr",
            status: "Active",
            cta: "Open",
          },
        ],
      },
      {
        title: "Finance",
        description: "Expense tracking and financial reporting.",
        items: [
          {
            title: "Finance",
            description: "Track spend, invoices, and budgets.",
            href: "/erp/finance",
            status: "Coming Soon",
            disabled: true,
          },
        ],
      },
    ];

    if (canAdmin) {
      baseSections.push({
        title: "Admin",
        description: "Company access and governance controls.",
        items: [
          {
            title: "Company Users",
            description: "Invite staff and manage access.",
            href: "/erp/admin/company-users",
            status: "Active",
            cta: "Manage",
          },
          {
            title: "Company Settings",
            description: "Configure branding and organization details.",
            href: "/erp/admin/company-settings",
            status: "Active",
            cta: "Configure",
          },
        ],
      });
    }

    if (!canManage) {
      return baseSections.filter((section) => section.title !== "HR");
    }

    return baseSections;
  }, [access.isManager, access.roleKey, ctx?.roleKey]);

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
      <ErpShell activeModule="workspace">
        <div style={pageContainerStyle}>Loading account...</div>
      </ErpShell>
    );
  }

  if (!ctx?.companyId) {
    return (
      <ErpShell activeModule="workspace">
        <div style={pageContainerStyle}>
          <h1 style={{ ...h1Style, marginTop: 0 }}>ERP Home</h1>
          <p style={{ color: "#b91c1c" }}>{error || "Unable to load company context."}</p>
          <p style={{ color: "#555" }}>
            You are signed in as {ctx?.email || "unknown user"}, but no company is linked to your
            account.
          </p>
          <p style={{ color: "#374151", marginTop: 8 }}>
            Account not linked to company. Please ask admin to invite you.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
            <button type="button" onClick={() => router.replace("/")} style={buttonStyle}>
              Back to Sign In
            </button>
          </div>
        </div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="workspace">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>ERP Home</p>
            <h1 style={h1Style}>Welcome to Bigonbuy ERP</h1>
            <p style={subtitleStyle}>
              Manage your catalog, variants, and inventory from a single place.
            </p>
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ margin: 0, color: "#374151" }}>
              Signed in as <strong>{ctx.email}</strong>
            </p>
            <p style={{ margin: "4px 0 0", color: "#4b5563" }}>
              Role: <strong>{ctx.roleKey || access.roleKey || "member"}</strong>
            </p>
          </div>
        </header>

        <section style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {sections.map((section) => (
            <div key={section.title} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <p style={sectionLabelStyle}>{section.title}</p>
                <div style={sectionDividerStyle} />
              </div>
              <p style={sectionDescriptionStyle}>{section.description}</p>
              <div style={cardGridStyle}>
                {section.items.map((item) => {
                  const content = (
                    <>
                      <div style={cardIconStyle}>{item.title.slice(0, 2)}</div>
                      <div style={{ flex: 1 }}>
                        <h2 style={cardTitleStyle}>{item.title}</h2>
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
                          {item.cta ? <span style={cardCtaStyle}>{item.cta} →</span> : null}
                        </div>
                      </div>
                    </>
                  );

                  if (item.disabled) {
                    return (
                      <div key={item.title} style={{ ...cardStyle, ...disabledCardStyle }}>
                        {content}
                      </div>
                    );
                  }

                  return (
                    <Link key={item.href} href={item.href} style={cardStyle}>
                      {content}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      </div>
    </ErpShell>
  );
}

const cardGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: 16,
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
  backgroundColor: "#eff6ff",
  color: "#2563eb",
  fontWeight: "bold",
  fontSize: 16,
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
};

const cardMetaStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginTop: 12,
  gap: 12,
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

const disabledCardStyle: CSSProperties = {
  backgroundColor: "#f8fafc",
  color: "#9ca3af",
  borderColor: "#e5e7eb",
  boxShadow: "none",
};

const sectionLabelStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "#6b7280",
};

const sectionDividerStyle: CSSProperties = {
  flex: 1,
  height: 1,
  background: "#e5e7eb",
};

const sectionDescriptionStyle: CSSProperties = {
  margin: 0,
  color: "#6b7280",
  fontSize: 14,
};
